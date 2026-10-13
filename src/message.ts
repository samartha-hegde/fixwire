import { SOH, Tag } from './constants.js';

/** A single FIX field: `[tag, value]`. */
export type Field = [number, string];

/** A parsed FIX message. Preserves field order and repeats; `get` returns the first occurrence. */
export class FixMessage {
  readonly fields: Field[];
  private readonly index: Map<number, string>;

  constructor(fields: Field[] = []) {
    this.fields = fields;
    this.index = new Map();
    for (const [tag, val] of fields) {
      if (!this.index.has(tag)) this.index.set(tag, val);
    }
  }

  get(tag: number): string | undefined {
    return this.index.get(tag);
  }

  getInt(tag: number): number | undefined {
    const v = this.index.get(tag);
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
 * EXCLUDING 8 (BeginString), 9 (BodyLength) and 10 (CheckSum) — those are added here.
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
  return new FixMessage(fields);
}

const CHECKSUM_FIELD_LEN = '10=000\x01'.length; // "10=" + 3 digits + SOH

/**
 * Streaming parser. TCP delivers partial/batched messages; feed raw chunks via
 * {@link append} and it emits only complete messages, framing them by BodyLength.
 */
export class FixParser {
  private buf = '';

  append(chunk: string): FixMessage[] {
    this.buf += chunk;
    const out: FixMessage[] = [];
    for (;;) {
      const msg = this.tryExtract();
      if (!msg) break;
      out.push(msg);
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

    // Locate the BodyLength field (9=...) — its value frames the rest of the message.
    const blStart = buf.indexOf(`${SOH}9=`);
    if (blStart === -1) return null;
    const valStart = blStart + 3; // past SOH + "9="
    const valEnd = buf.indexOf(SOH, valStart);
    if (valEnd === -1) return null;

    const bodyLen = Number(buf.slice(valStart, valEnd));
    if (!Number.isInteger(bodyLen) || bodyLen < 0) {
      // Corrupt length — skip this BeginString and resync on the next one.
      this.buf = buf.slice(valEnd + 1);
      return this.tryExtract();
    }

    const bodyStart = valEnd + 1;
    const msgEnd = bodyStart + bodyLen + CHECKSUM_FIELD_LEN;
    if (buf.length < msgEnd) return null; // not fully arrived yet

    const raw = buf.slice(0, msgEnd);
    this.buf = buf.slice(msgEnd);
    return parse(raw);
  }
}
