# execution-intent-relayer-demo

Minimal local relayer demo for [execution-intent-sdk](https://github.com/terriclaw/execution-intent-sdk).

Shows what a system does with a signed execution intent:
receive it, validate it, submit it, return a receipt.

---

## What this is

A tiny local HTTP relayer that:
- accepts signed execution intents via `POST /intents`
- validates offchain using `execution-intent-sdk`
- submits valid payloads to a local `MinimalIntentVerifier` contract on Anvil
- returns structured receipts with status and failure codes

## What this is not

- a production relayer
- a wallet
- a full delegation-framework integration
- persistent (in-memory only, lost on restart)
- authenticated or authorized
- gas-managed or retry-capable

---

## How it relates to execution-intent-sdk

This demo consumes `execution-intent-sdk` as a dependency.
All validation logic uses SDK helpers directly:
- `validateBeforeSubmission` — offchain preflight
- `verifySignedIntent` — signature check
- `encodeIntentArgs` — onchain args encoding
- `dataHash`, `defaultDomain` — intent utilities

The relayer is NOT the trust boundary.
The `MinimalIntentVerifier` contract is.

---

## How to run

### Prerequisites
- Node.js 18+
- Anvil installed (`foundryup`)
- Two terminals

### Terminal 1: Start Anvil
    anvil

### Terminal 2: Start relayer server
    npm install
    cp .env.example .env
    # Set RELAYER_PRIVATE_KEY in .env
    # For local Anvil testing, use account 0: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    npm run dev

### Terminal 3 (or same): Run demo
    npm run demo

---

## What the demo proves

Three cases:

1. **Valid exact execution** — relayer submits, verifier confirms
2. **Mutated calldata** — relayer rejects offchain (EXECUTION_MISMATCH), no tx submitted
3. **Replay** — relayer submits, verifier reverts (nonce already consumed)

Key distinction:
- The relayer catches obvious mismatches offchain (saves gas, improves UX)
- The onchain verifier is the final enforcement boundary (catches replay, validates signature, enforces exact match)

---

## What it does not prove

- Production gas management
- Distributed nonce coordination
- Retry or delivery guarantees
- Authentication
- Multi-chain or multi-enforcer support
- Real wallet UX

---

## API

### POST /intents
Submit a signed intent for validation and execution.

Request body:
    {
      "signed": {
        "intent": { "account", "target", "value", "data", "nonce", "deadline" },
        "signer": "0x...",
        "signature": "0x..."
      },
      "execution": { "target", "value", "data" }
    }

Note: value, nonce, deadline are strings (bigint serialization).

Response: ExecutionReceipt

### GET /intents/:id
Get receipt by ID.

### GET /intents
List all receipts.

### GET /verifier
Get deployed verifier address and chainId.

---

## Receipt shape

    {
      "id":             "uuid",
      "status":         "confirmed" | "rejected" | "submitted" | "reverted" | "received",
      "signer":         "0x...",
      "account":        "0x...",
      "target":         "0x...",
      "value":          "0",
      "dataHash":       "0x...",
      "nonce":          "1",
      "deadline":       "1234567890",
      "failureCodes":   ["EXECUTION_MISMATCH"],
      "failureReasons": ["execution does not match signed intent"],
      "txHash":         "0x...",
      "blockNumber":    "5"
    }

Failure codes: INVALID_SIGNATURE, DEADLINE_EXPIRED, EXECUTION_MISMATCH, NONCE_REUSE_RISK

---

## Related

- SDK: https://github.com/terriclaw/execution-intent-sdk
- Reference enforcer: https://github.com/terriclaw/execution-bound-intent
- Design research: https://github.com/terriclaw/execution-bound-intent-global-replay
