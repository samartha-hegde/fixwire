import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newOrderSingle, OrdType, Side, Tag, TimeInForce } from '../src/index.js';

test('newOrderSingle builds the expected fields', () => {
  const fields = newOrderSingle({
    clOrdId: 'o-1',
    symbol: 'BTC/USD',
    side: Side.Buy,
    orderQty: 1.5,
    ordType: OrdType.Limit,
    price: 65000,
    timeInForce: TimeInForce.GoodTillCancel,
  });
  const map = new Map(fields);
  assert.equal(map.get(Tag.ClOrdID), 'o-1');
  assert.equal(map.get(Tag.Symbol), 'BTC/USD');
  assert.equal(map.get(Tag.Side), '1');
  assert.equal(map.get(Tag.OrderQty), '1.5');
  assert.equal(map.get(Tag.OrdType), '2');
  assert.equal(map.get(Tag.Price), '65000');
  assert.equal(map.get(59), '1'); // TimeInForce
});

test('newOrderSingle omits price for market orders', () => {
  const fields = newOrderSingle({
    clOrdId: 'o-2',
    symbol: 'ETH/USD',
    side: Side.Sell,
    orderQty: 2,
    ordType: OrdType.Market,
  });
  assert.equal(new Map(fields).has(Tag.Price), false);
});
