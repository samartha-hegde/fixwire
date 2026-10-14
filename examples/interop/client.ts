// Shared fixwire interop client. Connects to a FIX acceptor (any engine), logs
// on, sends a NewOrderSingle, expects a filled ExecutionReport, logs out.
// Configure via env: FIX_PORT (default 5101), ENGINE (label for output).
// Exits 0 on success, 1 on any failure (reject, timeout, error).
import { MsgType, OrdType, Session, Side, Tag } from '../../src/index.js';

const PORT = Number(process.env.FIX_PORT ?? '5101');
const ENGINE = process.env.ENGINE ?? 'the acceptor';
const BusinessMessageReject = 'j';

function utcTransactTime(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
  );
}

const session = new Session({
  senderCompId: 'CLIENT',
  targetCompId: 'SERVER',
  host: '127.0.0.1',
  port: PORT,
  resetOnLogon: true,
});

const fail = (msg: string) => {
  console.error('FAIL:', msg);
  process.exit(1);
};
const timer = setTimeout(() => fail('timed out waiting for fill'), 8000);

session.on('error', (e) => fail(`socket/protocol error: ${e.message}`));
session.on('reject', (m) => fail(`session Reject (35=3): ${m.get(Tag.Text) ?? ''}`));

session.on('logon', () => {
  console.log(`PASS  logon       ${ENGINE} accepted our Logon`);
  session.send(MsgType.NewOrderSingle, [
    [Tag.ClOrdID, 'order-1'],
    [Tag.Symbol, 'BTC/USD'],
    [Tag.Side, Side.Buy],
    [Tag.OrderQty, '1'],
    [Tag.OrdType, OrdType.Limit],
    [Tag.Price, '65000'],
    [Tag.TransactTime, utcTransactTime()],
  ]);
  console.log('  ->  sent        NewOrderSingle order-1 BTC/USD');
});

session.on('app', (m) => {
  if (m.msgType === BusinessMessageReject) {
    fail(`BusinessMessageReject (35=j): ${m.get(Tag.Text) ?? ''}`);
  }
  if (m.msgType === MsgType.ExecutionReport) {
    clearTimeout(timer);
    console.log(
      `PASS  fill        ExecutionReport ${m.get(Tag.ClOrdID)} ordStatus=${m.get(Tag.OrdStatus)}`,
    );
    session.logout();
    setTimeout(() => {
      console.log(`\nPASS  interop with ${ENGINE} OK`);
      process.exit(0);
    }, 400);
  }
});

console.log(`Connecting fixwire (initiator) -> ${ENGINE} (acceptor) on 127.0.0.1:${PORT} ...`);
session.connect();
