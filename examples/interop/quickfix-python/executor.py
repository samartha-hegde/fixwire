"""A minimal QuickFIX (C++ reference engine, via Python) acceptor to interop-test
fixwire. Accepts a Logon, and for each NewOrderSingle replies with a filled
ExecutionReport. Prints LOGON / ORDER / FILL / LOGOUT for the test runner."""

import sys
import time

import quickfix as fix


class Executor(fix.Application):
    def __init__(self):
        super().__init__()
        self.exec_id = 0

    def onCreate(self, session_id):
        pass

    def onLogon(self, session_id):
        print("LOGON", session_id, flush=True)

    def onLogout(self, session_id):
        print("LOGOUT", session_id, flush=True)

    def toAdmin(self, message, session_id):
        pass

    def fromAdmin(self, message, session_id):
        pass

    def toApp(self, message, session_id):
        pass

    def fromApp(self, message, session_id):
        msg_type = fix.MsgType()
        message.getHeader().getField(msg_type)
        if msg_type.getValue() == fix.MsgType_NewOrderSingle:
            self.on_order(message, session_id)

    def next_exec_id(self):
        self.exec_id += 1
        return str(self.exec_id)

    def on_order(self, message, session_id):
        cl_ord_id = fix.ClOrdID()
        message.getField(cl_ord_id)
        symbol = fix.Symbol()
        message.getField(symbol)
        side = fix.Side()
        message.getField(side)
        order_qty = fix.OrderQty()
        message.getField(order_qty)
        price_val = 0.0
        try:
            price = fix.Price()
            message.getField(price)
            price_val = price.getValue()
        except Exception:
            pass
        print("ORDER", cl_ord_id.getValue(), symbol.getValue(), flush=True)

        report = fix.Message()
        report.getHeader().setField(fix.MsgType(fix.MsgType_ExecutionReport))
        report.setField(fix.OrderID(cl_ord_id.getValue()))
        report.setField(fix.ExecID(self.next_exec_id()))
        report.setField(fix.ExecType(fix.ExecType_FILL))
        report.setField(fix.OrdStatus(fix.OrdStatus_FILLED))
        report.setField(symbol)
        report.setField(side)
        report.setField(fix.LeavesQty(0))
        report.setField(fix.CumQty(order_qty.getValue()))
        report.setField(fix.AvgPx(price_val))
        report.setField(cl_ord_id)
        report.setField(order_qty)

        fix.Session.sendToTarget(report, session_id)
        print("FILL", cl_ord_id.getValue(), flush=True)


def main():
    settings = fix.SessionSettings("acceptor.cfg")
    app = Executor()
    store = fix.MemoryStoreFactory()
    log = fix.FileLogFactory(settings)
    acceptor = fix.SocketAcceptor(app, store, settings, log)
    acceptor.start()
    print("ACCEPTOR LISTENING", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        acceptor.stop()
        sys.exit(0)


if __name__ == "__main__":
    main()
