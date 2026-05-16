// src/config.ts
import "dotenv/config";

export const RPC_URL          = process.env.RPC_URL          ?? "http://127.0.0.1:8545";
export const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
export const PORT             = parseInt(process.env.PORT ?? "8787");

if (!RELAYER_PRIVATE_KEY) {
  throw new Error("RELAYER_PRIVATE_KEY not set in .env");
}
