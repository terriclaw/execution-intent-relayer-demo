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
  | "MALFORMED_PAYLOAD"
  | "SCOPE_CHECK_FAILED";

export type ScopeCheckCode =
  | "TARGET_ALLOWED"
  | "VALUE_WITHIN_LIMIT"
  | "DEADLINE_WITHIN_GRANT"
  | "GRANT_NOT_EXPIRED"
  | "SIGNER_IS_DELEGATE";

// GrantEnvelope models the early permission envelope.
// In this demo it is structured metadata supplied to the relayer.
// It is NOT a cryptographically verified delegation-framework grant.
// Future work: replace with real ERC-7710 / delegation-framework verification.
export interface GrantEnvelope {
  id:              string;
  delegator:       string;
  delegate:        string;
  allowedTargets?: `0x${string}`[];
  maxValue?:       string;          // bigint as decimal string
  expiry?:         string;          // unix timestamp as decimal string
  scopeHash?:      `0x${string}`;  // optional hash for future onchain reference
}

export interface ScopeCheck {
  code:    ScopeCheckCode;
  pass:    boolean;
  detail?: string;
}

// ExecutionReceipt is the audit object for each submitted intent.
//
// It answers:
//   - who signed the intent?
//   - what exact action was attempted?
//   - did offchain validation pass?
//   - did the action stay inside the declared grant envelope?
//   - was a transaction submitted?
//   - did the onchain verifier confirm or revert?
//
// Delegation grants authority.
// Execution intent binds the exact action.
// Execution receipt records what happened.
// Scope checks connect the late action back to the early grant envelope.

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

  // Grant envelope and scope checks (optional)
  grant?:       GrantEnvelope;
  scopeChecks?: ScopeCheck[];
  scopeValid?:  boolean;

  // Onchain submission result
  txHash?:       string;
  blockNumber?:  string;
  revertReason?: string;

  // Authority binding — joins intent, authority context, and result
  intentHash?:    string;   // EIP-712 digest from hashIntent(intent, domain)
  authorityHash?: string;   // hash of supplied GrantEnvelope (not onchain delegation proof)
  policyVersion?: string;   // version of offchain scope-check policy
  verifierId?:    string;   // eip155:{chainId}:{verifierAddress}
  resultDigest?:  string;   // hash of final receipt summary

  // Receipt attestation — relayer signs resultDigest at terminal state
  receiptSigner?:    string;   // relayer account address
  receiptSignature?: string;   // EIP-191 signature over resultDigest

  // Authority source — distinguishes demo grant metadata from delegation-framework hash
  authoritySource?: "grant-envelope" | "delegation-framework";
}

// Re-export for use in server
export type { DelegationInput } from "./delegationAdapter.js";

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
  grant?:      GrantEnvelope;
  delegation?: import("./delegationAdapter.js").DelegationInput;
}
