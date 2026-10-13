/**
 * Template for connecting to a real FIX counterparty (initiator).
 *
 * Configure via environment variables and run with tsx:
 *
 *   FIX_HOST=fix.example.com FIX_PORT=9876 \
 *   FIX_SENDER=YOURCOMP FIX_TARGET=VENUE FIX_TLS=1 \
 *   npx tsx examples/venue.ts
 *
 * This only logs on, prints inbound messages, and logs out on SIGINT - a safe
 * starting point for a new integration. It never sends an order on its own.
 */
import { Session } from '../src/index.js';

const { FIX_HOST, FIX_PORT, FIX_SENDER, FIX_TARGET, FIX_TLS, FIX_HEARTBEAT = '30' } = process.env;

if (!FIX_HOST || !FIX_PORT || !FIX_SENDER || !FIX_TARGET) {
  console.error('Set FIX_HOST, FIX_PORT, FIX_SENDER and FIX_TARGET. See the header of this file.');
  process.exit(1);
}

const session = new Session({
  host: FIX_HOST,
  port: Number(FIX_PORT),
  senderCompId: FIX_SENDER,
  targetCompId: FIX_TARGET,
  tls: FIX_TLS === '1' || FIX_TLS === 'true',
  heartBtInt: Number(FIX_HEARTBEAT),
  resetOnLogon: true,
  reconnect: true,
});

session.on('connect', () => console.log(`connected to ${FIX_HOST}:${FIX_PORT}`));
session.on('logon', () => console.log('logged on - session active'));
session.on('message', (msg) => console.log('<-', msg.toString()));
session.on('reconnecting', (attempt, delay) =>
  console.log(`reconnecting (attempt ${attempt}) in ${delay}ms`),
);
session.on('error', (err) => console.error('error:', err.message));
session.on('close', () => console.log('connection closed'));

// Graceful logout on Ctrl-C.
process.on('SIGINT', () => {
  console.log('\nlogging out...');
  session.logout();
  setTimeout(() => process.exit(0), 500);
});

// To send an order once active, import { MsgType, newOrderSingle, Side, OrdType }
// and inside the 'logon' handler:
//   session.send(MsgType.NewOrderSingle, newOrderSingle({
//     clOrdId: `o-${Date.now()}`, symbol: 'BTC/USD',
//     side: Side.Buy, orderQty: 1, ordType: OrdType.Limit, price: 1,
//   }));

session.connect();
