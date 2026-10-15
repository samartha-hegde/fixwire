# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-10-15

### Changed

- Performance: `FixMessage` now builds its tag index lazily (scanning the field
  array for small messages, memoizing a `Map` only when a message is large or read
  repeatedly). A typical parse is ~30% faster (about 1.3 µs/msg). Added `npm run bench`.

## [0.5.0] - 2026-10-15

### Added

- **WebSocket transport**: set `websocketUrl` to run a session over WebSocket
  (browser or Node 22+) instead of TCP. Transport is now an abstraction
  (`Transport`, `TcpTransport`, `WebSocketTransport`); implement your own medium.
- **Message-type allowlist**: `allowedMsgTypes` rejects inbound application
  messages outside the list with a session Reject (SessionRejectReason 11).
- **Observability**: `session.metrics` exposes lifetime counters (messages sent /
  received, rejects received, reconnects); the typed event stream is the logging
  seam.

### Changed

- Internally, the session now reads and writes through a `Transport` rather than a
  raw socket. No change for TCP/TLS users.

### Added

- **Dictionary `<component>` expansion**: `parseDictionary` inlines component
  references (recursively, downgrading required on optional refs), so
  component-heavy messages resolve their fields and groups correctly.
- **Nested repeating groups preserved**: a group's member set is now transitive,
  so `getGroups` captures full entries and a nested group is extractable by
  calling `getGroups` again on an entry.
- **Outbound validation**: `session.send()` throws before sending when a required
  field is missing (with `dictionary` + `validateRequired`).
- **Mutual TLS**: documented and supported on both initiator and acceptor via
  standard Node TLS options (client certificates, `requestCert`).

### Notes

- FIX message-level encryption (`EncryptMethod` 1-6) is intentionally unsupported;
  TLS is the transport-security mechanism and `EncryptMethod` is always `0`.

## [0.3.0] - 2026-10-14

### Added

- **Repeating groups**: `getGroups(msg, countTag, dict)` extracts group entries
  (dictionary-driven, handles nested groups innermost-out), and `group(countTag,
  entries)` builds them for outbound messages.
- **Dictionary**: `parseDictionary` now extracts repeating-group structure
  (`GroupSpec`) and per-message required fields.
- **Message-level validation**: `dictionary` + `validateRequired` on a session
  rejects inbound application messages that are missing required fields.
- **Logon authentication**: `username`, `password` and `rawData` session options
  send Username (553) / Password (554) / RawData (95/96); the `Acceptor` gains an
  `authenticate(logon)` callback to reject unauthorized logons.
- **Multi-counterparty acceptor**: omit `targetCompId` on the `Acceptor` to accept
  any initiator and learn its CompID from the Logon.

## [0.2.0] - 2026-10-14

Completes the v0.1 roadmap: acceptor side, more FIX versions, persistent
resend, a dictionary toolchain, and more inbound validation.

### Added

- **Acceptor (server) side**: `Acceptor` listens for initiators and runs the
  validated session state machine per connection, replying to Logon and adopting
  the initiator's heartbeat interval.
- **FIX 4.2 / 5.0 (FIXT.1.1)**: `beginString` support plus `defaultApplVerId`
  (DefaultApplVerID, tag 1137) on FIXT logon, and an `ApplVerID` constant.
- **Persistent resend**: `FileMessageStore` retains sent messages on disk so
  resend/replay survives a restart.
- **Dictionary toolchain**: `parseDictionary` reads QuickFIX-format FIX XML
  (dependency-free), `builtinDictionary`, `describe` for readable logging, and a
  `scripts/generate.ts` codegen that emits typed `Tag` / enum constants.
- **Inbound validation**: required standard header tags (BeginString match,
  SendingTime, MsgSeqNum) with `Reject` (SessionRejectReason) or fatal logout.

### Changed

- Tooling moved from ESLint + Prettier to **Biome** (lint + format in one tool);
  the published package still has zero runtime dependencies.

## [0.1.0] - 2026-10-14

Initial public release. FIX 4.4, initiator (client) side.

### Added

- Typed FIX codec: `encode`, `parse`, `checksum`, `isChecksumValid`.
- Streaming `FixParser` that frames messages by BodyLength across split and
  batched TCP reads.
- `Session` - initiator state machine:
  - Logon / logout handshake, heartbeats, test request / response.
  - Sequence tracking with gap detection (`ResendRequest`) and
    `SequenceReset` / gap-fill handling.
  - True resend/replay of application messages with `PossDupFlag` and
    `OrigSendingTime`, backed by a pluggable `MessageStore`.
  - Inbound checksum validation, CompID validation, and session-level
    `Reject` (35=3) for malformed messages.
  - Automatic reconnect with exponential backoff.
  - Typed event surface (`logon`, `app`, `message`, `sent`, `reconnecting`, ...).
- Pluggable sequence store: `MemoryStore`, `FileStore`.
- `newOrderSingle` builder with `Side` / `OrdType` / `TimeInForce` constants.
- TCP and TLS transport.

[Unreleased]: https://github.com/samartha-hegde/fixwire/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/samartha-hegde/fixwire/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/samartha-hegde/fixwire/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/samartha-hegde/fixwire/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/samartha-hegde/fixwire/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/samartha-hegde/fixwire/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/samartha-hegde/fixwire/releases/tag/v0.1.0
