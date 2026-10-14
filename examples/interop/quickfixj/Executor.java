// A minimal QuickFIX/J (Java) acceptor used to interop-test fixwire.
// Accepts a Logon, and for each NewOrderSingle replies with a filled
// ExecutionReport. Prints LOGON / ORDER / FILL / LOGOUT for the test runner.
import quickfix.*;
import quickfix.field.*;

public class Executor implements Application {
    private int execID = 0;

    public void onCreate(SessionID sessionID) {}

    public void onLogon(SessionID sessionID) {
        System.out.println("LOGON " + sessionID);
    }

    public void onLogout(SessionID sessionID) {
        System.out.println("LOGOUT " + sessionID);
    }

    public void toAdmin(Message message, SessionID sessionID) {}

    public void fromAdmin(Message message, SessionID sessionID) {}

    public void toApp(Message message, SessionID sessionID) {}

    public void fromApp(Message message, SessionID sessionID)
            throws FieldNotFound, UnsupportedMessageType, IncorrectTagValue {
        String msgType = message.getHeader().getString(MsgType.FIELD);
        if (MsgType.ORDER_SINGLE.equals(msgType)) {
            onOrder(message, sessionID);
        }
    }

    private void onOrder(Message message, SessionID sessionID) throws FieldNotFound {
        String clOrdID = message.getString(ClOrdID.FIELD);
        String symbol = message.getString(Symbol.FIELD);
        char side = message.getChar(Side.FIELD);
        double qty = message.getDouble(OrderQty.FIELD);
        double px = message.isSetField(Price.FIELD) ? message.getDouble(Price.FIELD) : 0.0;
        System.out.println("ORDER " + clOrdID + " " + symbol);

        Message exec = new Message();
        exec.getHeader().setField(new MsgType(MsgType.EXECUTION_REPORT));
        exec.setField(new OrderID(clOrdID));
        exec.setField(new ExecID(String.valueOf(++execID)));
        exec.setField(new ExecType(ExecType.FILL));
        exec.setField(new OrdStatus(OrdStatus.FILLED));
        exec.setField(new Symbol(symbol));
        exec.setField(new Side(side));
        exec.setField(new OrderQty(qty));
        exec.setField(new LeavesQty(0));
        exec.setField(new CumQty(qty));
        exec.setField(new AvgPx(px));
        exec.setField(new ClOrdID(clOrdID));

        try {
            Session.sendToTarget(exec, sessionID);
            System.out.println("FILL " + clOrdID);
        } catch (SessionNotFound e) {
            e.printStackTrace();
        }
    }

    public static void main(String[] args) throws Exception {
        SessionSettings settings = new SessionSettings("acceptor.cfg");
        Application app = new Executor();
        MessageStoreFactory storeFactory = new MemoryStoreFactory();
        LogFactory logFactory = new FileLogFactory(settings);
        MessageFactory messageFactory = new DefaultMessageFactory();
        Acceptor acceptor =
                new SocketAcceptor(app, storeFactory, settings, logFactory, messageFactory);
        acceptor.start();
        System.out.println("ACCEPTOR LISTENING");
        Thread.currentThread().join();
    }
}
