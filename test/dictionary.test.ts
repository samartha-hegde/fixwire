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
  assert.deepEqual(
    rel?.memberTags,
    [55, 48, 555, 600],
    'member set is transitive (nested included)',
  );
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

test('getGroups preserves nested groups (extractable from an entry)', () => {
  const dict = parseDictionary(GROUP_XML);
  const msg = new FixMessage([
    [262, 'req-1'],
    [146, '1'], // one NoRelatedSym entry
    [55, 'BTC/USD'],
    [48, 'X1'],
    [555, '2'], // nested NoLegs = 2
    [600, 'LEG1'],
    [600, 'LEG2'],
  ]);
  const entries = getGroups(msg, 146, dict);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.get(55), 'BTC/USD');
  const legs = getGroups(entries[0] as FixMessage, 555, dict);
  assert.equal(legs.length, 2);
  assert.equal(legs[0]?.get(600), 'LEG1');
  assert.equal(legs[1]?.get(600), 'LEG2');
});

test('parseDictionary expands components for required fields', () => {
  const dict = parseDictionary(
    `<fix>
       <messages>
         <message name="NewOrderSingle" msgtype="D" msgcat="app">
           <field name="ClOrdID" required="Y"/>
           <component name="Instrument" required="Y"/>
         </message>
         <message name="OrderCancelRequest" msgtype="F" msgcat="app">
           <field name="ClOrdID" required="Y"/>
           <component name="Instrument" required="N"/>
         </message>
       </messages>
       <components>
         <component name="Instrument">
           <field name="Symbol" required="Y"/>
           <field name="SecurityID" required="N"/>
         </component>
       </components>
       <fields>
         <field number="11" name="ClOrdID" type="STRING"/>
         <field number="55" name="Symbol" type="STRING"/>
         <field number="48" name="SecurityID" type="STRING"/>
       </fields>
     </fix>`,
  );
  // Required component contributes its required fields.
  assert.deepEqual(dict.required.get('D'), [11, 55]);
  // Optional component downgrades its fields to not required.
  assert.deepEqual(dict.required.get('F'), [11]);
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
