import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  builtinDictionary,
  describe,
  encode,
  FixMessage,
  getGroups,
  group,
  parse,
  parseDictionary,
} from '../src/index.js';

const GROUP_XML = `
<fix major="4" minor="4">
  <messages>
    <message name="MarketDataRequest" msgtype="V" msgcat="app">
      <field name="MDReqID" required="Y"/>
      <field name="SubscriptionRequestType" required="Y"/>
      <group name="NoRelatedSym" required="Y">
        <field name="Symbol" required="Y"/>
        <field name="SecurityID" required="N"/>
        <group name="NoLegs" required="N">
          <field name="LegSymbol" required="N"/>
        </group>
      </group>
    </message>
  </messages>
  <fields>
    <field number="146" name="NoRelatedSym" type="NUMINGROUP"/>
    <field number="555" name="NoLegs" type="NUMINGROUP"/>
    <field number="600" name="LegSymbol" type="STRING"/>
    <field number="55" name="Symbol" type="STRING"/>
    <field number="48" name="SecurityID" type="STRING"/>
    <field number="262" name="MDReqID" type="STRING"/>
    <field number="263" name="SubscriptionRequestType" type="CHAR"/>
  </fields>
</fix>`;

test('parseDictionary extracts group specs, including nested groups innermost-out', () => {
  const dict = parseDictionary(GROUP_XML);
  const rel = dict.groups.get(146);
  assert.equal(rel?.delimiterTag, 55, 'first member is the delimiter');
  assert.deepEqual(rel?.memberTags, [55, 48, 555], 'nested group count tag is a member');
  const legs = dict.groups.get(555);
  assert.deepEqual(legs?.memberTags, [600]);
});

test('parseDictionary records top-level required fields, excluding group members', () => {
  const dict = parseDictionary(GROUP_XML);
  assert.deepEqual(dict.required.get('V'), [262, 263]);
});

test('getGroups extracts repeating-group entries', () => {
  const dict = parseDictionary(GROUP_XML);
  const msg = new FixMessage([
    [262, 'req-1'],
    [146, '2'],
    [55, 'BTC/USD'],
    [48, 'X1'],
    [55, 'ETH/USD'],
    [48, 'X2'],
  ]);
  const entries = getGroups(msg, 146, dict);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.get(55), 'BTC/USD');
  assert.equal(entries[0]?.get(48), 'X1');
  assert.equal(entries[1]?.get(55), 'ETH/USD');
});

test('group builds count + repeated entry fields', () => {
  const fields = group(146, [[[55, 'BTC/USD']], [[55, 'ETH/USD']]]);
  assert.deepEqual(fields, [
    [146, '2'],
    [55, 'BTC/USD'],
    [55, 'ETH/USD'],
  ]);
});

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
