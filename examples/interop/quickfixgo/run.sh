#!/usr/bin/env bash
# Interop test: fixwire (initiator) against a quickfixgo (Go) acceptor.
# Usage: run.sh [44|42|50]   (FIX protocol version; default 44)
# Builds the acceptor, starts it with the right dictionary, runs the fixwire
# client with a matching BeginString, and tears down.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../../.." && pwd)"
cd "$DIR"

VERSION="${1:-44}"
SPEC_BASE="https://raw.githubusercontent.com/quickfixgo/quickfix/main/spec"
case "$VERSION" in
44) CFG=acceptor.cfg    PORT=5101 BEGIN=FIX.4.4  APPLVER="" SPECS="FIX44.xml" ;;
42) CFG=acceptor-42.cfg PORT=5111 BEGIN=FIX.4.2  APPLVER="" SPECS="FIX42.xml" ;;
50) CFG=acceptor-50.cfg PORT=5112 BEGIN=FIXT.1.1 APPLVER="9" SPECS="FIXT11.xml FIX50SP2.xml" ;;
*)
  echo "usage: $0 [44|42|50]"
  exit 1
  ;;
esac

for s in $SPECS; do
  [ -f "$s" ] || curl -fsSL -o "$s" "$SPEC_BASE/$s"
done
[ -x ./executor ] || go build -o executor .

rm -f executor.log
./executor "$CFG" >executor.log 2>&1 &
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
FIX_PORT=$PORT FIX_BEGIN_STRING=$BEGIN FIX_APPL_VER_ID=$APPLVER ENGINE="quickfixgo (Go, $BEGIN)" \
  node --import tsx examples/interop/client.ts
CODE=$?

echo ""
echo "--- quickfixgo acceptor saw ---"
grep -E "LOGON|ORDER|FILL|LOGOUT" "$DIR/executor.log" || true
exit $CODE
