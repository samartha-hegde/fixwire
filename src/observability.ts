import { Tag } from './constants.js';
import type { FixMessage } from './message.js';
import type { Session } from './session.js';

/**
 * A structured logger. [pino](https://getpino.io) satisfies this directly; so does
 * any logger with these methods. For `console`, pass a small shim.
 */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug?(obj: object, msg?: string): void;
}

export interface AttachLoggerOptions {
  /** Also log every inbound message and outbound wire at debug level (verbose). */
  wire?: boolean;
}

/**
 * Bridge a {@link Session}'s event stream to a structured logger. Logs logon /
 * logout / reject / reconnecting / error / close (and, with `wire`, every message).
 * Returns a detach function that removes the listeners.
 *
 * @example
 * import pino from 'pino';
 * const detach = attachLogger(session, pino());
 */
export function attachLogger(
  session: Session,
  logger: Logger,
  opts: AttachLoggerOptions = {},
): () => void {
  const debug = logger.debug ? logger.debug.bind(logger) : logger.info.bind(logger);

  const onConnect = () => debug({ event: 'connect' }, 'fix: connecting');
  const onLogon = (m: FixMessage) =>
    logger.info({ event: 'logon', msgType: m.msgType }, 'fix: logon');
  const onLogout = () => logger.info({ event: 'logout' }, 'fix: logout');
  const onReject = (m: FixMessage) =>
    logger.warn({ event: 'reject', text: m.get(Tag.Text) }, 'fix: reject');
  const onReconnecting = (attempt: number, delayMs: number) =>
    logger.warn({ event: 'reconnecting', attempt, delayMs }, 'fix: reconnecting');
  const onError = (err: Error) =>
    logger.error({ event: 'error', error: err.message }, 'fix: error');
  const onClose = () => logger.info({ event: 'close' }, 'fix: closed');
  const onSent = (wire: string) => debug({ event: 'sent', wire }, 'fix: sent');
  const onMessage = (m: FixMessage) =>
    debug({ event: 'message', msgType: m.msgType }, 'fix: message');

  session.on('connect', onConnect);
  session.on('logon', onLogon);
  session.on('logout', onLogout);
  session.on('reject', onReject);
  session.on('reconnecting', onReconnecting);
  session.on('error', onError);
  session.on('close', onClose);
  if (opts.wire) {
    session.on('sent', onSent);
    session.on('message', onMessage);
  }

  return () => {
    session.off('connect', onConnect);
    session.off('logon', onLogon);
    session.off('logout', onLogout);
    session.off('reject', onReject);
    session.off('reconnecting', onReconnecting);
    session.off('error', onError);
    session.off('close', onClose);
    session.off('sent', onSent);
    session.off('message', onMessage);
  };
}

/**
 * Bridge a {@link Session}'s event stream to a metrics recorder: a function called
 * with a metric name on each event (`messages_sent`, `messages_received`, `rejects`,
 * `reconnects`, `logons`, `errors`). Wire it to OpenTelemetry, Prometheus, StatsD,
 * etc. Returns a detach function.
 *
 * @example
 * // OpenTelemetry
 * const counter = meter.createCounter('fix_events');
 * attachMetrics(session, (metric) => counter.add(1, { metric }));
 */
export function attachMetrics(session: Session, record: (metric: string) => void): () => void {
  const onSent = () => record('messages_sent');
  const onMessage = () => record('messages_received');
  const onReject = () => record('rejects');
  const onReconnecting = () => record('reconnects');
  const onLogon = () => record('logons');
  const onError = () => record('errors');

  session.on('sent', onSent);
  session.on('message', onMessage);
  session.on('reject', onReject);
  session.on('reconnecting', onReconnecting);
  session.on('logon', onLogon);
  session.on('error', onError);

  return () => {
    session.off('sent', onSent);
    session.off('message', onMessage);
    session.off('reject', onReject);
    session.off('reconnecting', onReconnecting);
    session.off('logon', onLogon);
    session.off('error', onError);
  };
}
