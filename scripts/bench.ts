// Micro-benchmark for fixwire's hot paths: parse, encode, and streaming framing.
// Run: npm run bench
import { encode, type Field, FixParser, parse } from '../src/index.js';

// A realistic ExecutionReport (~19 fields, ~200 bytes on the wire).
const body: Field[] = [
  [35, '8'],
  [34, '12345'],
  [49, 'VENUE'],
  [56, 'CLIENT'],
  [52, '20260101-12:00:00.000'],
  [37, 'ORD-00001'],
  [17, 'EXEC-00001'],
  [150, 'F'],
  [39, '2'],
  [55, 'BTC/USD'],
  [54, '1'],
  [38, '10'],
  [44, '65000.50'],
  [32, '10'],
  [31, '65000.50'],
  [151, '0'],
  [14, '10'],
  [6, '65000.50'],
  [60, '20260101-12:00:00.000'],
];
const raw = encode(body);

function bench(name: string, fn: () => number, iters: number): void {
  for (let i = 0; i < 100_000; i++) fn(); // warm up the JIT
  let sink = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) sink += fn();
  const t1 = process.hrtime.bigint();
  if (sink === -1) console.log(''); // defeat dead-code elimination
  const ns = Number(t1 - t0) / iters;
  const perSec = 1e9 / ns;
  console.log(
    `${name.padEnd(28)} ${ns.toFixed(0).padStart(5)} ns/op   ${(perSec / 1e6).toFixed(2)} M ops/sec`,
  );
}

const N = 2_000_000;
console.log(`message: ${raw.length} bytes, ${body.length} fields\n`);

// parse: raw string -> FixMessage, then read two fields (typical usage)
bench(
  'parse + read 2 fields',
  () => {
    const m = parse(raw);
    return (m.get(11) ? 1 : 0) + (m.getInt(34) ?? 0);
  },
  N,
);

// encode: fields -> wire string
bench('encode', () => encode(body).length, N);

// streaming parse (reuse one parser, feed one framed message per call)
const parser = new FixParser();
bench('FixParser.append (1 msg)', () => parser.append(raw).length, N);
