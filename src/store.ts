import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Field } from './message.js';

/**
 * Sequence-number store. FIX requires monotonic, gap-detected sequence numbers
 * that survive a restart; this is the pluggable persistence seam for them.
 */
export interface SeqStore {
  /** Next outbound MsgSeqNum we will send. */
  getNextOut(): number;
  /** Next inbound MsgSeqNum we expect to receive. */
  getNextIn(): number;
  /** Return the current outbound number, then advance by one. */
  incrOut(): number;
  setOut(n: number): void;
  setIn(n: number): void;
  /** Reset both counters to 1 (ResetSeqNumFlag / new session). */
  reset(): void;
}

/** In-memory store. Fine for tests and sessions that reset on every logon. */
export class MemoryStore implements SeqStore {
  private out = 1;
  private in = 1;
  getNextOut(): number {
    return this.out;
  }
  getNextIn(): number {
    return this.in;
  }
  incrOut(): number {
    return this.out++;
  }
  setOut(n: number): void {
    this.out = n;
  }
  setIn(n: number): void {
    this.in = n;
  }
  reset(): void {
    this.out = 1;
    this.in = 1;
  }
}

/** File-backed store. Persists seq numbers across restarts so recovery works. */
export class FileStore implements SeqStore {
  private out = 1;
  private in = 1;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (Number.isInteger(data.out)) this.out = data.out;
        if (Number.isInteger(data.in)) this.in = data.in;
      } catch {
        // Corrupt file - start fresh rather than crash.
      }
    }
  }

  private flush(): void {
    writeFileSync(this.path, JSON.stringify({ out: this.out, in: this.in }));
  }

  getNextOut(): number {
    return this.out;
  }
  getNextIn(): number {
    return this.in;
  }
  incrOut(): number {
    const v = this.out++;
    this.flush();
    return v;
  }
  setOut(n: number): void {
    this.out = n;
    this.flush();
  }
  setIn(n: number): void {
    this.in = n;
    this.flush();
  }
  reset(): void {
    this.out = 1;
    this.in = 1;
    this.flush();
  }
}

/** A sent message retained so it can be retransmitted on a ResendRequest. */
export interface StoredMessage {
  seq: number;
  msgType: string;
  body: Field[];
  sendingTime: string;
}

/**
 * Store of outbound messages, keyed by sequence number, used to answer
 * ResendRequests by replaying application messages (with PossDup).
 */
export interface MessageStore {
  put(msg: StoredMessage): void;
  get(seq: number): StoredMessage | undefined;
  reset(): void;
}

/**
 * In-memory message store. Replays within a process lifetime.
 * ponytail: not persisted - after a restart there is nothing to replay, so the
 * session gap-fills instead. Upgrade path: a file/db-backed MessageStore.
 */
export class MemoryMessageStore implements MessageStore {
  private readonly map = new Map<number, StoredMessage>();
  put(msg: StoredMessage): void {
    this.map.set(msg.seq, msg);
  }
  get(seq: number): StoredMessage | undefined {
    return this.map.get(seq);
  }
  reset(): void {
    this.map.clear();
  }
}

/**
 * File-backed message store. Each sent message is appended as one JSON line, so
 * resend/replay survives a restart. The file is read into memory on construction
 * (later lines win, so a re-sent seq overrides an earlier one).
 */
export class FileMessageStore implements MessageStore {
  private readonly map = new Map<number, StoredMessage>();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as StoredMessage;
          this.map.set(msg.seq, msg);
        } catch {
          // Skip a torn/partial trailing line rather than crash.
        }
      }
    }
  }

  put(msg: StoredMessage): void {
    this.map.set(msg.seq, msg);
    appendFileSync(this.path, `${JSON.stringify(msg)}\n`);
  }

  get(seq: number): StoredMessage | undefined {
    return this.map.get(seq);
  }

  reset(): void {
    this.map.clear();
    writeFileSync(this.path, '');
  }
}
