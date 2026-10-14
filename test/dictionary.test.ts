import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinDictionary, describe, encode, parse, parseDictionary } from '../src/index.js';

const SAMPLE_XML = `
<fix major="4" minor="4">
  <messages>
    <message name="NewOrderSingle" msgtype="D" msgcat="app"/>
    <message name="Heartbeat" msgtype="0" msgcat="admin"/>
  </messages>
  <fields>
    <field number="11" name="ClOrdID" type="STRING"/>
    <field number="54" name="Side" type="CHAR">
      <value enum="1" description="BUY"/>
      <value enum="2" description="SELL"/>
    </field>
  </fields>
</fix>`;

test('parseDictionary extracts fields, enum values, and messages', () => {
  const dict = parseDictionary(SAMPLE_XML);
  assert.equal(dict.byName.get('ClOrdID'), 11);
  assert.equal(dict.byTag.get(54)?.name, 'Side');
  assert.equal(dict.byTag.get(54)?.values?.['1'], 'BUY');
  assert.equal(dict.messages.get('D'), 'NewOrderSingle');
  assert.equal(dict.messages.get('0'), 'Heartbeat');
});

test('describe renders readable field names and enum labels', () => {
  const dict = parseDictionary(SAMPLE_XML);
  const msg = parse(
    encode([
      [54, '1'],
      [11, 'o-1'],
    ]),
  );
  const text = describe(msg, dict);
  assert.match(text, /Side=1\(BUY\)/);
  assert.match(text, /ClOrdID=o-1/);
});

test('builtinDictionary maps the bundled Tag constants', () => {
  const dict = builtinDictionary();
  assert.equal(dict.byName.get('ClOrdID'), 11);
  assert.equal(dict.byTag.get(35)?.name, 'MsgType');
});
