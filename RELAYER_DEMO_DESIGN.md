# RELAYER_DEMO_DESIGN.md

## Goal

Demonstrate the full execution-intent pipeline in a local, runnable form:

- receive a signed execution intent
- validate it offchain using execution-intent-sdk
- reject obvious invalid payloads before submission
- submit valid payloads to a local onchain verifier
- return a structured status/receipt

The demo makes execution-intent-sdk concrete.
It answers: what happens after someone signs an execution intent?

---

## Non-goals

- Production relayer
- Distributed nonce management
- Real gas management
- Authentication or authorization
- Persistence beyond in-memory store
- Multi-chain support
- Retry queues or delivery guarantees
- Wallet UX
- Full MetaMask delegation-framework integration

---

## Actors

### User / Agent
Creates and signs an ExecutionIntent using execution-intent-sdk.
Sends the signed intent + proposed execution to the relayer.

### Relayer (this demo)
Receives signed intents.
Performs preflight validation using execution-intent-sdk helpers.
Submits valid payloads to the onchain verifier.
Stores and returns receipts.

The relayer is NOT the trust root.
It is a useful preflight layer, not a security boundary.

### Onchain Verifier (MinimalIntentVerifier)
The final enforcement boundary.
Validates signature, nonce, deadline, and exact execution match.
Reverts on any mismatch, replay, or expiry.

---

## One-command demo

    npm run demo:local

Starts Anvil, waits for readiness, starts relayer server, waits for readiness, runs all four demo cases, cleans up on exit. No manual process management required.

---

## Four demo cases

| Case | Input | Result | Where caught |
|---|---|---|---|
| 1. Valid + in-scope grant | exact match, all scope checks pass | confirmed | onchain verifier |
| 2. Mutated calldata | execution data differs from signed intent | rejected (EXECUTION_MISMATCH) | relayer offchain |
| 3. Replay attack | nonce already consumed | reverted | onchain verifier |
| 4. Out-of-scope grant | target not in allowedTargets | rejected (SCOPE_CHECK_FAILED) | relayer offchain |

---

## Authority receipt model

| Layer | Object | Purpose |
|---|---|---|
| Early authority | GrantEnvelope | Declared delegate, targets, value cap, expiry |
| Late action | SignedIntent | Exact target / value / calldata / nonce / deadline |
| Scope bridge | ScopeCheck[] | Connects late action to early grant envelope |
| Enforcement | MinimalIntentVerifier | Onchain signature / nonce / deadline / exact execution |
| Audit output | ExecutionReceipt | Full record: authority + validation + submission + result |

Current limitation: GrantEnvelope is structured metadata, not a cryptographically verified delegation object. Scope checks are offchain only. The onchain verifier enforces the execution intent, not the grant envelope.

---

## End-to-end flow

    User/Agent
      1. createIntent({ account, target, value, data, nonce, deadline })
      2. signIntent(intent, domain, privateKey)
      3. POST /intents { signed, execution: { target, value, data } }

    Relayer
      4. validateBeforeSubmission(signed, target, value, data)
         -> reject if: bad signature, expired, mismatch
      5. encodeIntentArgs(intent, signer, signature)
      6. walletClient.writeContract({ verifyAndConsume, args })
      7. waitForTransactionReceipt
      8. store receipt: confirmed | reverted

    User/Agent
      9. GET /intents/:id -> ExecutionReceipt

---

## Request shape

    POST /intents
    Content-Type: application/json

    {
      "signed": {
        "intent": {
          "account": "0x...",
          "target":  "0x...",
          "value":   "0",
          "data":    "0x...",
          "nonce":   "1",
          "deadline": "1234567890"
        },
        "signer":    "0x...",
        "signature": "0x..."
      },
      "execution": {
        "target": "0x...",
        "value":  "0",
        "data":   "0x..."
      }
    }

Note: bigint fields (value, nonce, deadline) are serialized as strings.

---

## Response / receipt shape

    {
      "id":           "uuid",
      "status":       "confirmed" | "rejected" | "submitted" | "reverted" | "received",
      "signer":       "0x...",
      "account":      "0x...",
      "target":       "0x...",
      "value":        "0",
      "dataHash":     "0x...",
      "nonce":        "1",
      "deadline":     "1234567890",
      "failureCodes": [],
      "failureReasons": [],
      "txHash":       "0x...",
      "blockNumber":  "12345"
    }

---

## What the relayer validates

Offchain preflight using execution-intent-sdk:

- signature validity (verifySignedIntent)
- deadline not expired (isDeadlineValid)
- execution target matches intent (executionMatchesIntent)
- execution value matches intent
- calldata hash matches intent
- malformed payload / missing fields

Rejection happens before onchain submission.
Rejected intents are not submitted and do not consume gas.

---

## What the onchain verifier enforces

MinimalIntentVerifier (Solidity):

- EIP-712 signature verification (ecrecover)
- nonce not already consumed (usedNonces mapping)
- deadline not expired (block.timestamp)
- exact target match
- exact value match
- exact calldata hash match

Any mismatch, replay, or expiry reverts.
The verifier is the final trust boundary.

---

## Failure cases

### Rejected before submission (relayer catches)
- INVALID_SIGNATURE
- DEADLINE_EXPIRED
- EXECUTION_MISMATCH (target / value / calldata)
- NONCE_REUSE_RISK (nonce=0 flag only)
- MALFORMED_PAYLOAD

### Reverted onchain (verifier catches)
- replay (nonce already consumed)
- deadline expired at block time
- exact execution mismatch not caught offchain
- invalid signature not caught offchain

Replay is primarily caught onchain.
The relayer cannot know onchain nonce state without querying the contract.

---

## Execution receipts

Each submitted intent produces an `ExecutionReceipt` that records the full audit trail:

- `id` — unique receipt identifier
- `status` — received | rejected | submitted | confirmed | reverted
- `signer` — address that signed the intent
- `account` — smart account the execution is authorized for
- `target / value / dataHash / nonce / deadline` — exact committed action fields
- `offchainValid` — whether the relayer's preflight checks passed
- `failureCodes / failureReasons` — structured rejection detail if offchain rejected
- `txHash / blockNumber` — onchain submission result if submitted

The receipt answers:
> Who signed it? What exact action was attempted? Did offchain validation pass?
> Was it submitted? Did the onchain verifier confirm or revert?

Note: in a fuller delegated-authority system, a receipt would also reference the
early permission grant (delegation) and include scope checks proving the final
action stayed inside that grant. That is intentionally out of scope for v1.
The current receipt covers the late execution path only.

---

## Known limitations

- In-memory only: receipts lost on server restart
- No distributed nonce coordination
- No gas estimation or retry logic
- No authentication: any caller can submit
- Replay detection is onchain, not offchain (relayer does not query nonce state)
- Local Anvil only: not suitable for testnet/mainnet without modification
- Single verifier contract: no multi-account or multi-enforcer support
- No queue: concurrent submissions not managed
