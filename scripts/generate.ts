/**
 * Generate typed FIX constants from a QuickFIX data dictionary.
 *
 *   npm run generate -- path/to/FIX44.xml > src/fix44.ts
 *
 * Emits a `Tag` map of every field name -> tag number, plus a `<Field>Enum`
 * object for each enumerated field. Dependency-free; uses the dictionary parser.
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

process.stdout.write(`${lines.join('\n')}\n`);
