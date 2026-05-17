// src/delegationAdapter.ts
// Delegation-framework authority hash adapter — Phase 1.
//
// Computes delegation hashes using the same logic as MetaMask delegation-framework's
// EncoderLib._getDelegationHash() and DelegationManager.getDomainHash().
//
// This is pure TypeScript — no onchain call required for hashing.
//
// Phase 1: hash-only. Delegation signature is NOT verified yet.
// Phase 2 (future): verify delegation.signature against delegator using domain hash.
// Phase 3 (future): parse caveat terms into ScopeCheck[].
// Phase 4 (future): full DelegationManager redemption path.
//
// References:
//   EncoderLib.sol — _getDelegationHash, _getCaveatArrayPacketHash, _getCaveatPacketHash
//   Constants.sol  — DELEGATION_TYPEHASH, CAVEAT_TYPEHASH
//   Types.sol      — Delegation, Caveat structs

import { keccak256, encodeAbiParameters, encodePacked, parseAbiParameters, recoverAddress, concat } from "viem";

// ---------------------------------------------------------------------------
// Type definitions mirroring delegation-framework Solidity structs
// ---------------------------------------------------------------------------

export interface DelegationCaveat {
  enforcer: `0x${string}`;
  terms:    `0x${string}`;   // bytes — committed at delegation time
  args?:    `0x${string}`;   // bytes — excluded from hash by design
}

export interface DelegationInput {
  delegate:   `0x${string}`;
  delegator:  `0x${string}`;
  authority:  `0x${string}`;  // ROOT_AUTHORITY or parent delegation hash
  caveats:    DelegationCaveat[];
  salt:       bigint;
  signature?: `0x${string}`; // excluded from hash — verified separately
}

// ---------------------------------------------------------------------------
// Typehashs — match Constants.sol exactly
// ---------------------------------------------------------------------------

// keccak256("Caveat(address enforcer,bytes terms)")
const CAVEAT_TYPEHASH = keccak256(
  encodePacked(["string"], ["Caveat(address enforcer,bytes terms)"])
);

// keccak256("Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)")
const DELEGATION_TYPEHASH = keccak256(
  encodePacked(
    ["string"],
    ["Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"]
  )
);

// ---------------------------------------------------------------------------
// Hashing — mirrors EncoderLib._getDelegationHash
// ---------------------------------------------------------------------------

function getCaveatPacketHash(caveat: DelegationCaveat): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32 typehash, address enforcer, bytes32 termsHash"),
      [CAVEAT_TYPEHASH, caveat.enforcer, keccak256(caveat.terms)]
    )
  );
}

function getCaveatArrayPacketHash(caveats: DelegationCaveat[]): `0x${string}` {
  if (caveats.length === 0) {
    return keccak256(encodePacked([], []));
  }
  const hashes = caveats.map(getCaveatPacketHash);
  return keccak256(encodePacked(
    hashes.map(() => "bytes32" as const),
    hashes
  ));
}

export function computeDelegationHash(delegation: DelegationInput): `0x${string}` {
  const caveatsHash = getCaveatArrayPacketHash(delegation.caveats);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32 typehash, address delegate, address delegator, bytes32 authority, bytes32 caveatsHash, uint256 salt"),
      [
        DELEGATION_TYPEHASH,
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        caveatsHash,
        delegation.salt,
      ]
    )
  );
}

// ---------------------------------------------------------------------------
// Domain hash — mirrors DelegationManager.getDomainHash()
// For future Phase 2 signature verification.
// ---------------------------------------------------------------------------

export function computeDelegationDomainHash(
  chainId:               number,
  delegationManagerAddress: `0x${string}`
): `0x${string}` {
  const EIP712_DOMAIN_TYPEHASH = keccak256(
    encodePacked(
      ["string"],
      ["EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"]
    )
  );
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32 typeHash, bytes32 name, bytes32 version, uint256 chainId, address verifyingContract"),
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(encodePacked(["string"], ["DelegationManager"])),
        keccak256(encodePacked(["string"], ["1"])),
        BigInt(chainId),
        delegationManagerAddress,
      ]
    )
  );
}

// ---------------------------------------------------------------------------
// Authority summary — human-readable receipt metadata
// ---------------------------------------------------------------------------

export interface CaveatSummary {
  enforcer: string;
  termsLength: number;
  // Future: parsed terms for known enforcers
}

export interface DelegationAuthoritySummary {
  delegationHash:  `0x${string}`;
  delegator:       string;
  delegate:        string;
  caveatCount:     number;
  caveats:         CaveatSummary[];
  signaturePresent: boolean;
  // Phase 2: signatureVerified: boolean
}

export function summarizeDelegation(delegation: DelegationInput): DelegationAuthoritySummary {
  return {
    delegationHash:   computeDelegationHash(delegation),
    delegator:        delegation.delegator,
    delegate:         delegation.delegate,
    caveatCount:      delegation.caveats.length,
    caveats:          delegation.caveats.map(c => ({
      enforcer:    c.enforcer,
      termsLength: (c.terms.length - 2) / 2, // bytes
    })),
    signaturePresent: !!delegation.signature,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: EOA delegation signature verification
//
// Mirrors DelegationManager signature validation (EOA path only):
//   digest = keccak256(0x1901 || domainHash || delegationHash)
//   recovered = ECDSA.recover(digest, signature)
//   valid = recovered == delegation.delegator
//
// ERC-1271 smart-account delegators are explicitly out of scope for Phase 2.
// ---------------------------------------------------------------------------

export interface DelegationSignatureVerification {
  delegationHash: `0x${string}`;
  domainHash:     `0x${string}`;
  digest:         `0x${string}`;
  recoveredSigner?: `0x${string}`;
  valid:          boolean;
  error?:         string;
}

export async function verifyDelegationSignature(params: {
  delegation:        DelegationInput;
  chainId:           number;
  verifyingContract: `0x${string}`;
}): Promise<DelegationSignatureVerification> {
  const { delegation, chainId, verifyingContract } = params;

  const delegationHash = computeDelegationHash(delegation);
  const domainHash     = computeDelegationDomainHash(chainId, verifyingContract);

  // EIP-712 digest: keccak256(0x1901 || domainHash || delegationHash)
  const digest = keccak256(
    concat(["0x1901", domainHash, delegationHash])
  );

  if (!delegation.signature || delegation.signature === "0x") {
    return { delegationHash, domainHash, digest, valid: false, error: "no signature provided" };
  }

  try {
    const recoveredSigner = await recoverAddress({
      hash:      digest,
      signature: delegation.signature,
    });

    const valid = recoveredSigner.toLowerCase() === delegation.delegator.toLowerCase();

    return {
      delegationHash,
      domainHash,
      digest,
      recoveredSigner,
      valid,
      error: valid ? undefined : `recovered ${recoveredSigner} but expected ${delegation.delegator}`,
    };
  } catch (e: any) {
    return {
      delegationHash,
      domainHash,
      digest,
      valid:  false,
      error:  e?.message ?? "signature recovery failed",
    };
  }
}
