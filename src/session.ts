import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { MsgType, Tag } from './constants.js';
import type { Dictionary } from './dictionary.js';
import { encode, type Field, type FixMessage, FixParser, isChecksumValid } from './message.js';
import { MemoryMessageStore, MemoryStore, type MessageStore, type SeqStore } from './store.js';
import { connect as openSocket, type TransportOptions } from './transport.js';

export interface ReconnectOptions {
  /** Delay before the first retry, default 1000ms. */
  initialDelayMs?: number;
  /** Ceiling for the exponential backoff, default 30000ms. */
  maxDelayMs?: number;
  /** Max consecutive attempts before giving up; omit for unlimited. */
  maxRetries?: number;
}

export interface SessionConfig {
  senderCompId: string;
  targetCompId: string;
  host: string;
  port: number;
  tls?: TransportOptions['tls'];
  /** FIX version string, default "FIX.4.4". Use "FIXT.1.1" for FIX 5.x. */
  beginString?: string;
  /**
   * DefaultApplVerID (1137) sent on Logon for FIXT.1.1 sessions, e.g. "9" for
   * FIX 5.0 SP2. Required when `beginString` is "FIXT.1.1".
   */
  defaultApplVerId?: string;
  /** Heartbeat interval in seconds, default 30. */
  heartBtInt?: number;
  /** Send ResetSeqNumFlag (141=Y) on logon and reset local counters to 1. */
  resetOnLogon?: boolean;
  /** Reconnect automatically on unexpected disconnect. `true` uses defaults. */
  reconnect?: boolean | ReconnectOptions;
  /** Sequence-number store, default in-memory. */
  store?: SeqStore;
  /** Outbound message store for resend/replay, default in-memory. */
  messageStore?: MessageStore;
  /** Username (553) sent on Logon. */
  username?: string;
  /** Password (554) sent on Logon. */
  password?: string;
  /** RawData (96) sent on Logon; RawDataLength (95) is computed. */
  rawData?: string;
  /** FIX dictionary; enables {@link validateRequired} and dictionary-aware tooling. */
  dictionary?: Dictionary;
  /** Validate that inbound application messages carry their required fields (needs `dictionary`). */
  validateRequired?: boolean;
  /**
   * Acceptor only: validate an inbound Logon (credentials, CompID) and return
   * false to reject it. Set by {@link Acceptor}; not used by initiators.
   */
  authenticate?: (logon: FixMessage) => boolean;
}

type State = 'disconnected' | 'connecting' | 'logon-sent' | 'active' | 'logout-sent';

/** Session-level (admin) message types - never retransmitted; gap-filled instead. */
const ADMIN = new Set<string>([
  MsgType.Heartbeat,
  MsgType.TestRequest,
  MsgType.ResendRequest,
  MsgType.Reject,
  MsgType.SequenceReset,
  MsgType.Logout,
  MsgType.Logon,
]);

function utcTimestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
  );
}

/** Typed events emitted by {@link Session}. */
export interface SessionEvents {
  connect: [];
  logon: [msg: FixMessage];
  logout: [msg: FixMessage];
  app: [msg: FixMessage];
  message: [msg: FixMessage];
  reject: [msg: FixMessage];
  sent: [wire: string];
  reconnecting: [attempt: number, delayMs: number];
  close: [];
  error: [err: Error];
}

// Typed EventEmitter surface via declaration merging.
export interface Session {
  on<E extends keyof SessionEvents>(event: E, listener: (...args: SessionEvents[E]) => void): this;
  once<E extends keyof SessionEvents>(
    event: E,
    listener: (...args: SessionEvents[E]) => void,
  ): this;
  off<E extends keyof SessionEvents>(event: E, listener: (...args: SessionEvents[E]) => void): this;
  emit<E extends keyof SessionEvents>(event: E, ...args: SessionEvents[E]): boolean;
}

/**
 * FIX initiator session. Owns the session state machine: logon, heartbeats,
 * test requests, sequence tracking, gap detection (ResendRequest),
 * SequenceReset / gap-fill handling, inbound validation, and reconnect.
 */
export class Session extends EventEmitter {
  private readonly cfg: Required<
    Omit<
      SessionConfig,
      | 'tls'
      | 'store'
      | 'messageStore'
      | 'reconnect'
      | 'defaultApplVerId'
      | 'username'
      | 'password'
      | 'rawData'
      | 'dictionary'
      | 'validateRequired'
      | 'authenticate'
    >
  > &
    Pick<
      SessionConfig,
      | 'tls'
      | 'defaultApplVerId'
      | 'username'
      | 'password'
      | 'rawData'
      | 'dictionary'
      | 'validateRequired'
      | 'authenticate'
    >;
  private readonly reconnectCfg: ReconnectOptions | null;
  private readonly store: SeqStore;
  private readonly messages: MessageStore;
  private parser = new FixParser();
  private socket?: Socket;
  private state: State = 'disconnected';
  private role: 'initiator' | 'acceptor' = 'initiator';

  private timer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  private lastSent = 0;
  private lastRecv = 0;
  private testReqOutstanding = false;
  private testReqCounter = 0;

  constructor(config: SessionConfig) {
    super();
    this.cfg = {
      senderCompId: config.senderCompId,
      targetCompId: config.targetCompId,
      host: config.host,
      port: config.port,
      tls: config.tls,
      beginString: config.beginString ?? 'FIX.4.4',
      defaultApplVerId: config.defaultApplVerId,
      heartBtInt: config.heartBtInt ?? 30,
      resetOnLogon: config.resetOnLogon ?? false,
      username: config.username,
      password: config.password,
      rawData: config.rawData,
      dictionary: config.dictionary,
      validateRequired: config.validateRequired,
      authenticate: config.authenticate,
    };
    this.reconnectCfg = config.reconnect
      ? typeof config.reconnect === 'object'
        ? config.reconnect
        : {}
      : null;
    this.store = config.store ?? new MemoryStore();
    this.messages = config.messageStore ?? new MemoryMessageStore();
  }

  /** Current session state. */
  get status(): State {
    return this.state;
  }

  /** Open the socket and begin the logon handshake. */
  connect(): void {
    this.intentionalClose = false;
    this.state = 'connecting';
    this.parser = new FixParser();
    const socket = openSocket({ host: this.cfg.host, port: this.cfg.port, tls: this.cfg.tls });
    this.socket = socket;

    const ready = () => {
      if (this.state !== 'connecting') return;
      this.emit('connect');
      this.sendLogon();
    };
    socket.once(this.cfg.tls ? 'secureConnect' : 'connect', ready);
    socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('latin1')));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => this.onClose());
  }

  /**
   * Run this session as an acceptor over an already-connected socket, waiting
   * for the counterparty's Logon rather than initiating. Used by {@link Acceptor}.
   * @internal
   */
  attach(socket: Socket): void {
    this.role = 'acceptor';
    this.intentionalClose = false;
    this.state = 'connecting';
    this.parser = new FixParser();
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('latin1')));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => this.onClose());
  }

  /**
   * Send an application message. Throws if the session is not active, or (when
   * `validateRequired` + `dictionary` are set) if a required field is missing.
   */
  send(msgType: string, fields: Field[] = []): void {
    if (this.state !== 'active') throw new Error(`cannot send in state "${this.state}"`);
    if (this.cfg.validateRequired && this.cfg.dictionary) {
      const req = this.cfg.dictionary.required.get(msgType);
      if (req) {
        const present = new Set(fields.map(([t]) => t));
        const missing = req.find((t) => !present.has(t));
        if (missing !== undefined) {
          throw new Error(`outbound ${msgType} is missing required field ${missing}`);
        }
      }
    }
    this.sendRaw(msgType, fields);
  }

  /** Initiate a graceful logout. Suppresses auto-reconnect. */
  logout(text?: string): void {
    this.intentionalClose = true;
    this.sendLogout(text);
  }

  /** Tear the socket down immediately. Suppresses auto-reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.stopTimers();
    this.socket?.destroy();
    this.state = 'disconnected';
  }

  // --- outbound ---------------------------------------------------------------

  private sendRaw(
    msgType: string,
    body: Field[] = [],
    opts: { seqNum?: number; possDup?: boolean; origSendingTime?: string } = {},
  ): void {
    const explicit = opts.seqNum !== undefined;
    const seq = opts.seqNum ?? this.store.incrOut();
    const ts = utcTimestamp();
    const header: Field[] = [
      [Tag.MsgType, msgType],
      [Tag.MsgSeqNum, String(seq)],
      [Tag.SenderCompID, this.cfg.senderCompId],
      [Tag.TargetCompID, this.cfg.targetCompId],
      [Tag.SendingTime, ts],
    ];
    if (opts.possDup) {
      header.push([Tag.PossDupFlag, 'Y']);
      header.push([Tag.OrigSendingTime, opts.origSendingTime ?? ts]);
    }
    const wire = encode([...header, ...body], this.cfg.beginString);
    this.socket?.write(wire, 'latin1');
    this.lastSent = Date.now();
    // Retain fresh (non-replay) sends so we can answer a ResendRequest later.
    if (!explicit) this.messages.put({ seq, msgType, body, sendingTime: ts });
    this.emit('sent', wire);
  }

  private sendLogon(): void {
    const body: Field[] = [
      [Tag.EncryptMethod, '0'],
      [Tag.HeartBtInt, String(this.cfg.heartBtInt)],
    ];
    if (this.cfg.resetOnLogon) {
      this.store.reset();
      this.messages.reset();
      body.push([Tag.ResetSeqNumFlag, 'Y']);
    }
    // FIXT.1.1 (FIX 5.x) logon must declare the default application version.
    if (this.cfg.beginString.startsWith('FIXT') && this.cfg.defaultApplVerId !== undefined) {
      body.push([Tag.DefaultApplVerID, this.cfg.defaultApplVerId]);
    }
    this.appendCredentials(body);
    this.state = 'logon-sent';
    this.sendRaw(MsgType.Logon, body);
  }

  /** Append Username/Password/RawData logon credentials, if configured. */
  private appendCredentials(body: Field[]): void {
    if (this.cfg.rawData !== undefined) {
      body.push([Tag.RawDataLength, String(this.cfg.rawData.length)]);
      body.push([Tag.RawData, this.cfg.rawData]);
    }
    if (this.cfg.username !== undefined) body.push([Tag.Username, this.cfg.username]);
    if (this.cfg.password !== undefined) body.push([Tag.Password, this.cfg.password]);
  }

  private sendHeartbeat(testReqId?: string): void {
    this.sendRaw(MsgType.Heartbeat, testReqId ? [[Tag.TestReqID, testReqId]] : []);
  }

  private sendTestRequest(): void {
    const id = String(++this.testReqCounter);
    this.sendRaw(MsgType.TestRequest, [[Tag.TestReqID, id]]);
  }

  private sendResendRequest(beginSeq: number): void {
    // EndSeqNo 0 means "up to infinity" - resend everything from beginSeq.
    this.sendRaw(MsgType.ResendRequest, [
      [Tag.BeginSeqNo, String(beginSeq)],
      [Tag.EndSeqNo, '0'],
    ]);
  }

  private sendReject(
    refSeqNum: number | undefined,
    text: string,
    opts: { reason?: number; refTagId?: number } = {},
  ): void {
    const body: Field[] = [];
    if (refSeqNum !== undefined) body.push([Tag.RefSeqNum, String(refSeqNum)]);
    if (opts.refTagId !== undefined) body.push([Tag.RefTagID, String(opts.refTagId)]);
    if (opts.reason !== undefined) body.push([Tag.SessionRejectReason, String(opts.reason)]);
    body.push([Tag.Text, text]);
    this.sendRaw(MsgType.Reject, body);
  }

  /** SessionRejectReason: required tag missing. */
  private static readonly REQUIRED_TAG_MISSING = 1;

  private sendLogout(text?: string): void {
    this.state = 'logout-sent';
    this.sendRaw(MsgType.Logout, text ? [[Tag.Text, text]] : []);
  }

  // --- inbound ----------------------------------------------------------------

  private onData(chunk: string): void {
    this.lastRecv = Date.now();
    this.testReqOutstanding = false;
    let messages: FixMessage[];
    try {
      messages = this.parser.append(chunk);
    } catch (err) {
      this.emit('error', err as Error);
      return;
    }
    for (const msg of messages) this.onMessage(msg);
  }

  private onMessage(msg: FixMessage): void {
    // Integrity: a bad checksum means corruption - discard without advancing seq.
    if (msg.raw !== undefined && !isChecksumValid(msg.raw)) {
      this.emit('error', new Error(`checksum mismatch, discarding: ${msg.toString()}`));
      return;
    }

    this.emit('message', msg);
    const type = msg.msgType;
    const seq = msg.seqNum;

    if (type === undefined) {
      this.sendReject(seq, 'missing MsgType (35)', {
        reason: Session.REQUIRED_TAG_MISSING,
        refTagId: Tag.MsgType,
      });
      return;
    }

    // BeginString must match the configured version; a mismatch is fatal.
    const beginString = msg.get(Tag.BeginString);
    if (beginString !== undefined && beginString !== this.cfg.beginString) {
      this.sendLogout(`incorrect BeginString, expected ${this.cfg.beginString} got ${beginString}`);
      this.disconnect();
      return;
    }

    // Identity: the counterparty's comp IDs must mirror ours.
    if (!this.compIdsMatch(msg)) {
      this.sendLogout('CompID mismatch');
      this.disconnect();
      return;
    }

    // Required standard header tags.
    if (msg.get(Tag.SendingTime) === undefined) {
      this.sendReject(seq, 'missing SendingTime (52)', {
        reason: Session.REQUIRED_TAG_MISSING,
        refTagId: Tag.SendingTime,
      });
      return;
    }
    if (seq === undefined) {
      this.sendReject(undefined, 'missing MsgSeqNum (34)', {
        reason: Session.REQUIRED_TAG_MISSING,
        refTagId: Tag.MsgSeqNum,
      });
      return;
    }

    // An acceptor's first message must be a Logon.
    if (this.role === 'acceptor' && this.state === 'connecting' && type !== MsgType.Logon) {
      this.sendLogout('expected Logon');
      this.disconnect();
      return;
    }

    // A Logon with ResetSeqNumFlag tells us the counterparty's sequence restarts
    // at 1, so our inbound expectation resets before the gap check runs.
    if (type === MsgType.Logon && msg.get(Tag.ResetSeqNumFlag) === 'Y') {
      this.store.setIn(1);
    }

    // SequenceReset may legitimately jump the sequence; handle before the gap check.
    if (type === MsgType.SequenceReset) {
      this.handleSequenceReset(msg);
      return;
    }

    const expected = this.store.getNextIn();
    if (seq !== undefined) {
      if (seq > expected) {
        // Gap: accept a logon first (session must come up), then ask for a resend.
        if (type === MsgType.Logon) this.onLogon(msg);
        this.sendResendRequest(expected);
        return;
      }
      if (seq < expected) {
        if (msg.get(Tag.PossDupFlag) === 'Y') return; // already processed, ignore
        this.sendLogout(`MsgSeqNum too low, expecting ${expected} but received ${seq}`);
        this.disconnect();
        return;
      }
      this.store.setIn(expected + 1); // in-sequence - advance
    }

    switch (type) {
      case MsgType.Logon:
        this.onLogon(msg);
        break;
      case MsgType.Heartbeat:
        break;
      case MsgType.TestRequest:
        this.sendHeartbeat(msg.get(Tag.TestReqID));
        break;
      case MsgType.ResendRequest:
        this.handleResendRequest(msg);
        break;
      case MsgType.Logout:
        this.onLogout(msg);
        break;
      case MsgType.Reject:
        this.emit('reject', msg);
        break;
      default:
        if (this.checkRequired(msg, type)) this.emit('app', msg);
        break;
    }
  }

  private compIdsMatch(msg: FixMessage): boolean {
    const sender = msg.get(Tag.SenderCompID);
    const target = msg.get(Tag.TargetCompID);
    // Skip the sender check until a multi-counterparty acceptor learns the CompID.
    if (sender !== undefined && this.cfg.targetCompId !== '' && sender !== this.cfg.targetCompId) {
      return false;
    }
    if (target !== undefined && target !== this.cfg.senderCompId) return false;
    return true;
  }

  /** Dictionary-driven required-field check for an application message. */
  private checkRequired(msg: FixMessage, msgType: string): boolean {
    if (!this.cfg.validateRequired || !this.cfg.dictionary) return true;
    const req = this.cfg.dictionary.required.get(msgType);
    if (!req) return true;
    for (const tag of req) {
      if (msg.get(tag) === undefined) {
        this.sendReject(msg.seqNum, `missing required field ${tag} for ${msgType}`, {
          reason: Session.REQUIRED_TAG_MISSING,
          refTagId: tag,
        });
        return false;
      }
    }
    return true;
  }

  private onLogon(msg: FixMessage): void {
    if (this.role === 'acceptor' && !this.acceptLogon(msg)) return; // rejected
    this.state = 'active';
    this.reconnectAttempts = 0;
    this.startTimers();
    this.emit('logon', msg);
  }

  /**
   * Acceptor-side logon: authenticate and learn the counterparty, adopt the
   * initiator's terms, and reply with our Logon. Returns false if rejected.
   */
  private acceptLogon(msg: FixMessage): boolean {
    const sender = msg.get(Tag.SenderCompID);
    // Enforce a configured counterparty, or learn it (multi-counterparty acceptor).
    if (this.cfg.targetCompId !== '' && sender !== undefined && sender !== this.cfg.targetCompId) {
      this.sendLogout('unknown counterparty');
      this.disconnect();
      return false;
    }
    if (this.cfg.authenticate && !this.cfg.authenticate(msg)) {
      this.sendLogout('authentication failed');
      this.disconnect();
      return false;
    }
    if (sender !== undefined) this.cfg.targetCompId = sender; // learn or confirm

    const reset = msg.get(Tag.ResetSeqNumFlag) === 'Y';
    const hb = msg.getInt(Tag.HeartBtInt);
    if (hb !== undefined && hb > 0) this.cfg.heartBtInt = hb;
    if (reset) {
      this.store.setOut(1);
      this.messages.reset();
    }
    const body: Field[] = [
      [Tag.EncryptMethod, '0'],
      [Tag.HeartBtInt, String(this.cfg.heartBtInt)],
    ];
    if (reset) body.push([Tag.ResetSeqNumFlag, 'Y']);
    if (this.cfg.beginString.startsWith('FIXT') && this.cfg.defaultApplVerId !== undefined) {
      body.push([Tag.DefaultApplVerID, this.cfg.defaultApplVerId]);
    }
    this.sendRaw(MsgType.Logon, body);
    return true;
  }

  private onLogout(msg: FixMessage): void {
    if (this.state !== 'logout-sent') this.sendRaw(MsgType.Logout, []); // reply before closing
    this.intentionalClose = true; // a clean logout should not trigger reconnect
    this.emit('logout', msg);
    this.disconnect();
  }

  private handleSequenceReset(msg: FixMessage): void {
    // Both GapFill (123=Y) and Reset forms carry NewSeqNo (36); honor it if it
    // advances our expected inbound sequence. ponytail: we never reset backwards,
    // which rejects malicious/erroneous low resets - the safe default.
    const newSeq = msg.getInt(Tag.NewSeqNo);
    if (newSeq !== undefined && newSeq > this.store.getNextIn()) {
      this.store.setIn(newSeq);
    }
  }

  private handleResendRequest(msg: FixMessage): void {
    const begin = msg.getInt(Tag.BeginSeqNo) ?? 1;
    const endReq = msg.getInt(Tag.EndSeqNo) ?? 0;
    const last = this.store.getNextOut() - 1;
    const end = endReq === 0 || endReq > last ? last : endReq;

    let gapStart: number | null = null;
    const flushGap = (upTo: number) => {
      if (gapStart !== null) {
        this.sendGapFill(gapStart, upTo);
        gapStart = null;
      }
    };

    for (let seq = begin; seq <= end; seq++) {
      const rec = this.messages.get(seq);
      if (rec && !ADMIN.has(rec.msgType)) {
        // A real application message - retransmit it with PossDup.
        flushGap(seq);
        this.sendRaw(rec.msgType, rec.body, {
          seqNum: seq,
          possDup: true,
          origSendingTime: rec.sendingTime,
        });
      } else {
        // Admin message (or not retained) - subsume it into a gap-fill run.
        if (gapStart === null) gapStart = seq;
      }
    }
    flushGap(end + 1);
  }

  private sendGapFill(fromSeq: number, newSeqNo: number): void {
    this.sendRaw(
      MsgType.SequenceReset,
      [
        [Tag.GapFillFlag, 'Y'],
        [Tag.NewSeqNo, String(newSeqNo)],
      ],
      { seqNum: fromSeq, possDup: true },
    );
  }

  // --- heartbeat / liveness ---------------------------------------------------

  private startTimers(): void {
    this.stopTimers();
    this.lastRecv = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }

  private stopTimers(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private tick(): void {
    const now = Date.now();
    const hb = this.cfg.heartBtInt * 1000;
    if (now - this.lastSent >= hb) this.sendHeartbeat();
    if (now - this.lastRecv >= hb * 2) {
      if (!this.testReqOutstanding) {
        this.testReqOutstanding = true;
        this.sendTestRequest();
      } else if (now - this.lastRecv >= hb * 3) {
        // Drop the socket without marking the close intentional so reconnect fires.
        this.emit('error', new Error('heartbeat timeout - no response to TestRequest'));
        this.stopTimers();
        this.socket?.destroy();
      }
    }
  }

  // --- reconnect --------------------------------------------------------------

  private onClose(): void {
    this.stopTimers();
    const wasActive = this.state !== 'disconnected';
    this.state = 'disconnected';
    this.emit('close');
    if (wasActive) this.maybeReconnect();
  }

  private maybeReconnect(): void {
    if (!this.reconnectCfg || this.intentionalClose) return;
    const { initialDelayMs = 1000, maxDelayMs = 30_000, maxRetries } = this.reconnectCfg;
    if (maxRetries !== undefined && this.reconnectAttempts >= maxRetries) {
      this.emit('error', new Error(`reconnect gave up after ${maxRetries} attempts`));
      return;
    }
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
    this.emit('reconnecting', attempt, delay);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionalClose) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
