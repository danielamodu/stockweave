#!/usr/bin/env bash
# E2E fork agent-loop dress rehearsal — orchestrates the headless run.
# Generates a throwaway fork-creator (U) and agent (A), funds them from the
# deploy wallet, seeds a user-owned fork under U with A granted READ+PROPOSE,
# then runs the propose(A)->approve(U)->execute(U) loop. Never echoes secrets.
set -euo pipefail
cd /mnt/c/Users/USER/Desktop/Stockweave

HELIUS_RPC="$(solana config get | sed -n 's/^RPC URL: *//p')"
[ -n "$HELIUS_RPC" ] || { echo "no RPC URL in solana config"; exit 1; }
echo "RPC host: $(echo "$HELIUS_RPC" | sed -E 's#(https?://[^/]+).*#\1#')"   # host only — key never printed

DEPLOY="$HOME/.config/solana/id.json"
DEPLOY_PUB="$(solana-keygen pubkey "$DEPLOY")"
echo "deploy wallet: $DEPLOY_PUB  balance: $(solana balance "$DEPLOY_PUB" --url "$HELIUS_RPC")"

mkdir -p tests/.rehearsal
U_KP=tests/.rehearsal/forkcreator-keypair.json
A_KP=tests/.rehearsal/agent-keypair.json
solana-keygen new -s --no-bip39-passphrase -f -o "$U_KP" >/dev/null
solana-keygen new -s --no-bip39-passphrase -f -o "$A_KP" >/dev/null
U="$(solana-keygen pubkey "$U_KP")"
A="$(solana-keygen pubkey "$A_KP")"
echo "fork creator U: $U"
echo "agent A:        $A"

echo "--- funding U (0.2) + A (0.08) from deploy wallet ---"
solana transfer "$U" 0.2  --keypair "$DEPLOY" --url "$HELIUS_RPC" --allow-unfunded-recipient --commitment confirmed
solana transfer "$A" 0.08 --keypair "$DEPLOY" --url "$HELIUS_RPC" --allow-unfunded-recipient --commitment confirmed
echo "balances: U=$(solana balance "$U" --url "$HELIUS_RPC")  A=$(solana balance "$A" --url "$HELIUS_RPC")"

echo "--- seeding a user-owned fork under U (agent A granted, live prices) ---"
ANCHOR_WALLET="$U_KP" NEXT_PUBLIC_AGENT_PUBKEY="$A" HELIUS_RPC="$HELIUS_RPC" node tests/seed-onchain-strategy.js

echo "--- running the propose(A) -> approve(U) -> execute(U) loop ---"
ANCHOR_WALLET="$U_KP" AGENT_WALLET="$A_KP" HELIUS_RPC="$HELIUS_RPC" node tests/run-fork-agentloop-direct.js
