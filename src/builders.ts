import { MsgType, Tag } from './constants.js';
import type { Field } from './message.js';

/** Side (tag 54) values. */
export const Side = {
  Buy: '1',
  Sell: '2',
} as const;
export type Side = (typeof Side)[keyof typeof Side];

/** OrdType (tag 40) values. */
export const OrdType = {
  Market: '1',
  Limit: '2',
  Stop: '3',
  StopLimit: '4',
} as const;
export type OrdType = (typeof OrdType)[keyof typeof OrdType];

/** Common DefaultApplVerID (tag 1137) values for FIXT.1.1 sessions. */
export const ApplVerID = {
  FIX40: '2',
  FIX41: '3',
  FIX42: '4',
  FIX43: '5',
  FIX44: '6',
  FIX50: '7',
  FIX50SP1: '8',
  FIX50SP2: '9',
} as const;
export type ApplVerID = (typeof ApplVerID)[keyof typeof ApplVerID];

/** TimeInForce (tag 59) values. */
export const TimeInForce = {
  Day: '0',
  GoodTillCancel: '1',
  ImmediateOrCancel: '3',
  FillOrKill: '4',
} as const;
export type TimeInForce = (typeof TimeInForce)[keyof typeof TimeInForce];

export interface NewOrderSingleParams {
  clOrdId: string;
  symbol: string;
  side: Side;
  orderQty: number | string;
  ordType: OrdType;
  /** Required for Limit / StopLimit orders. */
  price?: number | string;
  timeInForce?: TimeInForce;
}

const TAG_TIME_IN_FORCE = 59;

/**
 * Build the body fields for a NewOrderSingle (35=D). Pass the result straight to
 * `session.send(MsgType.NewOrderSingle, ...)`.
 *
 * @example
 * session.send(MsgType.NewOrderSingle, newOrderSingle({
 *   clOrdId: 'o-1', symbol: 'BTC/USD', side: Side.Buy,
 *   orderQty: 1, ordType: OrdType.Limit, price: 65000,
 * }));
 */
export function newOrderSingle(p: NewOrderSingleParams): Field[] {
  const fields: Field[] = [
    [Tag.ClOrdID, p.clOrdId],
    [Tag.Symbol, p.symbol],
    [Tag.Side, p.side],
    [Tag.OrderQty, String(p.orderQty)],
    [Tag.OrdType, p.ordType],
  ];
  if (p.price !== undefined) fields.push([Tag.Price, String(p.price)]);
  if (p.timeInForce !== undefined) fields.push([TAG_TIME_IN_FORCE, p.timeInForce]);
  return fields;
}

/** Re-exported for convenience alongside the builders. */
export { MsgType };
