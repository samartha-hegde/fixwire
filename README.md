# fixwire

A modern, fully-typed **FIX protocol** engine for TypeScript. Zero runtime
dependencies, a correct session layer, and an API that feels like 2026 — not a
Java port from 2004.

> **Status: v0 (early).** FIX 4.4, initiator (client) side. The session state
> machine — logon, heartbeats, test requests, sequence tracking, gap detection
> and gap-fill — works and is tested. See [Roadmap](#roadmap) for what's next.

## Why

The mature FIX engines (QuickFIX/J, quickfixgo, QuickFIX) are battle-tested but
live in Java / Go / C++. In TypeScript the options are thin. fixwire aims to be
the one you reach for: **typed messages, async-first, great docs, and a session
layer that gets the hard parts right** — the resend/gap-fill/sequence-reset
edge cases that quietly break lesser implementations at 3am.

## Install

```bash
npm install fixwire
```

## Quick start

```ts
import { Session, Tag, MsgType } from 'fixwire';

const session = new Session({
  senderCompId: 'CLIENT',
  targetCompId: 'VENUE',
  host: 'fix.example.com',
  port: 9876,
  tls: true,            // or pass { ca, cert, key, servername }
  resetOnLogon: true,
});

session.on('logon', () => {
  session.send(MsgType.NewOrderSingle, [
    [Tag.ClOrdID, 'order-1'],
    [Tag.Symbol, 'BTC/USD'],
    [Tag.Side, '1'],       // buy
    [Tag.OrderQty, '1'],
    [Tag.OrdType, '2'],    // limit
    [Tag.Price, '65000'],
  ]);
});

session.on('app', (msg) => {
  if (msg.msgType === MsgType.ExecutionReport) {
    console.log('fill:', msg.get(Tag.ClOrdID), msg.get(Tag.OrdStatus));
  }
});

session.connect();
```

Run a complete, self-contained round-trip (in-process acceptor + initiator):

```bash
npm run demo
```

## Events

| Event | Fires when |
|-------|-----------|
| `connect` | Socket (and TLS handshake) established |
| `logon` | Logon accepted, session active |
| `app` | An application message arrived (in sequence) |
| `message` | Every inbound message (raw firehose) |
| `sent` | A message was written to the wire (string) |
| `logout` | Logout received |
| `close` | Socket closed |
| `error` | Socket or protocol error |

## What's handled

- **Framing** — streaming parser that frames messages by `BodyLength`, so split
  and batched TCP reads Just Work.
- **Checksum & BodyLength** — computed and validated against the spec (checked
  against a known QuickFIX vector in the test suite).
- **Session layer** — logon, heartbeat, test request / response, logout
  handshake, sequence-number tracking, **gap detection → ResendRequest**, and
  **SequenceReset / gap-fill** handling.
- **Pluggable seq store** — in-memory by default; `FileStore` persists across
  restarts. Bring your own by implementing `SeqStore`.

The session edge cases are the whole point, so they're tested:

```bash
npm test
```

```
✔ checksum matches a known FIX vector
✔ encode then parse round-trips the body fields
✔ streaming parser frames split and batched messages
✔ logon handshake and application round-trip
✔ detects a sequence gap and recovers via gap-fill
```

## Roadmap

v0 deliberately ships the 20% that covers most real integrations. Next, in
rough order:

- [ ] Outbound message store + true resend (replay with PossDup), not just gap-fill
- [ ] Acceptor (server) side
- [ ] FIX 4.2 and 5.0 / FIXT
- [ ] Inbound checksum validation + reject flow
- [ ] Generated typed message builders from FIX XML dictionaries
- [ ] Automatic reconnect with backoff

## License

MIT
