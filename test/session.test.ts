import assert from 'node:assert/strict';
import * as net from 'node:net';
import { test } from 'node:test';
import {
  ApplVerID,
  encode,
  type Field,
  FixParser,
  MsgType,
  parse,
  parseDictionary,
  Session,
  SOH,
  Tag,
} from '../src/index.js';

type AcceptorHandler = (
  msg: ReturnType<typeof parse>,
  send: (type: string, fields?: Field[], seq?: number) => void,
  sock: net.Socket,
) => void;

/** Minimal in-process FIX acceptor for tests. One `out` counter per connection. */
function startAcceptor(onMessage: AcceptorHandler): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    sock.setEncoding('latin1');
    const parser = new FixParser();
    let out = 1;
    const send = (type: string, fields: Field[] = [], seq?: number) => {
      const n = seq ?? out++;
      const header: Field[] = [
        [Tag.MsgType, type],
        [Tag.MsgSeqNum, String(n)],
        [Tag.SenderCompID, 'ACCEPTOR'],
        [Tag.TargetCompID, 'CLIENT'],
        [Tag.SendingTime, '20240101-00:00:00.000'],
      ];
      sock.write(encode([...header, ...fields]), 'latin1');
    };
    sock.on('data', (chunk: string) => {
      for (const msg of parser.append(chunk)) onMessage(msg, send, sock);
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

function newSession(port: number, extra: Partial<ConstructorParameters<typeof Session>[0]> = {}) {
  return new Session({
    senderCompId: 'CLIENT',
    targetCompId: 'ACCEPTOR',
    host: '127.0.0.1',
    port,
    resetOnLogon: true,
    ...extra,
  });
}

const replyLogon = (send: (t: string, f?: Field[], s?: number) => void) =>
  send(MsgType.Logon, [
    [Tag.EncryptMethod, '0'],
    [Tag.HeartBtInt, '30'],
  ]);

test('logon handshake and application round-trip', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
    else if (msg.msgType === MsgType.NewOrderSingle) {
      send(MsgType.ExecutionReport, [
        [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
        [Tag.OrdStatus, '0'],
      ]);
    }
  });
  const session = newSession(acc.port);
  const exec = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
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

test('detects a sequence gap and recovers via gap-fill', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send); // seq 1
      send(
        MsgType.ExecutionReport,
        [
          [Tag.ClOrdID, 'skipped'],
          [Tag.OrdStatus, '0'],
        ],
        3,
      ); // skip seq 2
    } else if (msg.msgType === MsgType.ResendRequest) {
      send(
        MsgType.SequenceReset,
        [
          [Tag.GapFillFlag, 'Y'],
          [Tag.NewSeqNo, '4'],
        ],
        2,
      );
      send(
        MsgType.ExecutionReport,
        [
          [Tag.ClOrdID, 'recovered'],
          [Tag.OrdStatus, '0'],
        ],
        4,
      );
    }
  });
  const session = newSession(acc.port);
  let resendRequested = false;
  session.on('sent', (w) => {
    if (parse(w).msgType === MsgType.ResendRequest) resendRequested = true;
  });
  const recovered = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('app', (m) => {
      if (m.get(Tag.ClOrdID) === 'recovered') resolve(m);
    });
    session.connect();
  });
  assert.ok(resendRequested, 'client should send a ResendRequest on the gap');
  assert.equal(recovered.get(Tag.ClOrdID), 'recovered');
  session.disconnect();
  acc.close();
});

test('replays application messages (PossDup) and gap-fills admin on ResendRequest', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
    else if (msg.msgType === MsgType.NewOrderSingle) {
      send(MsgType.ResendRequest, [
        [Tag.BeginSeqNo, '1'],
        [Tag.EndSeqNo, '0'],
      ]);
    }
  });
  const session = newSession(acc.port);
  const sent: ReturnType<typeof parse>[] = [];
  const done = new Promise<void>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'o-1']]));
    session.on('sent', (w) => {
      const m = parse(w);
      sent.push(m);
      const replayed = sent.find(
        (x) => x.msgType === MsgType.NewOrderSingle && x.get(Tag.PossDupFlag) === 'Y',
      );
      const gapFill = sent.find(
        (x) => x.msgType === MsgType.SequenceReset && x.get(Tag.GapFillFlag) === 'Y',
      );
      if (replayed && gapFill) resolve();
    });
    session.connect();
  });
  await done;
  const replayed = sent.find(
    (x) => x.msgType === MsgType.NewOrderSingle && x.get(Tag.PossDupFlag) === 'Y',
  )!;
  assert.equal(replayed.seqNum, 2, 'replayed order keeps its original seq');
  assert.ok(replayed.get(Tag.OrigSendingTime), 'replay carries OrigSendingTime');
  const gapFill = sent.find(
    (x) => x.msgType === MsgType.SequenceReset && x.get(Tag.GapFillFlag) === 'Y',
  )!;
  assert.equal(gapFill.seqNum, 1, 'gap-fill starts at the logon seq');
  session.disconnect();
  acc.close();
});

test('discards a message with a bad checksum without advancing sequence', async () => {
  const acc = await startAcceptor((msg, send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send); // seq 1
      const good = encode([
        [Tag.MsgType, MsgType.Heartbeat],
        [Tag.MsgSeqNum, '2'],
        [Tag.SenderCompID, 'ACCEPTOR'],
        [Tag.TargetCompID, 'CLIENT'],
        [Tag.SendingTime, '20240101-00:00:00.000'],
      ]);
      sock.write(`${good.slice(0, -4)}XXX${SOH}`, 'latin1'); // corrupt checksum
    }
  });
  const session = newSession(acc.port);
  const err = await new Promise<Error>((resolve) => {
    session.on('error', resolve);
    session.connect();
  });
  assert.match(err.message, /checksum/);
  session.disconnect();
  acc.close();
});

test('rejects a message that is missing MsgType', async () => {
  const acc = await startAcceptor((msg, send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send);
      // A framed, valid-checksum message with no tag 35.
      sock.write(
        encode([
          [Tag.MsgSeqNum, '2'],
          [Tag.SenderCompID, 'ACCEPTOR'],
          [Tag.TargetCompID, 'CLIENT'],
          [Tag.SendingTime, '20240101-00:00:00.000'],
        ]),
        'latin1',
      );
    }
  });
  const session = newSession(acc.port);
  const reject = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Reject) resolve(m);
    });
    session.connect();
  });
  assert.match(reject.get(Tag.Text) ?? '', /MsgType/);
  session.disconnect();
  acc.close();
});

test('logs out on a CompID mismatch', async () => {
  const acc = await startAcceptor((msg, _send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      // Wrong SenderCompID - not who we dialed.
      sock.write(
        encode([
          [Tag.MsgType, MsgType.Logon],
          [Tag.MsgSeqNum, '1'],
          [Tag.SenderCompID, 'WRONG'],
          [Tag.TargetCompID, 'CLIENT'],
          [Tag.SendingTime, '20240101-00:00:00.000'],
          [Tag.EncryptMethod, '0'],
          [Tag.HeartBtInt, '30'],
        ]),
        'latin1',
      );
    }
  });
  const session = newSession(acc.port);
  const logout = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Logout) resolve(m);
    });
    session.connect();
  });
  assert.match(logout.get(Tag.Text) ?? '', /CompID/);
  session.disconnect();
  acc.close();
});

test('logs out on a sequence number that is too low', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send); // seq 1 -> client now expects 2
      send(MsgType.Heartbeat, [], 1); // stale seq 1, no PossDup
    }
  });
  const session = newSession(acc.port);
  const logout = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Logout) resolve(m);
    });
    session.connect();
  });
  assert.match(logout.get(Tag.Text) ?? '', /too low/);
  session.disconnect();
  acc.close();
});

test('reconnects after an unexpected disconnect', async () => {
  let logons = 0;
  const acc = await startAcceptor((msg, send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      logons++;
      replyLogon(send);
      if (logons === 1) setTimeout(() => sock.destroy(), 20); // drop the first connection
    }
  });
  const session = newSession(acc.port, { reconnect: { initialDelayMs: 30 } });
  let reconnecting = false;
  session.on('error', () => {}); // ignore transient socket resets
  session.on('reconnecting', () => {
    reconnecting = true;
  });
  await new Promise<void>((resolve) => {
    let count = 0;
    session.on('logon', () => {
      if (++count === 2) resolve();
    });
    session.connect();
  });
  assert.ok(reconnecting, 'should emit reconnecting between the two logons');
  session.disconnect();
  acc.close();
});

test('rejects a message missing SendingTime', async () => {
  const acc = await startAcceptor((msg, send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send);
      // Heartbeat seq 2 with no tag 52.
      sock.write(
        encode([
          [Tag.MsgType, MsgType.Heartbeat],
          [Tag.MsgSeqNum, '2'],
          [Tag.SenderCompID, 'ACCEPTOR'],
          [Tag.TargetCompID, 'CLIENT'],
        ]),
        'latin1',
      );
    }
  });
  const session = newSession(acc.port);
  const reject = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Reject) resolve(m);
    });
    session.connect();
  });
  assert.equal(reject.get(Tag.RefTagID), String(Tag.SendingTime));
  assert.equal(reject.get(Tag.SessionRejectReason), '1');
  session.disconnect();
  acc.close();
});

test('logs out on an incorrect BeginString', async () => {
  const acc = await startAcceptor((msg, _send, sock) => {
    if (msg.msgType === MsgType.Logon) {
      // Reply with FIX.4.2 while the client expects FIX.4.4.
      sock.write(
        encode(
          [
            [Tag.MsgType, MsgType.Logon],
            [Tag.MsgSeqNum, '1'],
            [Tag.SenderCompID, 'ACCEPTOR'],
            [Tag.TargetCompID, 'CLIENT'],
            [Tag.SendingTime, '20240101-00:00:00.000'],
            [Tag.EncryptMethod, '0'],
            [Tag.HeartBtInt, '30'],
          ],
          'FIX.4.2',
        ),
        'latin1',
      );
    }
  });
  const session = newSession(acc.port);
  const logout = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Logout) resolve(m);
    });
    session.connect();
  });
  assert.match(logout.get(Tag.Text) ?? '', /BeginString/);
  session.disconnect();
  acc.close();
});

test('FIXT.1.1 logon carries BeginString and DefaultApplVerID', async () => {
  const acc = await startAcceptor(() => {});
  const session = newSession(acc.port, {
    beginString: 'FIXT.1.1',
    defaultApplVerId: ApplVerID.FIX50SP2,
  });
  const logon = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Logon) resolve(m);
    });
    session.connect();
  });
  assert.equal(logon.get(Tag.BeginString), 'FIXT.1.1');
  assert.equal(logon.get(Tag.DefaultApplVerID), '9');
  session.disconnect();
  acc.close();
});

test('logon carries Username and Password credentials', async () => {
  const acc = await startAcceptor(() => {});
  const session = newSession(acc.port, { username: 'desk-a', password: 's3cret' });
  const logon = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Logon) resolve(m);
    });
    session.connect();
  });
  assert.equal(logon.get(Tag.Username), 'desk-a');
  assert.equal(logon.get(Tag.Password), 's3cret');
  session.disconnect();
  acc.close();
});

test('rejects an application message missing a dictionary-required field', async () => {
  const dict = parseDictionary(
    `<fix><messages><message name="ExecutionReport" msgtype="8" msgcat="app">
       <field name="ClOrdID" required="Y"/></message></messages>
     <fields><field number="11" name="ClOrdID" type="STRING"/></fields></fix>`,
  );
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send);
      send(MsgType.ExecutionReport, [[Tag.OrdStatus, '0']]); // missing ClOrdID (11)
    }
  });
  const session = newSession(acc.port, { dictionary: dict, validateRequired: true });
  let appSeen = false;
  session.on('app', () => {
    appSeen = true;
  });
  const reject = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Reject) resolve(m);
    });
    session.connect();
  });
  assert.equal(reject.get(Tag.RefTagID), String(Tag.ClOrdID));
  assert.equal(appSeen, false, 'invalid app message must not be delivered');
  session.disconnect();
  acc.close();
});

test('throws on an outbound message missing a required field', async () => {
  const dict = parseDictionary(
    `<fix><messages><message name="NewOrderSingle" msgtype="D" msgcat="app">
       <field name="ClOrdID" required="Y"/><field name="Symbol" required="Y"/>
     </message></messages>
     <fields><field number="11" name="ClOrdID" type="STRING"/>
       <field number="55" name="Symbol" type="STRING"/></fields></fix>`,
  );
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
  });
  const session = newSession(acc.port, { dictionary: dict, validateRequired: true });
  await new Promise<void>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => {
      assert.throws(
        () => session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'o-1']]), // missing Symbol
        /missing required field 55/,
      );
      resolve();
    });
    session.connect();
  });
  session.disconnect();
  acc.close();
});

test('rejects an application message not in the allowlist', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) {
      replyLogon(send);
      send('AE', [[Tag.ClOrdID, 'x']]); // AE = TradeCaptureReport, not allowed
    }
  });
  const session = newSession(acc.port, { allowedMsgTypes: [MsgType.ExecutionReport] });
  let appSeen = false;
  session.on('app', () => {
    appSeen = true;
  });
  const reject = await new Promise<ReturnType<typeof parse>>((resolve, reject) => {
    session.on('error', reject);
    session.on('sent', (w) => {
      const m = parse(w);
      if (m.msgType === MsgType.Reject) resolve(m);
    });
    session.connect();
  });
  assert.equal(reject.get(Tag.SessionRejectReason), '11'); // invalid MsgType
  assert.equal(appSeen, false);
  session.disconnect();
  acc.close();
});

test('tracks lifetime metrics counters', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
    else if (msg.msgType === MsgType.NewOrderSingle) {
      send(MsgType.ExecutionReport, [
        [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
        [Tag.OrdStatus, '0'],
      ]);
    }
  });
  const session = newSession(acc.port);
  await new Promise<void>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'o-1']]));
    session.on('app', (m) => {
      if (m.msgType === MsgType.ExecutionReport) resolve();
    });
    session.connect();
  });
  assert.ok(session.metrics.messagesSent >= 2, 'logon + order sent');
  assert.ok(session.metrics.messagesReceived >= 2, 'logon + execution report received');
  session.disconnect();
  acc.close();
});

const hms = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

test('scheduled session connects inside the window', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
  });
  const now = new Date();
  const schedule = {
    startTime: hms(new Date(now.getTime() - 5 * 60_000)), // 5 min ago
    endTime: hms(new Date(now.getTime() + 60 * 60_000)), // 1 h ahead
  };
  const session = newSession(acc.port, { schedule });
  await new Promise<void>((resolve, reject) => {
    session.on('error', reject);
    session.on('logon', () => resolve());
    session.connect();
  });
  session.disconnect();
  acc.close();
});

test('scheduled session stays idle outside the window', async () => {
  const acc = await startAcceptor((msg, send) => {
    if (msg.msgType === MsgType.Logon) replyLogon(send);
  });
  const now = new Date();
  const schedule = {
    startTime: hms(new Date(now.getTime() + 2 * 60 * 60_000)), // 2 h ahead
    endTime: hms(new Date(now.getTime() + 3 * 60 * 60_000)), // 3 h ahead
  };
  const session = newSession(acc.port, { schedule });
  let loggedOn = false;
  session.on('logon', () => {
    loggedOn = true;
  });
  session.connect();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(loggedOn, false, 'must not connect outside the window');
  assert.equal(session.status, 'disconnected');
  session.disconnect();
  acc.close();
});
