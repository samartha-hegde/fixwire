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
- **Transports** - TCP, TLS, and WebSocket (`websocketUrl`, for browser and Node),
  on both sides: dial with a `Session` or serve with `acceptWebSocket` over your
  own WS server. Or implement the `Transport` interface for your own medium.
- **Scheduling** - a session window (`schedule`): a daily UTC window with optional
  allowed weekdays and holiday dates. The initiator connects inside it, logs out at
  its end, and reconnects with a fresh sequence at the next valid start.
- **Observability** - a typed event stream, `session.metrics` counters, and
  ready-made bridges: `attachLogger(session, pino)` and
  `attachMetrics(session, record)` (OpenTelemetry / Prometheus / StatsD).
- **Message-type allowlist** - `allowedMsgTypes` rejects unexpected inbound
  message types with a session Reject.
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
✔ completes a logon + order round-trip over a WebSocket transport
✔ fixwire acceptor over WebSocket round-trips with a fixwire initiator
✔ scheduled session connects inside the window and stays idle outside it
✔ schedule respects allowed weekdays and holidays
✔ attachLogger / attachMetrics bridge the event stream
✔ history() returns the outbound message log for audit
✔ write-through stores seed from a backend and persist every change
  …61 passing
```

Decode a FIX message in your browser at the
[**playground**](https://samartha-hegde.github.io/fixwire/playground.html), which
runs fixwire's codec client-side, no server, nothing uploaded.

## Performance

fixwire parses a typical message in roughly **1.3 microseconds** and encodes in
about **1.1 microseconds** (a 19-field ExecutionReport, measured with
`npm run bench`; your numbers vary by machine and message). The parser avoids a
per-message allocation in the common path, so it stays in the
single-digit-microsecond range. Run the benchmark yourself:

```bash
npm run bench
```

## Interoperability

Beyond its own test suite, fixwire is interop-tested against independent,
production FIX engines: it logs on, trades, and logs out against their acceptors,
passing their strict `FIX44.xml` dictionary validation. Different codebases,
different languages, no shared heritage with fixwire.

| Engine | Language | Result |
| ------ | -------- | ------ |
| [quickfixgo](https://github.com/quickfixgo/quickfix) | Go | logon → order → fill → logout |
| [QuickFIX](https://github.com/quickfix/quickfix) | C++ (reference engine) | logon → order → fill → logout |
| [QuickFIX/J](https://github.com/quickfix-j/quickfixj) | Java | logon → order → fill → logout |

It is also verified across protocol versions, **FIX 4.2, 4.4, and 5.0
(FIXT.1.1)**, each against its own data dictionary. Run them yourself from
[`examples/interop`](./examples/interop).

## Security

Transport security is TLS, configured through standard Node TLS options. (FIX's
own message-level encryption via `EncryptMethod` is obsolete and intentionally
unsupported; `EncryptMethod` is always `0`. Use TLS.)

The streaming parser is bounded: a single message is capped at `maxMessageSize`
(default 64 KiB) so a hostile or malformed peer cannot grow memory without limit.
Tune it on `Session` / `Acceptor` or `new FixParser(maxBytes)`.

Mutual TLS works on both sides. Initiator presenting a client certificate:

```ts
const session = new Session({
  senderCompId: 'CLIENT',
  targetCompId: 'VENUE',
  host: 'fix.venue.com',
  port: 9876,
  tls: { ca, cert, key, servername: 'fix.venue.com' },
});
```

Acceptor requiring client certificates:

```ts
const acceptor = new Acceptor({
  senderCompId: 'SERVER',
  targetCompId: 'CLIENT',
  port: 9876,
  tls: { key, cert, ca, requestCert: true, rejectUnauthorized: true },
});
```

## Durability & failover

Sequence numbers and the resend log are pluggable. `FileStore` /
`FileMessageStore` persist to disk; for a hot standby that can resume a session,
back them with Redis or SQL via the write-through stores. Reads stay in memory
(the send path stays synchronous); every change is written through a callback you
wire to your backend. Load the state before constructing the session:

```ts
import { WriteThroughSeqStore } from 'fixwire';

const state = (await redis.get('seq:CLIENT')) ?? { out: 1, in: 1 };
const store = new WriteThroughSeqStore(state, (s) => void redis.set('seq:CLIENT', s));
const session = new Session({ ...config, store });
```

(A single FIX session is one stateful connection, so this is for durable
*failover*, not sharding one session across instances.)

## Typed message builders

`parseDictionary` exposes per-message field metadata (`messageFields`), and the
codegen emits a typed builder per message from any FIX dictionary:

```bash
npm run generate -- FIX44.xml > fix44.ts
# -> newOrderSingle({ clOrdID, symbol, side, orderQty, ordType, price? }): Field[]
```

Required fields are required parameters; optional ones are optional.

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
- [x] Dictionary `<component>` expansion and nested repeating groups preserved as structure
- [x] Dictionary-driven outbound message validation
- [x] Mutual TLS (client certificates on both sides)
- [x] Message-type allowlist and graceful unknown-message handling
- [x] Observability: `metrics` counters and a typed event stream for logging
- [x] WebSocket transport (`websocketUrl`) for browser and Node
- [x] Acceptor-side WebSocket (`acceptWebSocket`, bring your own WS server)
- [x] Session scheduling (daily window + sequence reset via `schedule`)
- [x] Richer schedules: allowed weekdays and holiday dates
- [x] Observability adapters: `attachLogger` (pino) and `attachMetrics` (OTel/Prometheus)
- [x] Message-recovery helpers: `session.history()` and `MessageStore.entries()`
- [x] Interactive browser [playground](https://samartha-hegde.github.io/fixwire/playground.html) (decode & validate)
- [x] Dictionary-driven typed message builders (codegen emits a typed builder per message)
- [x] External-backed stores: `WriteThroughSeqStore` / `WriteThroughMessageStore` (Redis / SQL)

Next, in rough order:

- [ ] A terminal TUI for watching a live session (blotter-style)
- [ ] First-class drop-copy session support

**FIXP / SBE (binary FIX)** is intentionally out of scope for now: it is a
different session protocol and a schema-driven binary codec, effectively a second
engine, and belongs in its own major effort rather than a bolt-on. Classic
tag=value FIX (4.2 / 4.4 / 5.0) is fixwire's focus.

## Using fixwire with AI assistants

fixwire ships machine-readable usage docs so AI coding tools can integrate it
correctly on their own:

- **`llms.txt`** ([llmstxt.org](https://llmstxt.org) format):
  <https://samartha-hegde.github.io/fixwire/llms.txt> — a concise, tool-agnostic
  usage reference (API shapes, recipes, gotchas) any AI tool can pull.
- **Claude Code skill**: [`skills/fixwire/SKILL.md`](./skills/fixwire/SKILL.md).
  Copy it into your project's `.claude/skills/fixwire/` (or `~/.claude/skills/`)
  and Claude Code will know how to wire up initiators, acceptors, and sessions.

Combined with the shipped `.d.ts` types and JSDoc, an assistant has everything it
needs to build a correct FIX integration.

## Contributing

Contributions welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md). The project has
zero runtime dependencies and intends to keep it that way, and uses
[Biome](https://biomejs.dev) for linting and formatting. Correctness of the
session layer is the bar: behaviour changes need a test.

## License

[MIT](./LICENSE)
