# Contributing to fixwire

Thanks for your interest - fixwire aims to be the FIX engine TypeScript
deserves, and that only happens with help from people who run FIX in anger.

## Ground rules

- **Correctness first.** This is financial infrastructure. A plausible-looking
  change to the session layer that subtly mishandles a resend is worse than no
  change. Every behavioural change needs a test that fails without it.
- **No runtime dependencies.** The published package has zero `dependencies`
  and we intend to keep it that way. Dev dependencies are fine.
- **Keep it typed and strict.** `tsc --strict` must pass with no `any` escapes
  in `src/`.

## Getting set up

```bash
git clone https://github.com/samartha-hegde/fixwire.git
cd fixwire
npm install
npm test        # node:test via tsx - no build step needed
npm run demo    # self-contained loopback round-trip
```

Node 20+ is required (the test runner uses `node --test`).

## Before you open a PR

Run the full local gate - CI runs exactly these:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run format` auto-fixes formatting.

## What makes a good PR

- **One focused change.** Separate refactors from behaviour changes.
- **A test per behaviour.** For session-layer work, add a scenario to
  `test/session.test.ts` using the in-process acceptor harness already there.
- **Honest comments.** If a change takes a deliberate shortcut with a known
  ceiling, mark it (see the `ponytail:` comments in `src/` for the style) so the
  next person knows it is a choice, not an oversight.
- **Update the CHANGELOG** under the `Unreleased` section.

## Areas we'd love help with

See the roadmap in the [README](./README.md#roadmap). High-value items:

- A persistent (file/db) `MessageStore` so resend survives restarts.
- The acceptor (server) side of the session.
- Additional FIX versions (4.2, 5.0 / FIXT) and dictionary-driven typed builders.
- Tested integrations against real venue UAT environments.

## Reporting bugs & security issues

- Functional bugs: open an issue with a minimal reproduction (ideally a failing
  test against the acceptor harness).
- Security issues: please follow [SECURITY.md](./SECURITY.md) and do **not**
  open a public issue.

## License

By contributing, you agree that your contributions are licensed under the MIT
License that covers this project.
