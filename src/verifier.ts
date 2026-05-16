// src/verifier.ts
// Deploy and interact with MinimalIntentVerifier on local Anvil.

import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { RPC_URL, RELAYER_PRIVATE_KEY } from "./config.js";

const __dir = dirname(fileURLToPath(import.meta.url));

const artifact = JSON.parse(
  readFileSync(join(__dir, "../artifacts/MinimalIntentVerifier.json"), "utf8")
);

export const VERIFIER_ABI      = artifact.abi;
export const VERIFIER_BYTECODE = artifact.bytecode as `0x${string}`;

const chain = { ...anvil, rpcUrls: { default: { http: [RPC_URL] } } };

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const account = privateKeyToAccount(RELAYER_PRIVATE_KEY!);
export const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

let verifierAddress: `0x${string}` | null = null;

export async function getOrDeployVerifier(): Promise<`0x${string}`> {
  if (verifierAddress) return verifierAddress;

  console.log("[verifier] Deploying MinimalIntentVerifier...");
  const hash = await walletClient.deployContract({
    abi:      VERIFIER_ABI,
    bytecode: VERIFIER_BYTECODE,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  verifierAddress = receipt.contractAddress!;
  console.log("[verifier] Deployed at:", verifierAddress);
  return verifierAddress;
}

export async function submitToVerifier(
  verifier: `0x${string}`,
  intent: {
    account:  `0x${string}`;
    target:   `0x${string}`;
    value:    bigint;
    dataHash: `0x${string}`;
    nonce:    bigint;
    deadline: bigint;
  },
  signer:    `0x${string}`,
  signature: `0x${string}`,
  execTarget: `0x${string}`,
  execValue:  bigint,
  execData:   `0x${string}`
): Promise<{ txHash: `0x${string}`; blockNumber: bigint; reverted: boolean }> {
  try {
    const hash = await walletClient.writeContract({
      address:      verifier,
      abi:          VERIFIER_ABI,
      functionName: "verifyAndConsume",
      args: [intent, signer, signature, execTarget, execValue, execData],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return {
      txHash:      hash,
      blockNumber: receipt.blockNumber,
      reverted:    receipt.status === "reverted",
    };
  } catch {
    return { txHash: "0x", blockNumber: 0n, reverted: true };
  }
}
