import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import * as tls from 'node:tls';

export interface TransportOptions {
  host: string;
  port: number;
  /** `true` for default TLS, or pass TLS connection options (CA, cert, servername, ...). */
  tls?: boolean | tls.ConnectionOptions;
}

/** Open a raw TCP or TLS socket to a FIX counterparty. */
export function connect(opts: TransportOptions): net.Socket {
  if (opts.tls) {
    const tlsOpts = typeof opts.tls === 'object' ? opts.tls : {};
    return tls.connect({ host: opts.host, port: opts.port, ...tlsOpts });
  }
  return net.connect({ host: opts.host, port: opts.port });
}

/** Events a {@link Transport} emits. Data frames are decoded to latin1 strings. */
export interface TransportEvents {
  open: [];
  data: [chunk: string];
  close: [];
  error: [err: Error];
}

export interface Transport {
  on<E extends keyof TransportEvents>(
    event: E,
    listener: (...args: TransportEvents[E]) => void,
  ): this;
  once<E extends keyof TransportEvents>(
    event: E,
    listener: (...args: TransportEvents[E]) => void,
  ): this;
  emit<E extends keyof TransportEvents>(event: E, ...args: TransportEvents[E]): boolean;
}

/**
 * Byte pipe for a FIX session, decoupled from the wire medium. The Session reads
 * `data` as latin1 strings and writes with {@link write}. Implementations:
 * {@link TcpTransport} (TCP/TLS) and {@link WebSocketTransport} (browser/Node).
 */
export abstract class Transport extends EventEmitter {
  abstract write(data: string): void;
  abstract close(): void;
}

/** TCP / TLS transport, backed by a Node socket. */
export class TcpTransport extends Transport {
  private readonly socket: net.Socket;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.emit('data', chunk.toString('latin1')));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => this.emit('close'));
  }

  /** Dial a counterparty (initiator). Emits `open` once connected. */
  static dial(opts: TransportOptions): TcpTransport {
    const socket = connect(opts);
    const transport = new TcpTransport(socket);
    socket.once(opts.tls ? 'secureConnect' : 'connect', () => transport.emit('open'));
    return transport;
  }

  write(data: string): void {
    this.socket.write(data, 'latin1');
  }

  close(): void {
    this.socket.destroy();
  }
}

interface WsEvent {
  data?: unknown;
}
interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (ev: WsEvent) => void,
  ): void;
}
type WebSocketCtor = new (url: string) => MinimalWebSocket;

function toLatin1(data: unknown): string {
  if (typeof data === 'string') return data;
  const decoder = new TextDecoder('latin1');
  if (data instanceof ArrayBuffer) return decoder.decode(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return String(data);
}

/**
 * FIX-over-WebSocket transport, using the global `WebSocket` (browsers, and Node
 * 22+). Each inbound frame is fed to the session's framing parser, so one or many
 * FIX messages per frame both work.
 *
 * ponytail: binary `Blob` frames (browser-only) are not decoded; FIX-over-WS
 * normally uses text frames. Use binary (ArrayBuffer) or text and this is fine.
 */
export class WebSocketTransport extends Transport {
  private readonly ws: MinimalWebSocket;

  constructor(url: string) {
    super();
    const Ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) {
      throw new Error('global WebSocket is not available (needs a browser or Node.js 22+)');
    }
    const ws = new Ctor(url);
    this.ws = ws;
    ws.addEventListener('open', () => this.emit('open'));
    ws.addEventListener('message', (ev) => this.emit('data', toLatin1(ev.data)));
    ws.addEventListener('close', () => this.emit('close'));
    ws.addEventListener('error', () => this.emit('error', new Error('websocket error')));
  }

  write(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}
