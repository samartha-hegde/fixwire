# fixwire

[![npm](https://img.shields.io/npm/v/fixwire.svg)](https://www.npmjs.com/package/fixwire)
[![CI](https://github.com/samartha-hegde/fixwire/actions/workflows/ci.yml/badge.svg)](https://github.com/samartha-hegde/fixwire/actions/workflows/ci.yml)
[![downloads](https://img.shields.io/npm/dm/fixwire.svg)](https://www.npmjs.com/package/fixwire)
[![website](https://img.shields.io/badge/website-fixwire-f5a623.svg)](https://samartha-hegde.github.io/fixwire)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A modern, fully-typed **FIX protocol** engine for TypeScript. **Zero runtime
dependencies**, a correct session layer, and an API that feels like 2026 - not a
Java port from 2004.

> **Status: v0.2 (solid).** FIX 4.2 / 4.4 / 5.0 (FIXT.1.1), both **initiator and
> acceptor** sides. The session state machine - logon, heartbeats, test requests,
> sequence tracking, gap detection, **true resend/replay** (with persistent
> stores), inbound validation and reconnect - is implemented and tested across 25
> cases. See the [Roadmap](#roadmap) for what's next.

## Why

The mature FIX engines (QuickFIX/J, quickfixgo, QuickFIX) are battle-tested but
live in Java / Go / C++. In TypeScript the options are thin. fixwire aims to be
the one you reach for: **typed messages, async-first, great docs, and a session
layer that gets the hard parts right** - the resend / gap-fill / sequence-reset
edge cases that quietly break lesser implementations at 3am.

## Install

```bash
npm install fixwire
```

Requires Node.js 20+.

## Quick start

```ts
import { Session, MsgType, newOrderSingle, Side, OrdType, Tag } from 'fixwire';

const session = new Session({
  senderCompId: 'CLIENT',
  targetCompId: 'VENUE',
  host: 'fix.example.com',
  port: 9876,
  tls: true, // or pass { ca, cert, key, servername }
  resetOnLogon: true,
  reconnect: true, // exponential backoff on unexpected disconnect
});

session.on('logon', () => {
  session.send(
    MsgType.NewOrderSingle,
    newOrderSingle({
      clOrdId: 'order-1',
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
    console.log('fill:', msg.get(Tag.ClOrdID), msg.get(Tag.OrdStatus));
  }
});

session.connect();
```

Prefer raw fields? `session.send(MsgType.NewOrderSingle, [[Tag.ClOrdID, 'order-1'], ...])`
works too - the builder is just sugar.

## Examples

```bash
npm run demo          # self-contained loopback: logon → order → fill → logout
npx tsx examples/venue.ts   # connect to a real venue (env-configured, read-only)
```

See [`examples/venue.ts`](./examples/venue.ts) for a safe starting template
against a real counterparty.

### Running an acceptor (server)

```ts
import { Acceptor, MsgType, Tag } from 'fixwire';

const acceptor = new Acceptor({
  senderCompId: 'SERVER',
  targetCompId: 'CLIENT',
  port: 9876,
  // tls: { key, cert },  // for FIX-over-TLS
});

acceptor.on('session', (session) => {
  // Wire handlers before the counterparty logs on.
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

The acceptor runs the same validated session state machine as the initiator; it
replies to Logon, adopts the initiator's heartbeat interval, and handles
resend/gap-fill identically.

## API

### `new Session(config)`

| Option          | Type                          | Default              | Notes                                            |
| --------------- | ----------------------------- | -------------------- | ------------------------------------------------ |
| `senderCompId`  | `string`                      | -                    | Your CompID.                                     |
| `targetCompId`  | `string`                      | -                    | The counterparty's CompID.                       |
| `host` / `port` | `string` / `number`           | -                    | Where to connect.                                |
| `tls`           | `boolean \| TLSOptions`       | `false`              | `true` for default TLS, or pass connection opts. |
| `beginString`   | `string`                      | `FIX.4.4`            | FIX version string.                              |
| `heartBtInt`    | `number`                      | `30`                 | Heartbeat interval, seconds.                     |
| `resetOnLogon`  | `boolean`                     | `false`              | Send `141=Y` and reset local sequence numbers.   |
| `reconnect`     | `boolean \| ReconnectOptions` | `false`              | Auto-reconnect with exponential backoff.         |
| `store`         | `SeqStore`                    | `MemoryStore`        | Sequence-number persistence.                     |
| `messageStore`  | `MessageStore`                | `MemoryMessageStore` | Outbound retention for resend/replay.            |

Methods: `connect()`, `send(msgType, fields)`, `logout(text?)`, `disconnect()`,
and a `status` getter.

### Events

| Event          | Payload              | Fires when                                   |
| -------------- | -------------------- | -------------------------------------------- |
| `connect`      | -                    | Socket (and TLS handshake) established       |
| `logon`        | `FixMessage`         | Logon accepted, session active               |
| `app`          | `FixMessage`         | An application message arrived (in sequence) |
| `message`      | `FixMessage`         | Every inbound message (raw firehose)         |
| `reject`       | `FixMessage`         | Inbound session-level Reject (35=3)          |
| `sent`         | `string`             | A message was written to the wire            |
| `reconnecting` | `(attempt, delayMs)` | A reconnect attempt is scheduled             |
| `logout`       | `FixMessage`         | Logout received                              |
| `close`        | -                    | Socket closed                                |
| `error`        | `Error`              | Socket or protocol error                     |

Event payloads are fully typed.

### Codec & utilities

`encode`, `parse`, `checksum`, `isChecksumValid`, `FixParser` (streaming),
`FixMessage`, plus `Tag` / `MsgType` constants and the `newOrderSingle` builder
with `Side` / `OrdType` / `TimeInForce`.

## What's handled

- **Framing** - streaming parser frames messages by `BodyLength`, so split and
  batched TCP reads Just Work.
- **Integrity** - checksum computed and validated (checked against a known
  QuickFIX vector); corrupt inbound messages are discarded without advancing
  the sequence.
- **Session layer** - logon, heartbeat, test request / response, logout
  handshake, sequence tracking, **gap detection → ResendRequest**, and
  **SequenceReset / gap-fill** handling.
- **Resend / replay** - application messages are retained and retransmitted with
  `PossDupFlag` + `OrigSendingTime` on request; admin runs are gap-filled.
- **Validation** - CompID, BeginString and required-tag checks with a
  session-level `Reject`, plus optional dictionary-driven required-field
  validation of application messages (`dictionary` + `validateRequired`).
- **Repeating groups** - `getGroups(msg, countTag, dict)` extracts group entries;
  `group(countTag, entries)` builds them for outbound messages.
- **Authentication** - Username / Password / RawData on logon, and an acceptor
  `authenticate` callback to gate who may connect.
- **Multi-counterparty acceptor** - omit `targetCompId` to accept any initiator
  and learn its CompID from the Logon.
- **Resilience** - automatic reconnect with exponential backoff.
- **Pluggable persistence** - in-memory by default; `FileStore` / `FileMessageStore`
  persist across restarts, or bring your own `SeqStore` / `MessageStore`.

The session edge cases are the whole point, so they're tested:

```bash
npm test
```

```
✔ isChecksumValid accepts a real message and rejects a tampered one
✔ checksum matches a known FIX vector
✔ streaming parser frames split and batched messages
✔ logon handshake and application round-trip
✔ detects a sequence gap and recovers via gap-fill
✔ replays application messages (PossDup) and gap-fills admin on ResendRequest
✔ discards a message with a bad checksum without advancing sequence
✔ rejects a message that is missing MsgType
✔ logs out on a CompID mismatch
✔ logs out on a sequence number that is too low
✔ reconnects after an unexpected disconnect
  …16 passing
```

## Roadmap

Shipped:

- [x] Acceptor (server) side, FIX 4.2 / 4.4 / 5.0 (FIXT.1.1)
- [x] Persistent `FileMessageStore` so resend/replay survives a restart
- [x] Dictionary parser + codegen (`parseDictionary`, `scripts/generate.ts`)
- [x] Inbound validation (checksum, CompID, BeginString, SendingTime, MsgSeqNum)
- [x] Repeating-group parsing (`getGroups`) and the outbound `group()` builder
- [x] Multi-counterparty acceptor routing (omit `targetCompId`, learn from Logon)
- [x] Message-level required-field validation driven by the dictionary
- [x] Logon authentication: Username / Password / RawData, and an acceptor `authenticate` gate

Next, in rough order:

- [ ] Component (`<component>`) expansion in the dictionary
- [ ] Nested repeating groups preserved as structure, not flattened
- [ ] Dictionary-driven outbound message validation
- [ ] Mutual-TLS helpers and encryption (EncryptMethod) support

## Contributing

Contributions welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md). The project has
zero runtime dependencies and intends to keep it that way, and uses
[Biome](https://biomejs.dev) for linting and formatting. Correctness of the
session layer is the bar: behaviour changes need a test.

## License

[MIT](./LICENSE)
