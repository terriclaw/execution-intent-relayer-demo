// src/receipt.ts
// Receipt hashing helpers.
//
// These functions compute deterministic hashes that bind the receipt
// to the exact intent, authority context, and result.
//
// Important distinction:
//   intentHash   = local deterministic hash of intent fields (not EIP-712 digest)
//   authorityHash = hash of supplied GrantEnvelope metadata (not onchain delegation proof)
//   resultDigest  = hash of final receipt summary
//
// These hashes make the receipt an authority-bound audit object.
// They do NOT prove the grant is a cryptographically verified delegation.
// Future work: replace GrantEnvelope with real delegation-framework objects
// and include authority hash in the onchain-verified payload.

import { keccak256, toHex } from "viem";
import { hashIntent } from "execution-intent-sdk";
import type { ExecutionIntent, IntentDomain } from "execution-intent-sdk";
import type { GrantEnvelope, ExecutionReceipt } from "./types.js";

export const POLICY_VERSION = "demo-scope-v1";

// ---------------------------------------------------------------------------
// intentHash / signed intent digest
// Uses hashIntent(intent, domain) from execution-intent-sdk.
// Returns the EIP-712 digest — the same value the signer signed,
// the SDK verifies, and the onchain verifier recomputes.
// ---------------------------------------------------------------------------
export function computeSignedIntentDigest(
  intent: ExecutionIntent,
  domain: IntentDomain,
): `0x${string}` {
  return hashIntent(intent, domain);
}

// ---------------------------------------------------------------------------
// authorityHash
// Deterministic hash of the GrantEnvelope metadata.
// Lowercase addresses, sort allowedTargets for determinism.
// Does NOT prove the grant is a verified delegation.
// ---------------------------------------------------------------------------
export function computeAuthorityHash(grant: GrantEnvelope): `0x${string}` {
  const canonical = {
    id:             grant.id,
    delegator:      grant.delegator.toLowerCase(),
    delegate:       grant.delegate.toLowerCase(),
    allowedTargets: (grant.allowedTargets ?? []).map(t => t.toLowerCase()).sort(),
    maxValue:       grant.maxValue ?? "0",
    expiry:         grant.expiry ?? "0",
  };
  const json = JSON.stringify(canonical);
  return keccak256(toHex(json));
}

// ---------------------------------------------------------------------------
// verifierId
// Human-readable + hashable identifier for the verifier instance.
// Format: eip155:{chainId}:{verifierAddress}
// ---------------------------------------------------------------------------
export function buildVerifierId(verifierAddress: string, chainId: number): string {
  return `eip155:${chainId}:${verifierAddress.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// resultDigest
// Hash of the final receipt summary fields.
// Binds: intentHash + authorityHash + status + verifierId + txHash
// ---------------------------------------------------------------------------
export function computeResultDigest(fields: {
  intentHash:    `0x${string}`;
  authorityHash?: `0x${string}`;
  status:        string;
  verifierId:    string;
  txHash?:       string;
}): `0x${string}` {
  const summary = JSON.stringify({
    intentHash:    fields.intentHash,
    authorityHash: fields.authorityHash ?? null,
    status:        fields.status,
    verifierId:    fields.verifierId,
    txHash:        fields.txHash ?? null,
  });
  return keccak256(toHex(summary));
}
