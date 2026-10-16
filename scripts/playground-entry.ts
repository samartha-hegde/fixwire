// Codec-only entry for the browser playground bundle. Imports from the pure codec
// modules directly (no node:net / session), so the esbuild bundle has zero Node deps.
export { newOrderSingle, OrdType, Side } from '../src/builders.js';
export { MsgType, SOH, Tag } from '../src/constants.js';
export type { Dictionary } from '../src/dictionary.js';
export {
  builtinDictionary,
  describe,
  getGroups,
  group,
  parseDictionary,
} from '../src/dictionary.js';
export type { Field } from '../src/message.js';
export { checksum, encode, FixMessage, FixParser, isChecksumValid, parse } from '../src/message.js';
