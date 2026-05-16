#!/usr/bin/env bash
# scripts/demo-local.sh
# One-command local demo. Starts Anvil + relayer, runs demo, cleans up.
# Usage: npm run demo:local

if ! command -v anvil &> /dev/null; then
  echo "Error: anvil not found. Install via foundryup"
  exit 1
fi

if [ -z "$RELAYER_PRIVATE_KEY" ]; then
  echo "No RELAYER_PRIVATE_KEY set — using Anvil account 0 (local testing only)"
  export RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
fi

cleanup() {
  kill $(lsof -ti:8787) 2>/dev/null
  kill $(lsof -ti:8545) 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# Kill any stale processes
kill $(lsof -ti:8787) 2>/dev/null
kill $(lsof -ti:8545) 2>/dev/null
sleep 0.5

# Start Anvil
echo "Starting Anvil..."
anvil --silent &

# Wait for Anvil
for i in $(seq 1 20); do
  curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545 > /dev/null 2>&1 && break
  [ $i -eq 20 ] && echo "Error: Anvil did not start" && exit 1
  sleep 0.5
done
echo "Anvil ready."

# Start relayer server
echo "Starting relayer server..."
npx tsx src/server.ts > /tmp/relayer-server.log 2>&1 &

# Wait for verifier to be deployed (server logs show it's ready)
for i in $(seq 1 40); do
  RESPONSE=$(curl -s http://127.0.0.1:${PORT:-8787}/verifier 2>/dev/null || true)
  echo "$RESPONSE" | grep -q "address" && break
  [ $i -eq 40 ] && echo "Error: Server did not start. Check /tmp/relayer-server.log" && exit 1
  sleep 0.5
done
echo "Server ready."
echo ""

# Run demo
npx tsx src/demo.ts
