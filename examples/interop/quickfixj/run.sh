#!/usr/bin/env bash
# Interop test: fixwire (initiator) against a QuickFIX/J (Java) acceptor.
# Downloads jars on first run (see README), compiles Executor.java, runs it.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../../.." && pwd)"
cd "$DIR"

[ -f FIX44.xml ] || curl -fsSL -o FIX44.xml \
  https://raw.githubusercontent.com/quickfixgo/quickfix/main/spec/FIX44.xml

CP="lib/*:."
[ -f Executor.class ] || javac -cp "$CP" Executor.java

mkdir -p log
rm -f executor.log
java -cp "$CP" Executor >executor.log 2>&1 &
EPID=$!
cleanup() { kill "$EPID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null && break
  sleep 0.2
done
if ! grep -q "ACCEPTOR LISTENING" executor.log 2>/dev/null; then
  echo "QuickFIX/J acceptor failed to start:"
  cat executor.log
  exit 1
fi

cd "$REPO"
FIX_PORT=5103 ENGINE="QuickFIX/J (Java)" node --import tsx examples/interop/client.ts
CODE=$?

echo ""
echo "--- QuickFIX/J acceptor saw ---"
grep -E "LOGON|ORDER|FILL|LOGOUT" "$DIR/executor.log" || true
exit $CODE
