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
} from "execution-intent-sdk";
import type { SignedIntent } from "execution-intent-sdk";
import { saveReceipt, getReceipt, allReceipts } from "./store.js";
import { getOrDeployVerifier, submitToVerifier, publicClient } from "./verifier.js";
import type { RelayerIntentRequest, ExecutionReceipt } from "./types.js";
import { PORT } from "./config.js";

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

  const { signed: rawSigned, execution } = body;
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

  const id = randomUUID();
  const baseReceipt: ExecutionReceipt = {
    id,
    status:   "received",
    signer:   signed.signer,
    account:  intent.account,
    target:   intent.target,
    value:    intent.value.toString(),
    dataHash: dataHash(intent),
    nonce:    intent.nonce.toString(),
    deadline: intent.deadline.toString(),
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
      failureCodes:   ["INVALID_SIGNATURE"],
      failureReasons: ["Signature verification failed"],
    };
    saveReceipt(receipt);
    console.log(`[relayer] ${id} REJECTED INVALID_SIGNATURE`);
    return c.json(receipt, 400);
  }

  const validation = validateBeforeSubmission(signed, execTarget, execValue, execData);
  if (!validation.valid) {
    const receipt: ExecutionReceipt = {
      ...baseReceipt,
      status:         "rejected",
      failureCodes:   validation.codes,
      failureReasons: validation.reasons,
    };
    saveReceipt(receipt);
    console.log(`[relayer] ${id} REJECTED`, validation.codes);
    return c.json(receipt, 400);
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

  const finalStatus = result.reverted ? "reverted" : "confirmed";
  const receipt: ExecutionReceipt = {
    ...baseReceipt,
    status:      finalStatus,
    txHash:      result.txHash,
    blockNumber: result.blockNumber.toString(),
  };
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
