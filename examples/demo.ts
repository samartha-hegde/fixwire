/**
 * Self-contained demo: spins up a tiny in-process FIX acceptor, then uses a
 * fixwire Session (the initiator — the real library) to log on, send an order,
 * receive an ExecutionReport, and log out. No external server needed.
 *
 *   npm run demo
 */
import * as net from 'node:net';
import { Session, encode, FixParser, Tag, MsgType, type Field } from '../src/index.js';

// --- throwaway acceptor (demo only; fixwire is the initiator side) ----------
const server = net.createServer((sock) => {
  sock.setEncoding('latin1');
  const parser = new FixParser();
  let out = 1;
  const send = (type: string, fields: Field[] = []) => {
    const header: Field[] = [
      [Tag.MsgType, type],
      [Tag.MsgSeqNum, String(out++)],
      [Tag.SenderCompID, 'ACCEPTOR'],
      [Tag.TargetCompID, 'CLIENT'],
      [Tag.SendingTime, '20240101-00:00:00.000'],
    ];
    sock.write(encode([...header, ...fields]), 'latin1');
  };
  sock.on('data', (chunk: string) => {
    for (const msg of parser.append(chunk)) {
      if (msg.msgType === MsgType.Logon) {
        send(MsgType.Logon, [
          [Tag.EncryptMethod, '0'],
          [Tag.HeartBtInt, '30'],
        ]);
      } else if (msg.msgType === MsgType.NewOrderSingle) {
        send(MsgType.ExecutionReport, [
          [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
          [Tag.ExecType, '0'],
          [Tag.OrdStatus, '0'],
          [Tag.Symbol, msg.get(Tag.Symbol) ?? ''],
        ]);
      } else if (msg.msgType === MsgType.Logout) {
        send(MsgType.Logout);
        sock.end();
      }
    }
  });
});

// --- the actual fixwire usage ------------------------------------------------
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as net.AddressInfo;
  const session = new Session({
    senderCompId: 'CLIENT',
    targetCompId: 'ACCEPTOR',
    host: '127.0.0.1',
    port,
    resetOnLogon: true,
  });

  session.on('logon', () => {
    console.log('✓ logged on');
    session.send(MsgType.NewOrderSingle, [
      [Tag.ClOrdID, 'order-1'],
      [Tag.Symbol, 'BTC/USD'],
      [Tag.Side, '1'],
      [Tag.OrderQty, '1'],
      [Tag.OrdType, '2'],
      [Tag.Price, '65000'],
    ]);
    console.log('→ sent NewOrderSingle order-1');
  });

  session.on('app', (msg) => {
    if (msg.msgType === MsgType.ExecutionReport) {
      console.log(
        `✓ ExecutionReport: ${msg.get(Tag.ClOrdID)} status=${msg.get(Tag.OrdStatus)} symbol=${msg.get(Tag.Symbol)}`,
      );
      session.logout();
    }
  });

  session.on('logout', () => console.log('← logout acknowledged'));
  session.on('close', () => {
    server.close();
    console.log('✓ done');
  });
  session.on('error', (err) => {
    console.error('session error:', err);
    process.exit(1);
  });

  session.connect();
});
