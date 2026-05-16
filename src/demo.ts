// src/demo.ts
// End-to-end demo: valid grant, mutation, replay, out-of-scope grant.
// Run: npm run demo
// Requires: anvil running + server running (npm run dev)

import "dotenv/config";
import {
  createIntent,
  signIntent,
  defaultDomain,
} from "execution-intent-sdk";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}`;
const SERVER_URL  = `http://localhost:${process.env.PORT ?? 8787}`;

const account = privateKeyToAccount(PRIVATE_KEY);

const CALLDATA = ("0xa9059cbb" +
  "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" +
  "0000000000000000000000000000000000000000000000056bc75e2d63100000"
) as `0x${string}`;

const MUTATED = ("0xa9059cbb" +
  "000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" +
  "0000000000000000000000000000000000000000000000056bc75e2d63100001"
) as `0x${string}`;

const TARGET = "0x0000000000000000000000000000000000000001" as `0x${string}`;

async function postIntent(signed: any, execution: any, grant?: any) {
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
      ...(grant ? { grant } : {}),
    }),
  });
  return res.json();
}

async function main() {
  console.log("=== Execution Intent Relayer Demo ===");
  console.log("Server:", SERVER_URL);
  console.log("Signer:", account.address);
  console.log();

  // Get verifier address and domain from server
  const verifierRes = await fetch(`${SERVER_URL}/verifier`);
  if (!verifierRes.ok) throw new Error("Server not ready — start with: npm run dev");
  const { address: verifier, chainId } = await verifierRes.json() as { address: `0x${string}`, chainId: number };
  const domain = defaultDomain(verifier, chainId);
  console.log("Verifier:", verifier);
  console.log();

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Grant envelope for Cases 1 and 4
  const grant = {
    id:             "grant-001",
    delegator:      "0x1111111111111111111111111111111111111111",
    delegate:       account.address,
    allowedTargets: [TARGET],
    maxValue:       "1000000000000000000", // 1 ETH
    expiry:         (deadline + 7200n).toString(),
  };

  // ---------------------------------------------------------------------------
  // Case 1: Valid exact execution inside grant
  // ---------------------------------------------------------------------------
  console.log("--- Case 1: Valid exact execution inside grant ---");
  const intent1 = createIntent({
    account: account.address, target: TARGET, value: 0n,
    data: CALLDATA, nonce: 1n, deadline,
  });
  const signed1 = await signIntent(intent1, domain, PRIVATE_KEY);
  const result1 = await postIntent(signed1, { target: TARGET, value: 0n, data: CALLDATA }, grant);
  console.log("Status:     ", result1.status);
  console.log("scopeValid: ", result1.scopeValid);
  console.log("txHash:     ", result1.txHash?.slice(0, 22) + "...");
  if (result1.scopeChecks) {
    result1.scopeChecks.forEach((c: any) => console.log(" ", c.pass ? "[pass]" : "[FAIL]", c.code));
  }
  console.log();

  // ---------------------------------------------------------------------------
  // Case 2: Mutated calldata (relayer catches offchain)
  // ---------------------------------------------------------------------------
  console.log("--- Case 2: Mutated calldata ---");
  const intent2 = createIntent({
    account: account.address, target: TARGET, value: 0n,
    data: CALLDATA, nonce: 2n, deadline,
  });
  const signed2 = await signIntent(intent2, domain, PRIVATE_KEY);
  const result2 = await postIntent(signed2, { target: TARGET, value: 0n, data: MUTATED }, grant);
  console.log("Status:      ", result2.status);
  console.log("Failure codes:", result2.failureCodes);
  console.log();

  // ---------------------------------------------------------------------------
  // Case 3: Replay (onchain catches)
  // ---------------------------------------------------------------------------
  console.log("--- Case 3: Replay attack ---");
  const intent3 = createIntent({
    account: account.address, target: TARGET, value: 0n,
    data: CALLDATA, nonce: 1n, deadline, // same nonce as case 1
  });
  const signed3 = await signIntent(intent3, domain, PRIVATE_KEY);
  const result3 = await postIntent(signed3, { target: TARGET, value: 0n, data: CALLDATA }, grant);
  console.log("Status:  ", result3.status);
  console.log("txHash:  ", result3.txHash?.slice(0, 22) + "...");
  console.log();

  // ---------------------------------------------------------------------------
  // Case 4: Out-of-scope grant (target not allowed)
  // ---------------------------------------------------------------------------
  console.log("--- Case 4: Out-of-scope grant (target not in allowedTargets) ---");
  const badTarget = "0x0000000000000000000000000000000000000002" as `0x${string}`;
  const restrictedGrant = {
    ...grant,
    id:             "grant-002",
    allowedTargets: ["0x0000000000000000000000000000000000000099"] as `0x${string}`[],
  };
  const intent4 = createIntent({
    account: account.address, target: badTarget, value: 0n,
    data: CALLDATA, nonce: 3n, deadline,
  });
  const signed4 = await signIntent(intent4, domain, PRIVATE_KEY);
  const result4 = await postIntent(signed4, { target: badTarget, value: 0n, data: CALLDATA }, restrictedGrant);
  console.log("Status:      ", result4.status);
  console.log("scopeValid:  ", result4.scopeValid);
  console.log("Failure codes:", result4.failureCodes);
  if (result4.scopeChecks) {
    result4.scopeChecks.forEach((c: any) => console.log(" ", c.pass ? "[pass]" : "[FAIL]", c.code, c.detail ? "-" + c.detail : ""));
  }
  console.log();

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("=== Summary ===");
  console.log("Case 1 (valid + in-scope grant):  ", result1.status, "scopeValid:", result1.scopeValid);
  console.log("Case 2 (mutated calldata):        ", result2.status, result2.failureCodes);
  console.log("Case 3 (replay):                  ", result3.status);
  console.log("Case 4 (out-of-scope grant):      ", result4.status, result4.failureCodes);
  console.log();
  console.log("Relayer caught Cases 2 and 4 offchain. Onchain verifier caught Case 3.");
  console.log("The contract is the final enforcement boundary.");
  console.log("Grant scope checks are offchain/demo-only metadata. Not onchain delegation verification.");
}

main().catch(console.error);
