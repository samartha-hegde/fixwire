import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AddressInfo, WebSocketServer } from 'ws';
import {
  encode,
  type Field,
  type FixMessage,
  FixParser,
  MsgType,
  Session,
  Tag,
} from '../src/index.js';

/** A FIX-over-WebSocket acceptor (one FIX message per frame) for interop testing. */
function startWsAcceptor(): Promise<{ url: string; close: () => void }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  wss.on('connection', (ws) => {
    const parser = new FixParser();
    let out = 1;
    const send = (type: string, fields: Field[] = []) => {
      const header: Field[] = [
        [Tag.MsgType, type],
        [Tag.MsgSeqNum, String(out++)],
        [Tag.SenderCompID, 'SERVER'],
        [Tag.TargetCompID, 'CLIENT'],
        [Tag.SendingTime, '20240101-00:00:00.000'],
      ];
      ws.send(encode([...header, ...fields]));
    };
    ws.on('message', (data: Buffer) => {
      for (const msg of parser.append(data.toString('latin1'))) {
        if (msg.msgType === MsgType.Logon) {
          send(MsgType.Logon, [
            [Tag.EncryptMethod, '0'],
            [Tag.HeartBtInt, '30'],
          ]);
        } else if (msg.msgType === MsgType.NewOrderSingle) {
          send(MsgType.ExecutionReport, [
            [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
            [Tag.OrdStatus, '0'],
          ]);
        }
      }
    });
  });
  return new Promise((resolve) => {
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({ url: `ws://127.0.0.1:${port}`, close: () => wss.close() });
    });
  });
}

test('completes a logon + order round-trip over a WebSocket transport', async () => {
  const acc = await startWsAcceptor();
  const session = new Session({
    senderCompId: 'CLIENT',
    targetCompId: 'SERVER',
    host: '', // unused for WebSocket
    port: 0,
    websocketUrl: acc.url,
    resetOnLogon: true,
  });
  const exec = await new Promise<FixMessage>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'order-1']]));
    session.on('app', (m) => {
      if (m.msgType === MsgType.ExecutionReport) resolve(m);
    });
    session.connect();
  });
  assert.equal(exec.get(Tag.ClOrdID), 'order-1');
  session.disconnect();
  acc.close();
});
