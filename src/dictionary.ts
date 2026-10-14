import { Tag } from './constants.js';
import type { FixMessage } from './message.js';

export interface FieldDef {
  tag: number;
  name: string;
  type: string;
  /** enum value -> description, for enumerated fields. */
  values?: Record<string, string>;
}

export interface Dictionary {
  byTag: Map<number, FieldDef>;
  byName: Map<string, number>;
  /** msgtype (tag 35 value) -> message name. */
  messages: Map<string, string>;
}

const ATTR = /(\w+)\s*=\s*"([^"]*)"/g;
const FIELD = /<field\s+([^>]*?)\/>|<field\s+([^>]*?)>([\s\S]*?)<\/field>/g;
const VALUE = /<value\s+([^>]*?)\/?>/g;
const MESSAGE = /<message\s+([^>]*?)\/?>/g;

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(s)) !== null) {
    const [, key, value] = m;
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Parse a QuickFIX-format FIX data dictionary (e.g. FIX44.xml) into a runtime
 * {@link Dictionary}. Dependency-free: a small regex over the `<field>` and
 * `<message>` declarations. Covers field tag/name/type, enum values, and the
 * msgtype->name map.
 */
export function parseDictionary(xml: string): Dictionary {
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

  const messages = new Map<string, string>();
  MESSAGE.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = MESSAGE.exec(xml)) !== null) {
    const a = attrs(mm[1] ?? '');
    if (a.msgtype && a.name) messages.set(a.msgtype, a.name);
  }

  return { byTag, byName, messages };
}

/** A built-in dictionary assembled from the bundled {@link Tag} constants. */
export function builtinDictionary(): Dictionary {
  const byTag = new Map<number, FieldDef>();
  const byName = new Map<string, number>();
  for (const [name, tag] of Object.entries(Tag)) {
    byTag.set(tag, { tag, name, type: 'STRING' });
    byName.set(name, tag);
  }
  return { byTag, byName, messages: new Map() };
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
