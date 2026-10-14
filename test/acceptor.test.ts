import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Acceptor,
  type FixMessage,
  MsgType,
  Session,
  type Session as SessionType,
  Tag,
} from '../src/index.js';

/** End-to-end: a fixwire Acceptor serving a fixwire initiator Session. */
test('acceptor and initiator complete a full logon + order round-trip', async () => {
  const acceptor = new Acceptor({
    senderCompId: 'SERVER',
    targetCompId: 'CLIENT',
    host: '127.0.0.1',
    port: 0,
  });

  let serverLoggedOn = false;
  acceptor.on('session', (s: SessionType) => {
    s.on('logon', () => {
      serverLoggedOn = true;
    });
    s.on('app', (m) => {
      if (m.msgType === MsgType.NewOrderSingle) {
        s.send(MsgType.ExecutionReport, [
          [Tag.ClOrdID, m.get(Tag.ClOrdID) ?? ''],
          [Tag.ExecType, '0'],
          [Tag.OrdStatus, '0'],
        ]);
      }
    });
  });

  await new Promise<void>((resolve) => {
    acceptor.on('listening', resolve);
    acceptor.listen();
  });

  const client = new Session({
    senderCompId: 'CLIENT',
    targetCompId: 'SERVER',
    host: '127.0.0.1',
    port: acceptor.port!,
    resetOnLogon: true,
  });

  const exec = await new Promise<FixMessage>((resolve, reject) => {
    client.on('error', reject);
    client.on('logon', () => client.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'order-1']]));
    client.on('app', (m) => {
      if (m.msgType === MsgType.ExecutionReport) resolve(m);
    });
    client.connect();
  });

  assert.ok(serverLoggedOn, 'acceptor session should log on');
  assert.equal(exec.get(Tag.ClOrdID), 'order-1');
  client.disconnect();
  acceptor.close();
});

test('acceptor logs out an initiator whose first message is not a Logon', async () => {
  const acceptor = new Acceptor({
    senderCompId: 'SERVER',
    targetCompId: 'CLIENT',
    host: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) => {
    acceptor.on('listening', resolve);
    acceptor.listen();
  });

  // Connect raw and send a Heartbeat before any Logon.
  const net = await import('node:net');
  const { encode } = await import('../src/index.js');
  const sock = net.connect({ host: '127.0.0.1', port: acceptor.port! });
  sock.setEncoding('latin1');

  const reply = await new Promise<string>((resolve) => {
    sock.on('connect', () => {
      sock.write(
        encode([
          [Tag.MsgType, MsgType.Heartbeat],
          [Tag.MsgSeqNum, '1'],
          [Tag.SenderCompID, 'CLIENT'],
          [Tag.TargetCompID, 'SERVER'],
          [Tag.SendingTime, '20240101-00:00:00.000'],
        ]),
        'latin1',
      );
    });
    sock.on('data', (chunk: string) => resolve(chunk));
  });

  assert.match(reply, /35=5/); // a Logout
  sock.destroy();
  acceptor.close();
});
