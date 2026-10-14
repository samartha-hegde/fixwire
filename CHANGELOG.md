# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/samartha-hegde/fixwire/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/samartha-hegde/fixwire/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/samartha-hegde/fixwire/releases/tag/v0.1.0
