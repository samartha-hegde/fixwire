import { Tag } from './constants.js';
import { type Field, FixMessage } from './message.js';

export interface FieldDef {
  tag: number;
  name: string;
  type: string;
  /** enum value -> description, for enumerated fields. */
  values?: Record<string, string>;
}

/** A repeating group: its count field, the delimiter (first member), and members. */
export interface GroupSpec {
  countTag: number;
  name: string;
  delimiterTag: number;
  memberTags: number[];
}

/** A field of a message, as declared in the dictionary. */
export interface MessageField {
  tag: number;
  name: string;
  required: boolean;
}

export interface Dictionary {
  byTag: Map<number, FieldDef>;
  byName: Map<string, number>;
  /** msgtype (tag 35 value) -> message name. */
  messages: Map<string, string>;
  /** count tag (NoXXX) -> repeating group definition. */
  groups: Map<number, GroupSpec>;
  /** msgtype -> tags of top-level required fields. */
  required: Map<string, number[]>;
  /** msgtype -> all top-level fields (required and optional, in order). */
  messageFields: Map<string, MessageField[]>;
}

// Attribute values may be double- or single-quoted (FIX dictionaries use either).
const ATTR = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const FIELD = /<field\s+([^>]*?)\/>|<field\s+([^>]*?)>([\s\S]*?)<\/field>/g;
const VALUE = /<value\s+([^>]*?)\/?>/g;
const MESSAGE_BLOCK = /<message\s+([^>]*?)>([\s\S]*?)<\/message>|<message\s+([^>]*?)\/>/g;
const FIELD_REF = /<field\s+([^>]*?)\/?>/g;
// A component definition (not a self-closing reference): the opening tag must not end in "/>".
const COMPONENT_DEF = /<component\s+([^>]*?)(?<!\/)>([\s\S]*?)<\/component>/g;
// Innermost group: a <group> whose body contains no further <group>.
const INNER_GROUP = /<group\s+([^>]*?)>((?:(?!<group)[\s\S])*?)<\/group>/;

/**
 * Inline `<component name="X" .../>` references with the body of their definition
 * from the `<components>` section, recursively (iterating until stable). An
 * optional component reference downgrades its inlined fields to not-required.
 */
function expandComponents(xml: string): string {
  const defs = new Map<string, string>();
  COMPONENT_DEF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPONENT_DEF.exec(xml)) !== null) {
    const name = attrs(m[1] ?? '').name;
    if (name) defs.set(name, m[2] ?? '');
  }
  if (defs.size === 0) return xml;

  let work = xml;
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    // Only self-closing refs (<component .../>), never the definitions.
    work = work.replace(/<component\s+([^>]*?)\/>/g, (whole, attrStr: string) => {
      const a = attrs(attrStr);
      const body = a.name ? defs.get(a.name) : undefined;
      if (body === undefined) return whole;
      changed = true;
      return a.required === 'Y' ? body : body.replace(/required="Y"/g, 'required="N"');
    });
    if (!changed) break;
  }
  return work;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(s)) !== null) {
    const key = m[1];
    const value = m[2] ?? m[3]; // double- or single-quoted
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

/** Collect the resolved tags of `<field>` references inside an XML fragment, in order. */
function fieldTags(fragment: string, byName: Map<string, number>): number[] {
  const tags: number[] = [];
  const seen = new Set<number>();
  FIELD_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_REF.exec(fragment)) !== null) {
    const name = attrs(m[1] ?? '').name;
    const tag = name ? byName.get(name) : undefined;
    if (tag !== undefined && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Resolve repeating groups by rewriting the XML innermost-out: each innermost
 * `<group>` is recorded, then replaced by a stub `<field>` for its count field
 * followed by the group's own fields. Inlining the fields means an enclosing
 * group's member set is transitive (it includes nested count tags AND nested
 * member tags), so {@link getGroups} captures full entries and a nested group is
 * then extractable by calling {@link getGroups} again on an entry.
 */
function resolveGroups(xml: string, byName: Map<string, number>): Map<number, GroupSpec> {
  const groups = new Map<number, GroupSpec>();
  let work = xml;
  for (;;) {
    const m = INNER_GROUP.exec(work);
    if (!m) break;
    const name = attrs(m[1] ?? '').name;
    const body = m[2] ?? '';
    const countTag = name ? byName.get(name) : undefined;
    if (name && countTag !== undefined) {
      const memberTags = fieldTags(body, byName);
      const delimiterTag = memberTags[0];
      if (delimiterTag !== undefined) {
        groups.set(countTag, { countTag, name, delimiterTag, memberTags });
      }
    }
    const stub = name ? `<field name="${name}"/>${body}` : body;
    work = work.slice(0, m.index) + stub + work.slice(m.index + m[0].length);
  }
  return groups;
}

/** Strip all `<group>...</group>` blocks (innermost-out) so only top-level fields remain. */
function stripGroups(fragment: string): string {
  let work = fragment;
  for (;;) {
    const m = INNER_GROUP.exec(work);
    if (!m) break;
    work = work.slice(0, m.index) + work.slice(m.index + m[0].length);
  }
  return work;
}

/**
 * Parse a QuickFIX-format FIX data dictionary (e.g. FIX44.xml) into a runtime
 * {@link Dictionary}. Dependency-free: regex over the `<field>`, `<group>` and
 * `<message>` declarations. Covers field tag/name/type, enum values, the
 * msgtype->name map, repeating-group structure, and per-message required fields.
 *
 * Expands `<component>` references and resolves nested groups, so component-heavy
 * and nested-group messages (common in FIX 5.0) parse correctly.
 */
export function parseDictionary(rawXml: string): Dictionary {
  const xml = expandComponents(rawXml);
  const byTag = new Map<number, FieldDef>();
  const byName = new Map<string, number>();

  FIELD.lastIndex = 0;
  let f: RegExpExecArray | null;
  while ((f = FIELD.exec(xml)) !== null) {
    const a = attrs(f[1] ?? f[2] ?? '');
    const tag = Number(a.number);
    if (!Number.isInteger(tag) || !a.name) continue;
    const def: FieldDef = { tag, name: a.name, type: a.type ?? 'STRING' };

    const body = f[3];
    if (body) {
      const values: Record<string, string> = {};
      VALUE.lastIndex = 0;
      let v: RegExpExecArray | null;
      while ((v = VALUE.exec(body)) !== null) {
        const va = attrs(v[1] ?? '');
        if (va.enum !== undefined) values[va.enum] = va.description ?? va.enum;
      }
      if (Object.keys(values).length) def.values = values;
    }

    byTag.set(tag, def);
    byName.set(a.name, tag);
  }

  const groups = resolveGroups(xml, byName);

  const messages = new Map<string, string>();
  const required = new Map<string, number[]>();
  const messageFields = new Map<string, MessageField[]>();
  MESSAGE_BLOCK.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = MESSAGE_BLOCK.exec(xml)) !== null) {
    const a = attrs(mm[1] ?? mm[3] ?? '');
    if (!a.msgtype || !a.name) continue;
    messages.set(a.msgtype, a.name);

    const body = mm[2];
    if (body) {
      const reqTags: number[] = [];
      const fields: MessageField[] = [];
      FIELD_REF.lastIndex = 0;
      let fr: RegExpExecArray | null;
      const topLevel = stripGroups(body);
      while ((fr = FIELD_REF.exec(topLevel)) !== null) {
        const fa = attrs(fr[1] ?? '');
        if (!fa.name) continue;
        const tag = byName.get(fa.name);
        if (tag === undefined) continue;
        const isRequired = fa.required === 'Y';
        fields.push({ tag, name: fa.name, required: isRequired });
        if (isRequired) reqTags.push(tag);
      }
      if (reqTags.length) required.set(a.msgtype, reqTags);
      if (fields.length) messageFields.set(a.msgtype, fields);
    }
  }

  return { byTag, byName, messages, groups, required, messageFields };
}

/** A built-in dictionary assembled from the bundled {@link Tag} constants. */
export function builtinDictionary(): Dictionary {
  const byTag = new Map<number, FieldDef>();
  const byName = new Map<string, number>();
  for (const [name, tag] of Object.entries(Tag)) {
    byTag.set(tag, { tag, name, type: 'STRING' });
    byName.set(name, tag);
  }
  return {
    byTag,
    byName,
    messages: new Map(),
    groups: new Map(),
    required: new Map(),
    messageFields: new Map(),
  };
}

/**
 * Extract the entries of a repeating group from a message. Each entry is returned
 * as a {@link FixMessage} so you can `.get(tag)` its fields. Requires a dictionary
 * that knows the group (see {@link parseDictionary}); falls back to delimiting by
 * the first field after the count when the group is unknown.
 *
 * ponytail: nested sub-groups are flattened into their parent entry's fields.
 */
export function getGroups(msg: FixMessage, countTag: number, dict: Dictionary): FixMessage[] {
  const fields = msg.fields;
  const idx = fields.findIndex(([t]) => t === countTag);
  if (idx === -1) return [];
  const count = Number(fields[idx]?.[1]);
  if (!Number.isInteger(count) || count <= 0) return [];

  const spec = dict.groups.get(countTag);
  const memberSet = spec ? new Set(spec.memberTags) : null;
  const delim = spec ? spec.delimiterTag : fields[idx + 1]?.[0];
  if (delim === undefined) return [];

  const entries: Field[][] = [];
  let cur: Field[] | null = null;
  for (let i = idx + 1; i < fields.length; i++) {
    const field = fields[i];
    if (field === undefined) break;
    const [t] = field;
    if (t === delim) {
      if (entries.length >= count) break;
      cur = [field];
      entries.push(cur);
    } else if (cur && (!memberSet || memberSet.has(t))) {
      cur.push(field);
    } else {
      break;
    }
  }
  return entries.map((e) => new FixMessage(e));
}

/**
 * Build the fields for an outbound repeating group: the count field followed by
 * each entry's fields in order. Splice the result into a message body.
 *
 * @example group(Tag.NoRelatedSym, [[[Tag.Symbol, 'BTC/USD']], [[Tag.Symbol, 'ETH/USD']]])
 */
export function group(countTag: number, entries: Field[][]): Field[] {
  const out: Field[] = [[countTag, String(entries.length)]];
  for (const entry of entries) out.push(...entry);
  return out;
}

/**
 * Render a message as human-readable `Name=value` pairs using a dictionary,
 * translating enum values to their descriptions where known. Great for logs.
 */
export function describe(msg: FixMessage, dict: Dictionary): string {
  return msg.fields
    .map(([tag, value]) => {
      const def = dict.byTag.get(tag);
      const name = def?.name ?? String(tag);
      const label = def?.values?.[value];
      return label ? `${name}=${value}(${label})` : `${name}=${value}`;
    })
    .join(' ');
}
