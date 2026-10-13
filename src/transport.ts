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
