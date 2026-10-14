import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { Dictionary } from './dictionary.js';
import type { FixMessage } from './message.js';
import { Session } from './session.js';
import { MemoryMessageStore, MemoryStore, type MessageStore, type SeqStore } from './store.js';

export interface AcceptorConfig {
  /** Our CompID (the acceptor). */
  senderCompId: string;
  /**
   * The expected initiator's CompID. Inbound messages are validated against it.
   * Omit to accept any counterparty and learn its CompID from the Logon
   * (combine with `authenticate` to gate who may connect).
   */
  targetCompId?: string;
  port: number;
  host?: string;
  /** TLS server options (key/cert). Omit for plain TCP. */
  tls?: tls.TlsOptions;
  /** FIX version string, default "FIX.4.4". */
  beginString?: string;
  /** DefaultApplVerID (1137) to echo on FIXT.1.1 logon. */
  defaultApplVerId?: string;
  /** Fallback heartbeat interval if the initiator does not specify one. */
  heartBtInt?: number;
  /** Validate an inbound Logon (credentials, CompID). Return false to reject. */
  authenticate?: (logon: FixMessage) => boolean;
  /** FIX dictionary shared across connections (enables `validateRequired`). */
  dictionary?: Dictionary;
  /** Validate inbound application messages against the dictionary's required fields. */
  validateRequired?: boolean;
  /** Factory for a fresh sequence store per connection. Default: in-memory. */
  createStore?: () => SeqStore;
  /** Factory for a fresh message store per connection. Default: in-memory. */
  createMessageStore?: () => MessageStore;
}

/** Typed events emitted by {@link Acceptor}. */
export interface AcceptorEvents {
  listening: [];
  /** A new connection arrived; attach handlers to the session before it logs on. */
  session: [session: Session];
  close: [];
  error: [err: Error];
}

export interface Acceptor {
  on<E extends keyof AcceptorEvents>(
    event: E,
    listener: (...args: AcceptorEvents[E]) => void,
  ): this;
  once<E extends keyof AcceptorEvents>(
    event: E,
    listener: (...args: AcceptorEvents[E]) => void,
  ): this;
  off<E extends keyof AcceptorEvents>(
    event: E,
    listener: (...args: AcceptorEvents[E]) => void,
  ): this;
  emit<E extends keyof AcceptorEvents>(event: E, ...args: AcceptorEvents[E]): boolean;
}

/**
 * A FIX acceptor (server). Listens for initiators, and for each connection runs
 * a {@link Session} in acceptor role that validates and replies to the Logon,
 * then drives the same session state machine as the initiator side.
 *
 * Emits a `session` event per connection so you can wire handlers before logon.
 */
export class Acceptor extends EventEmitter {
  private readonly cfg: AcceptorConfig;
  private server?: net.Server;

  constructor(config: AcceptorConfig) {
    super();
    this.cfg = config;
  }

  listen(): void {
    const onConnection = (socket: net.Socket) => this.onConnection(socket);
    this.server = this.cfg.tls
      ? tls.createServer(this.cfg.tls, onConnection)
      : net.createServer(onConnection);
    this.server.on('error', (err) => this.emit('error', err));
    this.server.listen(this.cfg.port, this.cfg.host, () => this.emit('listening'));
  }

  /** The bound port (useful when listening on port 0 in tests). */
  get port(): number | undefined {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? addr.port : undefined;
  }

  close(): void {
    this.server?.close(() => this.emit('close'));
  }

  private onConnection(socket: net.Socket): void {
    const session = new Session({
      senderCompId: this.cfg.senderCompId,
      targetCompId: this.cfg.targetCompId ?? '', // empty => learn from Logon
      host: '', // unused: the socket is already connected
      port: 0,
      beginString: this.cfg.beginString,
      defaultApplVerId: this.cfg.defaultApplVerId,
      heartBtInt: this.cfg.heartBtInt,
      authenticate: this.cfg.authenticate,
      dictionary: this.cfg.dictionary,
      validateRequired: this.cfg.validateRequired,
      store: (this.cfg.createStore ?? (() => new MemoryStore()))(),
      messageStore: (this.cfg.createMessageStore ?? (() => new MemoryMessageStore()))(),
    });
    this.emit('session', session);
    session.attach(socket);
  }
}
