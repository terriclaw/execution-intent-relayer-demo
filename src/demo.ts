// src/demo.ts
// End-to-end demo: valid intent, mutation, replay.
// Run: npm run demo
// Requires: anvil running + server running (npm run dev)

import "dotenv/config";
import {
  createIntent,
  signIntent,
  defaultDomain,
  dataHash,
} from "execution-intent-sdk";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}`;
const SERVER_URL  = `http://localhost:${process.env.PORT ?? 8787}`;
const CHAIN_ID    = 31337;

const account = privateKeyToAccount(PRIVATE_KEY);

async function postIntent(signed: any, execution: any) {
  const res = await fetch(`${SERVER_URL}/intents`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      signed: {
        intent: {
          account:  signed.intent.account,
          target:   signed.intent.target,
          value:    signed.intent.value.toString(),
          data:     signed.intent.data,
          nonce:    signed.intent.nonce.toString(),
          deadline: signed.intent.deadline.toString(),
        },
        signer:    signed.signer,
        signature: signed.signature,
      },
      execution: {
        target: execution.target,
        value:  execution.value.toString(),
        data:   execution.data,
      },
    }),
  });
  return res.json();
}

async function main() {
  console.log("=== Execution Intent Relayer Demo ===");
  console.log("Server:", SERVER_URL);
  console.log("Signer:", account.address);
  console.log();

  // Get the verifier address from the running server
  const verifierRes = await fetch(`${SERVER_URL}/verifier`);
  if (!verifierRes.ok) throw new Error("Server not ready — start it with: npm run dev");
  const { address: verifier, chainId } = await verifierRes.json() as { address: `0x${string}`, chainId: number };
  const domain = defaultDomain(verifier, chainId);
  console.log("Verifier:", verifier);
  console.log();

  const calldata = ("0xa9059cbb" +
    "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" +
    "0000000000000000000000000000000000000000000000056bc75e2d63100000"
  ) as `0x${string}`;

  // ---------------------------------------------------------------------------
  // Case 1: Valid intent
  // ---------------------------------------------------------------------------
  console.log("--- Case 1: Valid exact execution ---");
  const intent1 = createIntent({
    account:  account.address,
    target:   "0x0000000000000000000000000000000000000001",
    value:    0n,
    data:     calldata,
    nonce:    1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });

  const signed1 = await signIntent(intent1, domain, PRIVATE_KEY);
  const result1 = await postIntent(signed1, {
    target: intent1.target,
    value:  intent1.value,
    data:   calldata,
  });

  console.log("Status:", result1.status);
  console.log("txHash:", result1.txHash?.slice(0, 20) + "...");
  console.log();

  // ---------------------------------------------------------------------------
  // Case 2: Mutated calldata
  // ---------------------------------------------------------------------------
  console.log("--- Case 2: Mutated calldata (relayer catches offchain) ---");
  const intent2 = createIntent({
    account:  account.address,
    target:   "0x0000000000000000000000000000000000000001",
    value:    0n,
    data:     calldata,
    nonce:    2n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });

  const signed2 = await signIntent(intent2, domain, PRIVATE_KEY);
  const mutated = ("0xa9059cbb" +
    "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" +
    "0000000000000000000000000000000000000000000000056bc75e2d63100001"
  ) as `0x${string}`;

  const result2 = await postIntent(signed2, {
    target: intent2.target,
    value:  intent2.value,
    data:   mutated,
  });

  console.log("Status:", result2.status);
  console.log("Failure codes:", result2.failureCodes);
  console.log();

  // ---------------------------------------------------------------------------
  // Case 3: Replay (same nonce as Case 1)
  // ---------------------------------------------------------------------------
  console.log("--- Case 3: Replay (onchain catches) ---");
  const intent3 = createIntent({
    account:  account.address,
    target:   "0x0000000000000000000000000000000000000001",
    value:    0n,
    data:     calldata,
    nonce:    1n, // same nonce as case 1
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });

  const signed3 = await signIntent(intent3, domain, PRIVATE_KEY);
  const result3 = await postIntent(signed3, {
    target: intent3.target,
    value:  intent3.value,
    data:   calldata,
  });

  console.log("Status:", result3.status);
  console.log("txHash:", result3.txHash?.slice(0, 20) + "...");
  console.log();

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("=== Summary ===");
  console.log("Case 1 (valid):   ", result1.status);
  console.log("Case 2 (mutated): ", result2.status, result2.failureCodes ?? "");
  console.log("Case 3 (replay):  ", result3.status);
  console.log();
  console.log("The relayer caught Case 2 before submission (offchain validation).");
  console.log("The onchain verifier caught Case 3 (nonce already consumed).");
  console.log("The contract is the final enforcement boundary.");
}

main().catch(console.error);
