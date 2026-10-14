---
name: fixwire
description: Build FIX protocol clients and servers in TypeScript with the fixwire package. Use when integrating a FIX venue or counterparty, building a FIX initiator (client) or acceptor (server), sending or receiving FIX messages (orders, execution reports, market data), or handling FIX sessions (logon, heartbeat, resend, gap-fill, reconnect) in Node.js / TypeScript.
---

# Integrating fixwire

fixwire is a FIX protocol engine for TypeScript. It owns the session layer; your
code handles application messages via typed events and `[tag, value]` field
arrays. ESM only, Node 20+, zero runtime dependencies.

`npm install fixwire`

## Mental model

- A **Session** is a FIX **initiator** (dials out to a venue). An **Acceptor** is a
  FIX **server** that produces a Session per inbound connection.
- You send with `session.send(msgType, fields)` where `fields` is an array of
  `[tagNumber, stringValue]`. Do NOT include header tags (8, 9, 35, 34, 49, 56,
  52) or the checksum (10); fixwire adds and sequences them.
- You receive by listening to events. `app` fires for in-sequence application
  messages; read fields with `msg.get(tag)` / `msg.getInt(tag)` and branch on
  `msg.msgType`.

## Initiator recipe

```ts
import { Session, MsgType, Tag, newOrderSingle, Side, OrdType } from 'fixwire';

const session = new Session({
  senderCompId: 'CLIENT',
  targetCompId: 'VENUE',
  host: 'fix.venue.com',
  port: 9876,
  tls: true, // or { ca, cert, key, servername }
  resetOnLogon: true, // reset sequence numbers each session
  reconnect: true, // exponential backoff on unexpected drops
});

session.on('logon', () => {
  session.send(
    MsgType.NewOrderSingle,
    newOrderSingle({
      clOrdId: 'o-1',
      symbol: 'BTC/USD',
      side: Side.Buy,
      orderQty: 1,
      ordType: OrdType.Limit,
      price: 65000,
    }),
  );
});

session.on('app', (msg) => {
  if (msg.msgType === MsgType.ExecutionReport) {
    console.log('fill', msg.get(Tag.ClOrdID), msg.get(Tag.OrdStatus));
  }
});
session.on('reject', (msg) => console.error('rejected:', msg.get(Tag.Text)));
session.on('error', (err) => console.error(err));
session.connect();
```

## Acceptor recipe

```ts
import { Acceptor, MsgType, Tag } from 'fixwire';

const acceptor = new Acceptor({
  senderCompId: 'SERVER',
  targetCompId: 'CLIENT', // omit to accept any initiator and learn the CompID
  port: 9876,
  // tls: { key, cert },                       // FIX-over-TLS
  // authenticate: (logon) => logon.get(554) === 'secret',  // gate connections
});
acceptor.on('session', (session) => {
  // Attach handlers BEFORE the counterparty logs on.
  session.on('app', (msg) => {
    if (msg.msgType === MsgType.NewOrderSingle) {
      session.send(MsgType.ExecutionReport, [
        [Tag.ClOrdID, msg.get(Tag.ClOrdID) ?? ''],
        [Tag.ExecType, '0'],
        [Tag.OrdStatus, '0'],
      ]);
    }
  });
});
acceptor.listen();
```

## Events

`connect`, `logon`, `app`, `message` (raw firehose), `sent` (wire string),
`reject`, `reconnecting`, `logout`, `close`, `error`. All payloads are typed.

## Other building blocks

- **Codec**: `encode(fields, beginString?)`, `parse(raw)`, `FixParser` (streaming),
  `checksum`, `isChecksumValid`.
- **Dictionary**: `parseDictionary(xml)` over a QuickFIX `FIX44.xml` returns
  `{ byTag, byName, messages, groups, required }`. `describe(msg, dict)` renders
  readable logs. `getGroups(msg, countTag, dict)` extracts repeating-group entries;
  `group(countTag, entries)` builds them for outbound messages.
- **Stores**: `FileStore` persists sequence numbers across restarts;
  `FileMessageStore` persists sent messages for resend. Pass as `store` /
  `messageStore`.
- **Validation**: pass `dictionary` + `validateRequired: true` to reject inbound
  app messages missing required fields.

## Gotchas (check these when something fails)

- **ESM only** — use `import`, not `require`. Set `"type": "module"` or use `.mjs`.
- **Field arrays exclude header/trailer** — only pass the body `[tag, value]` pairs.
- **NewOrderSingle** usually needs `TransactTime` (tag 60). **FIX 4.2** also
  requires `HandlInst` (tag 21). `newOrderSingle()` does not add these; add them
  yourself when the counterparty's dictionary requires them.
- **FIX 5.0** — set `beginString: 'FIXT.1.1'` and `defaultApplVerId` (e.g. `'9'`
  for 5.0 SP2); import `ApplVerID` for the constants.
- **Comp IDs** — the counterparty's SenderCompID must equal your `targetCompId`
  and vice versa, or the session logs out on a mismatch.

## Verifying an integration

The repo's `examples/interop` runs a full logon → order → fill → logout against
real FIX engines (quickfixgo, QuickFIX, QuickFIX/J) across FIX 4.2 / 4.4 / 5.0.
Use the same pattern to smoke-test a new integration locally before pointing at a
live venue.

Full API reference: the package ships `.d.ts` types and JSDoc; read them for
exact signatures. README: https://github.com/samartha-hegde/fixwire#readme
