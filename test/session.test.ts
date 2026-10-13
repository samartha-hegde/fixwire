import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { Session, encode, parse, FixParser, Tag, MsgType, type Field } from '../src/index.js';

/**
 * Minimal in-process FIX acceptor for tests. `onMessage(msg, send)` is called per
 * inbound message; `send(type, fields, seqOverride?)` emits a framed reply.
 */
function startAcceptor(
  onMessage: (msg: ReturnType<typeof parse>, send: (type: string, fields?: Field[], seq?: number) => void) => void,
): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    sock.setEncoding('latin1');
    const parser = new FixParser();
    let out = 1;
    const send = (type: string, fields: Field[] = [], seq?: number) => {
      const n = seq ?? out++;
      const header: Field[] = [
        [Tag.MsgType, type], [Tag.MsgSeqNum, String(n)],
        [Tag.SenderCompID, 'ACCEPTOR'], [Tag.TargetCompID, 'CLIENT'],
        [Tag.SendingTime, '20240101-00:00:00.000'],
      ];
      sock.write(encode([...header, ...fields]), 'latin1');
    };
    sock.on('data', (chunk: string) => {
      for (const msg of parser.append(chunk)) onMessage(msg, send);
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

test('logon handshake and application round-trip', async () => {
  const acceptor = await startAcceptor((msg, send) => {
    switch (msg.msgType) {
      case MsgType.Logon:
        send(MsgType.Logon, [[Tag.EncryptMethod, '0'], [Tag.HeartBtInt, '30']]);
        break;
      case MsgType.NewOrderSingle:
        send(MsgType.ExecutionReport, [
          [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
          [Tag.ExecType, '0'], [Tag.OrdStatus, '0'],
        ]);
        break;
      case MsgType.Logout:
        send(MsgType.Logout);
        break;
    }
  });

  const session = new Session({
    senderCompId: 'CLIENT', targetCompId: 'ACCEPTOR',
    host: '127.0.0.1', port: acceptor.port, resetOnLogon: true,
  });

  const exec = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => {
      session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'order-1'], [Tag.Symbol, 'BTC/USD']]);
    });
    session.on('app', (m) => { if (m.msgType === MsgType.ExecutionReport) resolve(m); });
    session.connect();
  });

  assert.equal(exec.get(Tag.ClOrdID), 'order-1');
  session.disconnect();
  acceptor.close();
});

test('detects a sequence gap and recovers via gap-fill', async () => {
  const acceptor = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) {
      send(MsgType.Logon, [[Tag.EncryptMethod, '0'], [Tag.HeartBtInt, '30']], 1);
      // Deliberately skip seq 2 — send an app message as seq 3 to force a gap.
      send(MsgType.ExecutionReport, [[Tag.ClOrdID, 'skipped'], [Tag.OrdStatus, '0']], 3);
    } else if (msg.msgType === MsgType.ResendRequest) {
      // Respond with SequenceReset-GapFill advancing the client to seq 4, then a fresh msg.
      send(MsgType.SequenceReset, [[Tag.GapFillFlag, 'Y'], [Tag.NewSeqNo, '4']], 2);
      send(MsgType.ExecutionReport, [[Tag.ClOrdID, 'recovered'], [Tag.OrdStatus, '0']], 4);
    }
  });

  const session = new Session({
    senderCompId: 'CLIENT', targetCompId: 'ACCEPTOR',
    host: '127.0.0.1', port: acceptor.port, resetOnLogon: true,
  });

  let resendRequested = false;
  session.on('sent', (wire: string) => {
    if (parse(wire).msgType === MsgType.ResendRequest) resendRequested = true;
  });

  const recovered = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('app', (m) => { if (m.get(Tag.ClOrdID) === 'recovered') resolve(m); });
    session.connect();
  });

  assert.ok(resendRequested, 'client should have sent a ResendRequest on the gap');
  assert.equal(recovered.get(Tag.ClOrdID), 'recovered');
  session.disconnect();
  acceptor.close();
});
