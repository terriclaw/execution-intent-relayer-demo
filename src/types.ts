// src/types.ts

export type RelayerStatus =
  | "received"
  | "rejected"
  | "submitted"
  | "confirmed"
  | "reverted";

export type FailureCode =
  | "INVALID_SIGNATURE"
  | "DEADLINE_EXPIRED"
  | "EXECUTION_MISMATCH"
  | "NONCE_REUSE_RISK"
  | "MALFORMED_PAYLOAD";

// ExecutionReceipt is the audit object for each submitted intent.
//
// It answers:
//   - who signed the intent?
//   - what exact action was attempted?
//   - did offchain validation pass?
//   - was a transaction submitted?
//   - did the onchain verifier confirm or revert?
//   - what failure codes explain rejection?
//
// In a fuller delegated-authority system, a receipt would also reference
// the early permission grant and include scope checks proving the final
// action stayed inside that grant. That is out of scope for v1.

export interface ExecutionReceipt {
  // Identity
  id:       string;
  status:   RelayerStatus;

  // Intent fields (what was signed)
  signer:   string;
  account:  string;
  target:   string;
  value:    string;
  dataHash: string;
  nonce:    string;
  deadline: string;

  // Offchain validation result
  offchainValid?:  boolean;
  failureCodes?:   FailureCode[];
  failureReasons?: string[];

  // Onchain submission result
  txHash?:       string;   // present if tx was submitted (confirmed or reverted onchain)
  blockNumber?:  string;
  revertReason?: string;   // present if tx failed before reaching the chain
}

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
