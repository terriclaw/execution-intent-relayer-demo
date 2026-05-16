# execution-intent-relayer-demo

Minimal local relayer demo for [execution-intent-sdk](https://github.com/terriclaw/execution-intent-sdk).

Shows what a system does with a signed execution intent:
receive it, validate it, submit it, return a receipt.

---

![relayer demo flow](./assets/relayer-demo-flow.svg)

## What this is

A tiny local HTTP relayer that:
- accepts signed execution intents via `POST /intents`
- validates offchain using `execution-intent-sdk`
- submits valid payloads to a local `MinimalIntentVerifier` contract on Anvil
- returns structured receipts with status and failure codes

![relayer demo flow](./assets/relayer-demo-flow.svg)

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

## Execution receipts

The relayer stores an `ExecutionReceipt` for every submitted intent.

    Delegation grants authority. Execution intent binds the exact action.
    Execution receipt records what happened.

A receipt answers:
- who signed the intent?
- what exact action was attempted?
- did offchain validation pass?
- was a transaction submitted?
- did the onchain verifier confirm or revert?
- what failure codes explain rejection?

In this demo, receipts cover the late execution path: signed intent → relayer validation → onchain verifier result.

In a fuller delegated-authority system, receipts would also reference the early permission grant and include scope checks proving the final action stayed inside that grant. That is out of scope for v1.

---

## Example receipts

### Confirmed

    {
      "id": "f0fac7ad-ce88-46cc-b8af-cce3065bd78d",
      "status": "confirmed",
      "offchainValid": true,
      "signer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "target": "0x0000000000000000000000000000000000000001",
      "value": "0",
      "dataHash": "0xae075f11a95f563eb755a9a26431d11be6b969319478218a289666083ae538b3",
      "nonce": "1",
      "deadline": "1776295484",
      "txHash": "0x200c79b9526eec171da491d349f0d823d0900b4f8247bcfd31688c72079eae86",
      "blockNumber": "2"
    }

### Rejected offchain (calldata mismatch)

    {
      "id": "a139586e-1266-4b7d-808d-9b6f89863625",
      "status": "rejected",
      "offchainValid": false,
      "signer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "target": "0x0000000000000000000000000000000000000001",
      "value": "0",
      "dataHash": "0xae075f11a95f563eb755a9a26431d11be6b969319478218a289666083ae538b3",
      "nonce": "2",
      "deadline": "1776295484",
      "failureCodes": ["EXECUTION_MISMATCH"],
      "failureReasons": ["execution does not match signed intent (target, value, or calldata mismatch)"]
    }

### Reverted onchain (replay — nonce already consumed)

Reverted receipts include a real tx hash because the transaction was submitted and mined, but the verifier reverted during execution.

    {
      "id": "551dbf40-955f-4add-a64f-efe72a0e905c",
      "status": "reverted",
      "offchainValid": true,
      "signer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "account": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "target": "0x0000000000000000000000000000000000000001",
      "value": "0",
      "dataHash": "0xae075f11a95f563eb755a9a26431d11be6b969319478218a289666083ae538b3",
      "nonce": "1",
      "deadline": "1776295484",
      "txHash": "0xc2bbe9856dad19acd20e222701d00ec4f4d8a4aad907ccc6f23a71d0e944f926",
      "blockNumber": "3"
    }

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
