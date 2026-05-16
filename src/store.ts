// src/store.ts
// In-memory receipt store. Lost on restart — intentional for demo simplicity.
import type { ExecutionReceipt } from "./types.js";

const store = new Map<string, ExecutionReceipt>();

export function saveReceipt(receipt: ExecutionReceipt): void {
  store.set(receipt.id, receipt);
}

export function getReceipt(id: string): ExecutionReceipt | undefined {
  return store.get(id);
}

export function allReceipts(): ExecutionReceipt[] {
  return Array.from(store.values());
}
