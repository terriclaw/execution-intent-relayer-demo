// src/server.ts
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "crypto";
import {
  createIntent,
  validateBeforeSubmission,
  verifySignedIntent,
  encodeIntentArgs,
  dataHash,
  defaultDomain,
  hashIntent,
} from "execution-intent-sdk";
import type { SignedIntent } from "execution-intent-sdk";
import { saveReceipt, getReceipt, allReceipts } from "./store.js";
import { runScopeChecks, scopeValid as checkScopeValid } from "./scope.js";
import { getOrDeployVerifier, submitToVerifier, publicClient, walletClient } from "./verifier.js";
import { computeSignedIntentDigest, computeAuthorityHash, buildVerifierId, computeResultDigest, signResultDigest, POLICY_VERSION } from "./receipt.js";
import type { RelayerIntentRequest, ExecutionReceipt, RelayerStatus } from "./types.js";
import { PORT } from "./config.js";

// Finalize a terminal receipt: ensure resultDigest, sign it, attach attestation.
async function finalizeReceipt(receipt: ExecutionReceipt): Promise<ExecutionReceipt> {
  if (!receipt.resultDigest) return receipt;
  const digest    = receipt.resultDigest as `0x${string}`;
  const sig       = await signResultDigest(digest, walletClient);
  const signer    = walletClient.account?.address ?? "unknown";
  return { ...receipt, receiptSigner: signer, receiptSignature: sig };
}

const app = new Hono();

let verifierAddress: `0x${string}` | null = null;
let domain: ReturnType<typeof defaultDomain> | null = null;

// Initialize verifier on startup
getOrDeployVerifier().then(addr => {
  verifierAddress = addr;
  const chainId = 31337; // Anvil
  domain = defaultDomain(addr, chainId);
  console.log(`[server] Verifier: ${addr}`);
  console.log(`[server] Listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// POST /intents
// ---------------------------------------------------------------------------
app.post("/intents", async (c) => {
  if (!verifierAddress || !domain) {
    return c.json({ error: "Verifier not ready" }, 503);
  }

  let body: RelayerIntentRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { signed: rawSigned, execution, grant } = body;
  if (!rawSigned?.intent || !rawSigned?.signer || !rawSigned?.signature || !execution) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Deserialize — bigints come as strings over JSON
  const intent = createIntent({
    account:  rawSigned.intent.account,
    target:   rawSigned.intent.target,
    value:    BigInt(rawSigned.intent.value),
    data:     rawSigned.intent.data as `0x${string}`,
    nonce:    BigInt(rawSigned.intent.nonce),
    deadline: BigInt(rawSigned.intent.deadline),
  });

  const signed: SignedIntent = {
    intent,
    signer:    rawSigned.signer,
    signature: rawSigned.signature,
  };

  const execTarget = execution.target as `0x${string}`;
  const execValue  = BigInt(execution.value);
  const execData   = execution.data as `0x${string}`;

  // Compute authority-binding hashes
  // intentHash = EIP-712 digest from hashIntent(intent, domain)
  // Same digest the signer signed and the onchain verifier recomputes.
  const intentHash    = computeSignedIntentDigest(intent, domain!);
  const authorityHash = grant ? computeAuthorityHash(grant) : undefined;
  const vId           = verifierAddress ? buildVerifierId(verifierAddress, 31337) : "unknown";

  const id = randomUUID();
  const baseReceipt: ExecutionReceipt = {
    id,
    status:        "received",
    signer:        signed.signer,
    account:       intent.account,
    target:        intent.target,
    value:         intent.value.toString(),
    dataHash:      dataHash(intent),
    nonce:         intent.nonce.toString(),
    deadline:      intent.deadline.toString(),
    intentHash,
    authorityHash,
    policyVersion: POLICY_VERSION,
    verifierId:    vId,
  };

  saveReceipt(baseReceipt);

  // ---------------------------------------------------------------------------
  // Offchain validation
  // ---------------------------------------------------------------------------
  const sigValid = await verifySignedIntent(signed, domain);
  if (!sigValid) {
    const receipt: ExecutionReceipt = {
      ...baseReceipt,
      status:         "rejected",
      offchainValid:  false,
      failureCodes:   ["INVALID_SIGNATURE"],
      failureReasons: ["Signature verification failed"],
    };
    const finalReceipt = await finalizeReceipt({ ...receipt, resultDigest: computeResultDigest({ intentHash, authorityHash, status: "rejected", verifierId: vId }) });
    saveReceipt(finalReceipt);
    console.log(`[relayer] ${id} REJECTED INVALID_SIGNATURE`);
    return c.json(finalReceipt, 400);
  }

  const validation = validateBeforeSubmission(signed, execTarget, execValue, execData);
  if (!validation.valid) {
    const receipt: ExecutionReceipt = {
      ...baseReceipt,
      status:         "rejected",
      offchainValid:  false,
      failureCodes:   validation.codes as any,
      failureReasons: validation.reasons,
    };
    const finalReceipt = await finalizeReceipt({ ...receipt, resultDigest: computeResultDigest({ intentHash, authorityHash, status: "rejected", verifierId: vId }) });
    saveReceipt(finalReceipt);
    console.log(`[relayer] ${id} REJECTED`, validation.codes);
    return c.json(finalReceipt, 400);
  }

  // ---------------------------------------------------------------------------
  // Grant scope checks (if grant supplied)
  // ---------------------------------------------------------------------------
  if (grant) {
    const checks = runScopeChecks(
      grant,
      execTarget,
      execValue,
      signed.signer,
      intent.deadline,
    );
    const valid = checkScopeValid(checks);
    if (!valid) {
      const failed = checks.filter(c => !c.pass);
      const receipt: ExecutionReceipt = {
        ...baseReceipt,
        status:         "rejected",
        offchainValid:  false,
        grant,
        scopeChecks:    checks,
        scopeValid:     false,
        failureCodes:   ["SCOPE_CHECK_FAILED"],
        failureReasons: failed.map(c => c.detail ?? c.code),
      };
      const finalReceipt = await finalizeReceipt({ ...receipt, resultDigest: computeResultDigest({ intentHash, authorityHash, status: "rejected", verifierId: vId }) });
      saveReceipt(finalReceipt);
      console.log(`[relayer] ${id} REJECTED scope checks failed:`, failed.map(c => c.code));
      return c.json(finalReceipt, 400);
    }
    // scope valid — attach to base receipt for confirmed/reverted path
    baseReceipt.grant       = grant;
    baseReceipt.scopeChecks = checks;
    baseReceipt.scopeValid  = true;
  }

  // ---------------------------------------------------------------------------
  // Submit onchain
  // ---------------------------------------------------------------------------
  console.log(`[relayer] ${id} SUBMITTING to verifier`);
  saveReceipt({ ...baseReceipt, status: "submitted" });

  const result = await submitToVerifier(
    verifierAddress,
    {
      account:  intent.account  as `0x${string}`,
      target:   intent.target   as `0x${string}`,
      value:    intent.value,
      dataHash: dataHash(intent),
      nonce:    intent.nonce,
      deadline: intent.deadline,
    },
    signed.signer    as `0x${string}`,
    signed.signature as `0x${string}`,
    execTarget,
    execValue,
    execData
  );

  const finalStatus: RelayerStatus = result.reverted ? "reverted" : "confirmed";
  const partialReceipt = {
    ...baseReceipt,
    status:        finalStatus,
    offchainValid: true,
    ...(result.txHash       ? { txHash:       result.txHash }                  : {}),
    ...(result.blockNumber  ? { blockNumber:  result.blockNumber.toString() }  : {}),
    ...(result.revertReason ? { revertReason: result.revertReason }            : {}),
  };
  const resultDigest = computeResultDigest({
    intentHash,
    authorityHash,
    status:     finalStatus,
    verifierId: vId,
    txHash:     result.txHash,
  });
  const receipt = await finalizeReceipt({ ...partialReceipt, resultDigest });
  saveReceipt(receipt);
  console.log(`[relayer] ${id} ${finalStatus.toUpperCase()} tx=${result.txHash}`);

  return c.json(receipt, result.reverted ? 200 : 201);
});

// ---------------------------------------------------------------------------
// GET /verifier — expose deployed verifier address for clients
// ---------------------------------------------------------------------------
app.get("/verifier", (c) => {
  if (!verifierAddress) return c.json({ error: "Not ready" }, 503);
  return c.json({ address: verifierAddress, chainId: 31337 });
});

// ---------------------------------------------------------------------------
// GET /intents/:id
// ---------------------------------------------------------------------------
app.get("/intents/:id", (c) => {
  const receipt = getReceipt(c.req.param("id"));
  if (!receipt) return c.json({ error: "Not found" }, 404);
  return c.json(receipt);
});

// ---------------------------------------------------------------------------
// GET /intents
// ---------------------------------------------------------------------------
app.get("/intents", (c) => {
  return c.json(allReceipts());
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[server] Started on http://localhost:${PORT}`);
});
