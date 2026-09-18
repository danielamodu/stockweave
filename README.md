# StockWeave

> StockWeave lets crypto-native users inspect, simulate, fork, and follow a tokenized-stock strategy without trusting an opaque portfolio manager.

Target user: crypto-native strategy follower who values transparent rules, public activity, inspectable agent permissions, and user-controlled actions.

Phase 0 baseline. No live data. No Solana program yet. See `docs/product-contract.md`.

## MVP (frozen)

```text
Product: public, forkable strategy layer for tokenized stocks
Target user: crypto-native strategy follower
Asset universe: three PreStocks assets (OpenAI, Anthropic, xAI — tickers frozen, mints VERIFYING in Phase 1/2) plus USDC
Strategy: AI Infrastructure Basket
Agent: observe + propose by default
Execution: simulated or user-approved only
Approval: required for every action
Maximum single asset: 35%
Minimum USDC reserve: 10%
Rebalance trigger: 5 percentage points
Pyth maximum age: 30 seconds
```

Scope excludes Tessera, xStocks, and all other non-PreStocks pre-IPO assets in this PreStocks submission. No multi-chain, no ETF issuance, no custody, no unrestricted autonomous trading. Full boundaries: `docs/product-contract.md`.

## Run

Requires Node >= 18 only. No Solana CLI / Rust / Anchor required on this machine (browser Solana Playground workflow — repo is source of truth).

```bash
npm start    # serve placeholder page at http://localhost:3000
npm run health  # baseline file health check
npm test     # Phase 0 acceptance tests (node tests/run.js)
```

Health endpoint: `GET /health` returns `{ "status": "ok" }`.

## Local/browser Solana workflow

- Local repo is source of truth: frontend, backend, rules engine, tests, integrations, docs.
- Solana Playground (browser) is used for Anchor/Rust program work, compilation, Devnet deployment, program tests when needed (Phase 4+).
- Any Playground change must be copied back into this repo and recorded in `docs/checkpoints/phase-XX.md`.
- Devnet first. No mainnet or meaningful funds without explicit user approval.

## Repo layout (Phase 0)

```text
README.md
package.json / server.js / health-check.js
public/index.html        # BASELINE_PLACEHOLDER page
docs/product-contract.md
docs/decision-log.md
docs/parking-lot.md
docs/checkpoints/phase-00.md
tests/run.js
```

Target stack (documented, not installed in Phase 0): React/Next.js, Solana wallet adapter, Rust + Anchor (via Playground), Solana RPC, PostgreSQL read model, Pyth Hermes + PreStocks API, Clawpump agent, Meteora DBC SDK.

## Status

Phase 0 — see `docs/checkpoints/phase-00.md`. Next phase requires explicit `PROCEED TO PHASE 01`.
