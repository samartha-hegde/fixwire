import { SOH, Tag } from './constants.js';

/** A single FIX field: `[tag, value]`. */
export type Field = [number, string];

/** A parsed FIX message. Preserves field order and repeats; `get` returns the first occurrence. */
export class FixMessage {
  readonly fields: Field[];
  /** The raw wire string this was parsed from, when available. */
  readonly raw?: string;
  // The index is built lazily: small messages read a few times just scan the
  // field array (no allocation); large or heavily-read messages memoize a Map.
  private index?: Map<number, string>;
  private reads = 0;

  constructor(fields: Field[] = [], raw?: string) {
    this.fields = fields;
    this.raw = raw;
  }

  get(tag: number): string | undefined {
    if (this.index) return this.index.get(tag);
    const fields = this.fields;
    if (fields.length > 32 || ++this.reads > 8) {
      const index = new Map<number, string>();
      for (const [t, v] of fields) {
        if (!index.has(t)) index.set(t, v);
      }
      this.index = index;
      return index.get(tag);
    }
    for (const [t, v] of fields) {
      if (t === tag) return v;
    }
    return undefined;
  }

  getInt(tag: number): number | undefined {
    const v = this.get(tag);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  get msgType(): string | undefined {
    return this.get(Tag.MsgType);
  }

  get seqNum(): number | undefined {
    return this.getInt(Tag.MsgSeqNum);
  }

  toString(): string {
    return this.fields.map(([t, v]) => `${t}=${v}`).join('|');
  }
}

/** Mod-256 checksum of `s`, as a zero-padded 3-digit string. */
export function checksum(s: string): string {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return String(sum % 256).padStart(3, '0');
}

/**
 * Encode fields into a complete FIX wire string.
 * `fields` must start with tag 35 (MsgType) and include all body fields in order,
 * EXCLUDING 8 (BeginString), 9 (BodyLength) and 10 (CheckSum) - those are added here.
 */
export function encode(fields: Field[], beginString = 'FIX.4.4'): string {
  const body = fields.map(([t, v]) => `${t}=${v}`).join(SOH) + SOH;
  const head = `${Tag.BeginString}=${beginString}${SOH}${Tag.BodyLength}=${body.length}${SOH}`;
  const partial = head + body;
  return `${partial}${Tag.CheckSum}=${checksum(partial)}${SOH}`;
}

/** Parse one complete raw FIX string into a {@link FixMessage}. */
export function parse(raw: string): FixMessage {
  const fields: Field[] = [];
  for (const part of raw.split(SOH)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    fields.push([Number(part.slice(0, eq)), part.slice(eq + 1)]);
  }
  return new FixMessage(fields, raw);
}

const CHECKSUM_FIELD_LEN = '10=000\x01'.length; // "10=" + 3 digits + SOH

/**
 * Verify the trailing CheckSum (tag 10) of a complete raw FIX message.
 * Assumes standard framing: the message ends with `10=NNN<SOH>`.
 */
export function isChecksumValid(raw: string): boolean {
  if (raw.length < CHECKSUM_FIELD_LEN) return false;
  const body = raw.slice(0, raw.length - CHECKSUM_FIELD_LEN);
  const declared = raw.slice(raw.length - 4, raw.length - 1);
  return checksum(body) === declared;
}

/** Default cap on a single buffered FIX message (64 KiB). Override via {@link FixParser}. */
export const DEFAULT_MAX_MESSAGE_SIZE = 64 * 1024;

/**
 * Streaming parser. TCP delivers partial/batched messages; feed raw chunks via
 * {@link append} and it emits only complete messages, framing them by BodyLength.
 *
 * To bound memory against a hostile or malformed peer (a stream that never
 * completes a message, or an over-large declared BodyLength), the buffer is
 * capped at `maxMessageSize`; exceeding it resets the buffer and throws.
 */
export class FixParser {
  private buf = '';
  private readonly maxMessageSize: number;

  constructor(maxMessageSize: number = DEFAULT_MAX_MESSAGE_SIZE) {
    this.maxMessageSize = maxMessageSize;
  }

  append(chunk: string): FixMessage[] {
    this.buf += chunk;
    const out: FixMessage[] = [];
    for (;;) {
      const msg = this.tryExtract();
      if (!msg) break;
      out.push(msg);
    }
    // Could not frame a message and the buffer has outgrown the cap: the stream
    // is garbage or hostile. Reset so we don't keep growing, and signal.
    if (this.buf.length > this.maxMessageSize) {
      this.buf = '';
      throw new Error(`unframed data exceeds maxMessageSize (${this.maxMessageSize} bytes)`);
    }
    return out;
  }

  private tryExtract(): FixMessage | null {
    const buf = this.buf;

    // A message must start with the BeginString field. If it doesn't, resync.
    if (!buf.startsWith('8=')) {
      const resync = buf.indexOf(`${SOH}8=`);
      if (resync === -1) return null;
      this.buf = buf.slice(resync + 1);
      return this.tryExtract();
    }

    // Locate the BodyLength field (9=...) - its value frames the rest of the message.
    const blStart = buf.indexOf(`${SOH}9=`);
    if (blStart === -1) return null;
    const valStart = blStart + 3; // past SOH + "9="
    const valEnd = buf.indexOf(SOH, valStart);
    if (valEnd === -1) return null;

    const bodyLen = Number(buf.slice(valStart, valEnd));
    if (!Number.isInteger(bodyLen) || bodyLen < 0) {
      // Corrupt length - skip this BeginString and resync on the next one.
      this.buf = buf.slice(valEnd + 1);
      return this.tryExtract();
    }

    const bodyStart = valEnd + 1;
    const msgEnd = bodyStart + bodyLen + CHECKSUM_FIELD_LEN;
    if (msgEnd > this.maxMessageSize) {
      this.buf = '';
      throw new Error(
        `declared BodyLength ${bodyLen} exceeds maxMessageSize (${this.maxMessageSize} bytes)`,
      );
    }
    if (buf.length < msgEnd) return null; // not fully arrived yet

    const raw = buf.slice(0, msgEnd);
    this.buf = buf.slice(msgEnd);
    return parse(raw);
  }
}
