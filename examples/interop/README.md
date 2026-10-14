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
| [quickfixgo](https://github.com/quickfixgo/quickfix) | Go (C++ QuickFIX lineage) | `quickfixgo/` | `bash quickfixgo/run.sh` |
| [QuickFIX](https://github.com/quickfix/quickfix) | C++ (via Python bindings) | `quickfix-python/` | `bash quickfix-python/run.sh` |

## Running

**quickfixgo** (needs Go):

```bash
bash quickfixgo/run.sh
```

The script builds the Go acceptor, starts it, runs the fixwire client, and tears
down. Expected tail:

```
PASS  logon       quickfixgo (Go) accepted our Logon
PASS  fill        ExecutionReport order-1 ordStatus=2
PASS  interop with quickfixgo (Go) OK
```

**QuickFIX (C++/Python)** (needs Python 3 and a C++ compiler):

```bash
cd quickfix-python
python3 -m venv .venv
.venv/bin/pip install quickfix        # compiles the C++ engine
cd ..
bash quickfix-python/run.sh
```

## Notes

- Both acceptors validate against the real `FIX44.xml` data dictionary, so a
  malformed message from fixwire would be rejected. The client sends a complete
  NewOrderSingle (ClOrdID, Side, OrderQty, OrdType, Price, Symbol, TransactTime).
- `CLIENT` is the initiator CompID, `SERVER` the acceptor CompID, port 5101
  (quickfixgo) / 5102 (QuickFIX).
- These are opt-in developer tests; they are not part of `npm test` and pull no
  dependencies into the published package.
