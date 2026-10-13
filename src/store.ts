import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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
  getNextOut(): number { return this.out; }
  getNextIn(): number { return this.in; }
  incrOut(): number { return this.out++; }
  setOut(n: number): void { this.out = n; }
  setIn(n: number): void { this.in = n; }
  reset(): void { this.out = 1; this.in = 1; }
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
        // Corrupt file — start fresh rather than crash.
      }
    }
  }

  private flush(): void {
    writeFileSync(this.path, JSON.stringify({ out: this.out, in: this.in }));
  }

  getNextOut(): number { return this.out; }
  getNextIn(): number { return this.in; }
  incrOut(): number { const v = this.out++; this.flush(); return v; }
  setOut(n: number): void { this.out = n; this.flush(); }
  setIn(n: number): void { this.in = n; this.flush(); }
  reset(): void { this.out = 1; this.in = 1; this.flush(); }
}
