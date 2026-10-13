import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, parse, checksum, isChecksumValid, FixParser, SOH, Tag } from '../src/index.js';

test('isChecksumValid accepts a real message and rejects a tampered one', () => {
  const wire = encode([
    [35, '0'],
    [49, 'A'],
    [56, 'B'],
    [34, '1'],
  ]);
  assert.ok(isChecksumValid(wire));
  // Flip the checksum digits - must now be rejected.
  const tampered = wire.slice(0, -4) + 'XXX' + SOH;
  assert.equal(isChecksumValid(tampered), false);
});

test('checksum matches a known FIX vector', () => {
  // Canonical QuickFIX example message; its checksum is 062.
  const fields: [number, string][] = [
    [35, 'A'],
    [49, 'SERVER'],
    [56, 'CLIENT'],
    [34, '177'],
    [52, '20090107-18:15:16'],
    [98, '0'],
    [108, '30'],
  ];
  const wire = encode(fields, 'FIX.4.2');
  assert.ok(wire.includes(`${SOH}9=65${SOH}`), 'BodyLength should be 65');
  assert.ok(
    wire.endsWith(`10=062${SOH}`),
    `expected checksum 062, got: ${wire.replace(/\x01/g, '|')}`,
  );
});

test('encode then parse round-trips the body fields', () => {
  const fields: [number, string][] = [
    [35, 'D'],
    [49, 'ME'],
    [56, 'THEM'],
    [34, '1'],
    [11, 'order-1'],
    [55, 'BTC/USD'],
    [54, '1'],
    [38, '2'],
  ];
  const msg = parse(encode(fields));
  assert.equal(msg.msgType, 'D');
  assert.equal(msg.get(Tag.ClOrdID), 'order-1');
  assert.equal(msg.get(Tag.Symbol), 'BTC/USD');
  assert.equal(msg.getInt(Tag.MsgSeqNum), 1);
  // Header fields the encoder adds must be present and consistent.
  assert.equal(msg.get(Tag.BeginString), 'FIX.4.4');
});

test('streaming parser frames split and batched messages', () => {
  const a = encode([
    [35, '0'],
    [49, 'A'],
    [56, 'B'],
    [34, '1'],
  ]);
  const b = encode([
    [35, '0'],
    [49, 'A'],
    [56, 'B'],
    [34, '2'],
  ]);
  const parser = new FixParser();

  // Two messages arriving in one chunk.
  assert.equal(parser.append(a + b).length, 2);

  // One message split across three chunks - nothing emitted until complete.
  const mid = Math.floor(a.length / 2);
  assert.equal(parser.append(a.slice(0, mid)).length, 0);
  assert.equal(parser.append(a.slice(mid, a.length - 2)).length, 0);
  const done = parser.append(a.slice(a.length - 2));
  assert.equal(done.length, 1);
  assert.equal(done[0]?.seqNum, 1);
});
