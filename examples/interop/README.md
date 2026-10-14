# fixwire interop tests

Proof that fixwire speaks real FIX on the wire: it logs on, trades, and logs out
against **independent, battle-tested FIX engines** (not fixwire talking to
itself), passing their strict data-dictionary validation.

> There are no "open" public FIX servers to point at. Real FIX venues are
> regulated counterparties behind credentials and IP allowlists. The meaningful
> equivalent, and a stronger test, is interoperating with other engines'
> implementations locally. Each acceptor below is a different codebase in a
> different language.

Each test runs the same scenario through `client.ts` (the fixwire initiator):

```
Logon  ->  NewOrderSingle (BTC/USD limit)  ->  ExecutionReport (filled)  ->  Logout
```

`client.ts` exits non-zero on any failure (session Reject, BusinessMessageReject,
timeout, or socket error), so each `run.sh` is a pass/fail gate.

## Engines

| Engine | Language | Directory | Run |
| ------ | -------- | --------- | --- |
| [quickfixgo](https://github.com/quickfixgo/quickfix) | Go | `quickfixgo/` | `bash quickfixgo/run.sh` |
| [QuickFIX](https://github.com/quickfix/quickfix) | C++ (via Python bindings) | `quickfix-python/` | `bash quickfix-python/run.sh` |
| [QuickFIX/J](https://github.com/quickfix-j/quickfixj) | Java | `quickfixj/` | `bash quickfixj/run.sh` |

## Running

**quickfixgo** (needs Go):

```bash
bash quickfixgo/run.sh        # FIX.4.4 (default)
bash quickfixgo/run.sh 42     # FIX.4.2
bash quickfixgo/run.sh 50     # FIX 5.0 over FIXT.1.1
```

The script builds the Go acceptor, starts it with the matching data dictionary,
runs the fixwire client with the matching `BeginString`, and tears down. Expected
tail:

```
PASS  logon       quickfixgo (Go, FIX.4.4) accepted our Logon
PASS  fill        ExecutionReport order-1 ordStatus=2
PASS  interop with quickfixgo (Go, FIX.4.4) OK
```

fixwire is verified over **FIX 4.2, 4.4, and 5.0 (FIXT.1.1)** this way; the
4.2 order adds the `HandlInst` the older dictionary requires, and 5.0 sends
`DefaultApplVerID` on logon.

**QuickFIX (C++/Python)** (needs Python 3 and a C++ compiler):

```bash
cd quickfix-python
python3 -m venv .venv
.venv/bin/pip install quickfix        # compiles the C++ engine
cd ..
bash quickfix-python/run.sh
```

**QuickFIX/J** (needs a JDK):

```bash
# First run downloads the QuickFIX/J jars from Maven Central into quickfixj/lib,
# then compiles and runs. No Maven or Gradle required.
cd quickfixj
mkdir -p lib && cd lib
base=https://repo1.maven.org/maven2
for j in \
  org/quickfixj/quickfixj-core/2.3.1/quickfixj-core-2.3.1.jar \
  org/quickfixj/quickfixj-messages-fix44/2.3.1/quickfixj-messages-fix44-2.3.1.jar \
  org/apache/mina/mina-core/2.1.4/mina-core-2.1.4.jar \
  org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.jar \
  org/slf4j/slf4j-nop/1.7.36/slf4j-nop-1.7.36.jar ; do
  curl -fsSLO "$base/$j"
done
cd ../..
bash quickfixj/run.sh
```

## Notes

- Both acceptors validate against the real `FIX44.xml` data dictionary, so a
  malformed message from fixwire would be rejected. The client sends a complete
  NewOrderSingle (ClOrdID, Side, OrderQty, OrdType, Price, Symbol, TransactTime).
- `CLIENT` is the initiator CompID, `SERVER` the acceptor CompID, port 5101
  (quickfixgo) / 5102 (QuickFIX).
- These are opt-in developer tests; they are not part of `npm test` and pull no
  dependencies into the published package.
