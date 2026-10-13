# Security Policy

## Supported Versions

fixwire is pre-1.0. Security fixes are applied to the latest `0.x` release.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately using GitHub's
[private vulnerability reporting](https://github.com/samartha-hegde/fixwire/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab).

Please include:

- A description of the issue and its impact
- Steps to reproduce (a failing test or minimal script is ideal)
- Any suggested remediation

You can expect an acknowledgement within a few days. Once the issue is confirmed
and a fix is prepared, we will coordinate a disclosure timeline with you and
credit you in the release notes unless you prefer to remain anonymous.

## Scope

fixwire parses and generates FIX wire data and manages TCP/TLS sessions.
Security-relevant areas include:

- Message parsing / framing (malformed or hostile input over the socket)
- TLS configuration and certificate handling
- Sequence-number and session-state handling

Denial-of-service via malformed input and memory-safety of the parser are
in scope.
