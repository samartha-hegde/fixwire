#!/usr/bin/env bash
# Interop test: fixwire (initiator) against a QuickFIX (C++/Python) acceptor.
# Expects a .venv with the `quickfix` package installed (see README).
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../../.." && pwd)"
cd "$DIR"

PY="$DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "QuickFIX Python venv not found. Run: python3 -m venv .venv && .venv/bin/pip install quickfix"
  exit 1
fi

[ -f FIX44.xml ] || curl -fsSL -o FIX44.xml \
  https://raw.githubusercontent.com/quickfixgo/quickfix/main/spec/FIX44.xml
mkdir -p log
rm -f executor.log
"$PY" executor.py >executor.log 2>&1 &
EPID=$!
cleanup() { kill "$EPID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null && break
  sleep 0.2
done
if ! grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null; then
  echo "QuickFIX Python acceptor failed to start:"
  cat executor.log
  exit 1
fi

cd "$REPO"
FIX_PORT=5102 ENGINE="QuickFIX (C++/Python)" node --import tsx examples/interop/client.ts
CODE=$?

echo ""
echo "--- QuickFIX acceptor saw ---"
grep -E "LOGON|ORDER|FILL|LOGOUT" "$DIR/executor.log" || true
exit $CODE
