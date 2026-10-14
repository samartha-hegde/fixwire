// A minimal quickfixgo acceptor (executor) used to interop-test fixwire.
// It accepts a logon, and for each NewOrderSingle replies with a filled
// ExecutionReport. Prints LOGON / ORDER / FILL so the test runner can observe it.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/quickfixgo/enum"
	fix44er "github.com/quickfixgo/fix44/executionreport"
	fix44nos "github.com/quickfixgo/fix44/newordersingle"
	"github.com/quickfixgo/field"
	"github.com/quickfixgo/quickfix"
	"github.com/shopspring/decimal"
)

type executor struct {
	*quickfix.MessageRouter
	execID int
}

func newExecutor() *executor {
	e := &executor{MessageRouter: quickfix.NewMessageRouter()}
	e.AddRoute(fix44nos.Route(e.onNewOrderSingle))
	return e
}

func (e *executor) OnCreate(quickfix.SessionID)                               {}
func (e *executor) OnLogon(id quickfix.SessionID)                             { fmt.Println("LOGON", id) }
func (e *executor) OnLogout(id quickfix.SessionID)                            { fmt.Println("LOGOUT", id) }
func (e *executor) ToAdmin(*quickfix.Message, quickfix.SessionID)             {}
func (e *executor) ToApp(*quickfix.Message, quickfix.SessionID) error         { return nil }
func (e *executor) FromAdmin(*quickfix.Message, quickfix.SessionID) quickfix.MessageRejectError {
	return nil
}

func (e *executor) FromApp(msg *quickfix.Message, id quickfix.SessionID) quickfix.MessageRejectError {
	return e.Route(msg, id)
}

func (e *executor) nextExecID() string {
	e.execID++
	return fmt.Sprintf("exec-%d", e.execID)
}

func (e *executor) onNewOrderSingle(
	msg fix44nos.NewOrderSingle,
	sessionID quickfix.SessionID,
) quickfix.MessageRejectError {
	clOrdID, err := msg.GetClOrdID()
	if err != nil {
		return err
	}
	symbol, err := msg.GetSymbol()
	if err != nil {
		return err
	}
	side, err := msg.GetSide()
	if err != nil {
		return err
	}
	qty, err := msg.GetOrderQty()
	if err != nil {
		return err
	}
	price := decimal.Zero
	if msg.HasPrice() {
		price, _ = msg.GetPrice()
	}
	fmt.Println("ORDER", clOrdID, symbol)

	exec := fix44er.New(
		field.NewOrderID(clOrdID),
		field.NewExecID(e.nextExecID()),
		field.NewExecType(enum.ExecType_FILL),
		field.NewOrdStatus(enum.OrdStatus_FILLED),
		field.NewSide(side),
		field.NewLeavesQty(decimal.Zero, 2),
		field.NewCumQty(qty, 2),
		field.NewAvgPx(price, 2),
	)
	exec.SetClOrdID(clOrdID)
	exec.SetSymbol(symbol)
	exec.SetOrderQty(qty, 2)

	if err := quickfix.SendToTarget(exec, sessionID); err != nil {
		fmt.Println("send error:", err)
	} else {
		fmt.Println("FILL", clOrdID)
	}
	return nil
}

func main() {
	cfg, err := os.Open("acceptor.cfg")
	if err != nil {
		panic(err)
	}
	settings, err := quickfix.ParseSettings(cfg)
	if err != nil {
		panic(err)
	}
	acceptor, err := quickfix.NewAcceptor(
		newExecutor(),
		quickfix.NewMemoryStoreFactory(),
		settings,
		quickfix.NewNullLogFactory(),
	)
	if err != nil {
		panic(err)
	}
	if err := acceptor.Start(); err != nil {
		panic(err)
	}
	defer acceptor.Stop()
	fmt.Println("ACCEPTOR LISTENING")

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
}
