// src/types.ts
import type { SignedIntent } from "execution-intent-sdk";

export type RelayerStatus =
  | "received"
  | "rejected"
  | "submitted"
  | "confirmed"
  | "reverted";

export interface RelayerIntentRequest {
  signed: {
    intent: {
      account:  string;
      target:   string;
      value:    string;
      data:     string;
      nonce:    string;
      deadline: string;
    };
    signer:    string;
    signature: string;
  };
  execution: {
    target: string;
    value:  string;
    data:   string;
  };
}

export interface ExecutionReceipt {
  id:              string;
  status:          RelayerStatus;
  signer:          string;
  account:         string;
  target:          string;
  value:           string;
  dataHash:        string;
  nonce:           string;
  deadline:        string;
  failureCodes?:   string[];
  failureReasons?: string[];
  txHash?:         string;
  blockNumber?:    string;
}
