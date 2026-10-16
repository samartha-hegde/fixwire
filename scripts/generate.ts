/**
 * Generate typed FIX constants from a QuickFIX data dictionary.
 *
 *   npm run generate -- path/to/FIX44.xml > src/fix44.ts
 *
 * Emits a `Tag` map of every field name -> tag number, a `<Field>Enum` object for
 * each enumerated field, and a typed builder function per message (required fields
 * are required params, optional ones optional). Dependency-free.
 */
import { readFileSync } from 'node:fs';
import { parseDictionary } from '../src/dictionary.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run generate -- path/to/FIX44.xml > out.ts');
  process.exit(1);
}

const dict = parseDictionary(readFileSync(path, 'utf8'));

const ident = (s: string) => {
  const cleaned = s.replace(/[^A-Za-z0-9]/g, '_').replace(/^(\d)/, '_$1');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
};

const lines: string[] = [];
lines.push(`// AUTO-GENERATED from ${path} by fixwire. Do not edit by hand.`);
lines.push('');
lines.push('export const Tag = {');
for (const def of [...dict.byTag.values()].sort((a, b) => a.tag - b.tag)) {
  lines.push(`  ${def.name}: ${def.tag},`);
}
lines.push('} as const;');
lines.push('');

for (const def of [...dict.byTag.values()].sort((a, b) => a.tag - b.tag)) {
  if (!def.values) continue;
  lines.push(`export const ${def.name}Enum = {`);
  for (const [value, description] of Object.entries(def.values)) {
    lines.push(`  ${ident(description)}: '${value}',`);
  }
  lines.push('} as const;');
  lines.push('');
}

// Typed message builders: one function per message, mapping named fields to tags.
const camel = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
lines.push('type Field = [number, string];');
lines.push('');
for (const [msgtype, fields] of dict.messageFields) {
  const name = dict.messages.get(msgtype);
  if (!name) continue;
  const seen = new Set<number>();
  const uniq = fields.filter((f) => !seen.has(f.tag) && seen.add(f.tag));
  const prop = (fieldName: string) => ident(camel(fieldName));
  lines.push(`/** Build a ${name} (35=${msgtype}) message body. */`);
  lines.push(`export function ${ident(camel(name))}(params: {`);
  for (const f of uniq) lines.push(`  ${prop(f.name)}${f.required ? '' : '?'}: string;`);
  lines.push('}): Field[] {');
  lines.push('  const out: Field[] = [];');
  for (const f of uniq) {
    if (f.required) lines.push(`  out.push([${f.tag}, String(params.${prop(f.name)})]);`);
    else
      lines.push(
        `  if (params.${prop(f.name)} !== undefined) out.push([${f.tag}, String(params.${prop(f.name)})]);`,
      );
  }
  lines.push('  return out;');
  lines.push('}');
  lines.push('');
}

process.stdout.write(`${lines.join('\n')}\n`);
