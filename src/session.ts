import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { Tag, MsgType } from './constants.js';
import { FixMessage, FixParser, encode, type Field } from './message.js';
import { connect as openSocket, type TransportOptions } from './transport.js';
import { MemoryStore, type SeqStore } from './store.js';

export interface SessionConfig {
  senderCompId: string;
  targetCompId: string;
  host: string;
  port: number;
  tls?: TransportOptions['tls'];
  /** FIX version string, default "FIX.4.4". */
  beginString?: string;
  /** Heartbeat interval in seconds, default 30. */
  heartBtInt?: number;
  /** Send ResetSeqNumFlag (141=Y) on logon and reset local counters to 1. */
  resetOnLogon?: boolean;
  /** Sequence-number store, default in-memory. */
  store?: SeqStore;
}

type State = 'disconnected' | 'connecting' | 'logon-sent' | 'active' | 'logout-sent';

function utcTimestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * FIX initiator session. Owns the session state machine: logon, heartbeats,
 * test requests, sequence tracking, gap detection (ResendRequest) and
 * SequenceReset / gap-fill handling.
 *
 * Events: `connect`, `logon`, `logout`, `close`, `error`, `app` (application
 * message), `message` (every inbound message, raw firehose), `sent` (wire string).
 */
export class Session extends EventEmitter {
  private readonly cfg: Required<Omit<SessionConfig, 'tls' | 'store'>> & Pick<SessionConfig, 'tls'>;
  private readonly store: SeqStore;
  private readonly parser = new FixParser();
  private socket?: Socket;
  private state: State = 'disconnected';

  private timer?: ReturnType<typeof setInterval>;
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
      heartBtInt: config.heartBtInt ?? 30,
      resetOnLogon: config.resetOnLogon ?? false,
    };
    this.store = config.store ?? new MemoryStore();
  }

  /** Open the socket and begin the logon handshake. */
  connect(): void {
    this.state = 'connecting';
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
    socket.on('close', () => {
      this.stopTimers();
      this.state = 'disconnected';
      this.emit('close');
    });
  }

  /** Send an application message. Throws if the session is not active. */
  send(msgType: string, fields: Field[] = []): void {
    if (this.state !== 'active') throw new Error(`cannot send in state "${this.state}"`);
    this.sendRaw(msgType, fields);
  }

  /** Initiate a graceful logout. */
  logout(text?: string): void {
    this.sendLogout(text);
  }

  /** Tear the socket down immediately. */
  disconnect(): void {
    this.stopTimers();
    this.socket?.destroy();
    this.state = 'disconnected';
  }

  // --- outbound ---------------------------------------------------------------

  private sendRaw(
    msgType: string,
    body: Field[] = [],
    opts: { seqNum?: number; possDup?: boolean } = {},
  ): void {
    const seq = opts.seqNum ?? this.store.incrOut();
    const header: Field[] = [
      [Tag.MsgType, msgType],
      [Tag.MsgSeqNum, String(seq)],
      [Tag.SenderCompID, this.cfg.senderCompId],
      [Tag.TargetCompID, this.cfg.targetCompId],
      [Tag.SendingTime, utcTimestamp()],
    ];
    if (opts.possDup) header.push([Tag.PossDupFlag, 'Y']);
    const wire = encode([...header, ...body], this.cfg.beginString);
    this.socket?.write(wire, 'latin1');
    this.lastSent = Date.now();
    this.emit('sent', wire);
  }

  private sendLogon(): void {
    const body: Field[] = [
      [Tag.EncryptMethod, '0'],
      [Tag.HeartBtInt, String(this.cfg.heartBtInt)],
    ];
    if (this.cfg.resetOnLogon) {
      this.store.reset();
      body.push([Tag.ResetSeqNumFlag, 'Y']);
    }
    this.state = 'logon-sent';
    this.sendRaw(MsgType.Logon, body);
  }

  private sendHeartbeat(testReqId?: string): void {
    this.sendRaw(MsgType.Heartbeat, testReqId ? [[Tag.TestReqID, testReqId]] : []);
  }

  private sendTestRequest(): void {
    const id = String(++this.testReqCounter);
    this.sendRaw(MsgType.TestRequest, [[Tag.TestReqID, id]]);
  }

  private sendResendRequest(beginSeq: number): void {
    // EndSeqNo 0 means "up to infinity" — resend everything from beginSeq.
    this.sendRaw(MsgType.ResendRequest, [
      [Tag.BeginSeqNo, String(beginSeq)],
      [Tag.EndSeqNo, '0'],
    ]);
  }

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
      this.emit('error', err);
      return;
    }
    for (const msg of messages) this.onMessage(msg);
  }

  private onMessage(msg: FixMessage): void {
    this.emit('message', msg);
    const type = msg.msgType;
    const seq = msg.seqNum;

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
        return;
      }
      this.store.setIn(expected + 1); // in-sequence — advance
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
        this.emit('app', msg);
        break;
    }
  }

  private onLogon(msg: FixMessage): void {
    this.state = 'active';
    this.startTimers();
    this.emit('logon', msg);
  }

  private onLogout(msg: FixMessage): void {
    if (this.state !== 'logout-sent') this.sendRaw(MsgType.Logout, []); // reply before closing
    this.emit('logout', msg);
    this.disconnect();
  }

  private handleSequenceReset(msg: FixMessage): void {
    // Both GapFill (123=Y) and Reset forms carry NewSeqNo (36); honor it if it
    // advances our expected inbound sequence. ponytail: we never reset backwards,
    // which rejects malicious/erroneous low resets — the safe default.
    const newSeq = msg.getInt(Tag.NewSeqNo);
    if (newSeq !== undefined && newSeq > this.store.getNextIn()) {
      this.store.setIn(newSeq);
    }
  }

  private handleResendRequest(msg: FixMessage): void {
    // ponytail: v0 keeps no outbound message store, so we honestly gap-fill the
    // requested range instead of replaying. Upgrade path: persist sent app
    // messages and replay them (with PossDup) when a true resend is needed.
    const begin = msg.getInt(Tag.BeginSeqNo) ?? 1;
    const newSeq = this.store.getNextOut();
    this.sendRaw(
      MsgType.SequenceReset,
      [
        [Tag.GapFillFlag, 'Y'],
        [Tag.NewSeqNo, String(newSeq)],
      ],
      { seqNum: begin, possDup: true },
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
        this.emit('error', new Error('heartbeat timeout — no response to TestRequest'));
        this.disconnect();
      }
    }
  }
}
