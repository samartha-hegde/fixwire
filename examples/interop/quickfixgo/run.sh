#!/usr/bin/env bash
# Interop test: fixwire (initiator) against a quickfixgo (Go) acceptor.
# Builds the acceptor if needed, starts it, runs the fixwire client, tears down.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../../.." && pwd)"
cd "$DIR"

[ -f FIX44.xml ] || curl -fsSL -o FIX44.xml \
  https://raw.githubusercontent.com/quickfixgo/quickfix/main/spec/FIX44.xml
[ -x ./executor ] || go build -o executor .

rm -f executor.log
./executor >executor.log 2>&1 &
EPID=$!
cleanup() { kill "$EPID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null && break
  sleep 0.2
done
if ! grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null; then
  echo "quickfixgo acceptor failed to start:"
  cat executor.log
  exit 1
fi

cd "$REPO"
FIX_PORT=5101 ENGINE="quickfixgo (Go)" node --import tsx examples/interop/client.ts
CODE=$?

echo ""
echo "--- quickfixgo acceptor saw ---"
grep -E "LOGON|ORDER|FILL|LOGOUT" "$DIR/executor.log" || true
exit $CODE
