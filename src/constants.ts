/** Field separator (SOH, ASCII 0x01). */
export const SOH = '\x01';

/** Standard FIX tag numbers used by the session layer and common order messages. */
export const Tag = {
  // Standard header / trailer
  BeginString: 8,
  BodyLength: 9,
  MsgType: 35,
  MsgSeqNum: 34,
  SenderCompID: 49,
  TargetCompID: 56,
  SendingTime: 52,
  PossDupFlag: 43,
  OrigSendingTime: 122,
  CheckSum: 10,

  // Session (admin) messages
  HeartBtInt: 108,
  EncryptMethod: 98,
  TestReqID: 112,
  ResetSeqNumFlag: 141,
  // FIXT.1.1 / FIX 5.x application version
  DefaultApplVerID: 1137,
  ApplVerID: 1128,
  // Logon authentication
  RawDataLength: 95,
  RawData: 96,
  Username: 553,
  Password: 554,
  BeginSeqNo: 7,
  EndSeqNo: 16,
  NewSeqNo: 36,
  GapFillFlag: 123,
  RefSeqNum: 45,
  RefTagID: 371,
  SessionRejectReason: 373,
  Text: 58,

  // Common application fields (NewOrderSingle / ExecutionReport)
  ClOrdID: 11,
  Symbol: 55,
  Side: 54,
  OrderQty: 38,
  OrdType: 40,
  Price: 44,
  TransactTime: 60,
  ExecType: 150,
  OrdStatus: 39,
} as const;

/** Standard FIX MsgType (tag 35) values. */
export const MsgType = {
  Heartbeat: '0',
  TestRequest: '1',
  ResendRequest: '2',
  Reject: '3',
  SequenceReset: '4',
  Logout: '5',
  Logon: 'A',
  NewOrderSingle: 'D',
  ExecutionReport: '8',
} as const;
