// A version-agnostic quickfixgo acceptor (executor) used to interop-test fixwire
// across FIX 4.2, 4.4, and 5.0 (FIXT.1.1). It accepts a logon and replies to each
// NewOrderSingle with a filled ExecutionReport, building the reply from raw tags
// so the same code serves every FIX version. Pass the config path as argv[1].
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/quickfixgo/quickfix"
	"github.com/quickfixgo/tag"
)

type executor struct {
	execID int
}

func (e *executor) OnCreate(quickfix.SessionID)                   {}
func (e *executor) OnLogon(id quickfix.SessionID)                 { fmt.Println("LOGON", id) }
func (e *executor) OnLogout(id quickfix.SessionID)                { fmt.Println("LOGOUT", id) }
func (e *executor) ToAdmin(*quickfix.Message, quickfix.SessionID) {}
func (e *executor) ToApp(*quickfix.Message, quickfix.SessionID) error {
	return nil
}
func (e *executor) FromAdmin(*quickfix.Message, quickfix.SessionID) quickfix.MessageRejectError {
	return nil
}

func (e *executor) FromApp(
	msg *quickfix.Message,
	sessionID quickfix.SessionID,
) quickfix.MessageRejectError {
	msgType, err := msg.Header.GetString(tag.MsgType)
	if err != nil {
		return err
	}
	if msgType != "D" { // NewOrderSingle
		return nil
	}

	get := func(t quickfix.Tag) string { v, _ := msg.Body.GetString(t); return v }
	clOrdID := get(tag.ClOrdID)
	symbol := get(tag.Symbol)
	side := get(tag.Side)
	qty := get(tag.OrderQty)
	px := get(tag.Price)
	if px == "" {
		px = "0"
	}
	fmt.Println("ORDER", clOrdID, symbol)

	e.execID++
	reply := quickfix.NewMessage()
	reply.Header.SetString(tag.MsgType, "8") // ExecutionReport
	reply.Body.SetString(tag.OrderID, clOrdID)
	reply.Body.SetString(tag.ExecID, fmt.Sprintf("exec-%d", e.execID))

	execType := "F" // TRADE (FIX 4.3+)
	if sessionID.BeginString == "FIX.4.2" {
		reply.Body.SetString(tag.ExecTransType, "0") // required in FIX 4.2
		execType = "2"                               // FILL
	}
	reply.Body.SetString(tag.ExecType, execType)
	reply.Body.SetString(tag.OrdStatus, "2") // FILLED
	reply.Body.SetString(tag.Symbol, symbol)
	reply.Body.SetString(tag.Side, side)
	reply.Body.SetString(tag.LeavesQty, "0")
	reply.Body.SetString(tag.CumQty, qty)
	reply.Body.SetString(tag.AvgPx, px)
	reply.Body.SetString(tag.ClOrdID, clOrdID)

	if err := quickfix.SendToTarget(reply, sessionID); err != nil {
		fmt.Println("send error:", err)
	} else {
		fmt.Println("FILL", clOrdID)
	}
	return nil
}

func main() {
	cfgPath := "acceptor.cfg"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}
	cfg, err := os.Open(cfgPath)
	if err != nil {
		panic(err)
	}
	settings, err := quickfix.ParseSettings(cfg)
	if err != nil {
		panic(err)
	}
	acceptor, err := quickfix.NewAcceptor(
		&executor{},
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
