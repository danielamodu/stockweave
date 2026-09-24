# StockWeave

**A public, forkable strategy layer for tokenized stocks on Solana — with a constrained AI agent that can propose, but never move, your money.**

StockWeave turns a basket of tokenized pre-IPO stocks into an on-chain *strategy*: a set of target weights and risk rules anyone can inspect, follow, or fork into their own wallet-owned copy. A constrained agent watches the mix and proposes tune-ups — but every change is guarded on-chain and requires the owner's signature. The agent is granted **READ + PROPOSE**, and execution can *never* be delegated to it.

On the Devnet mirror the whole lifecycle moves real tokens: mint test-USDC, **buy** a basket, watch the agent **propose** a rebalance, **approve + execute** it, track the strategy's **on-chain NAV**, and **sell** back to USDC — every step a signed on-chain transaction, with no server key anywhere in the money path.

> **Status:** Devnet demo, actively built. The Anchor program is deployed and every protocol phase (0–7, including trustless Pyth) plus the Devnet-mirror real-token stages (6–10) is proven on-chain with committed, re-runnable evidence. See [Build phases](#build-phases) for the full log and [Scope & honesty](#scope--honesty) for exactly what is real vs. simulated.

- **Program (Devnet):** [`EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN`](https://explorer.solana.com/address/EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN?cluster=devnet)
- **Official strategy creator:** `3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD`
- **Cluster:** Solana Devnet · **Anchor** 0.30.1 · 16 on-chain instructions

---

## Why it's different

- **The agent is constrained by the chain, not by a prompt.** Permissions are a bitmask (`READ=1`, `PROPOSE=2`, `EXECUTE=4`) stored in an on-chain permission account. Execution is never delegated — the program enforces it, so "it can't move your money" is a fact, not a promise.
- **Approval is mandatory and on-chain.** `approve_rebalance` and `execute_rebalance` use `has_one = creator`: only the strategy's on-chain creator can approve and execute. The agent, a separate keypair, can only `propose_rebalance`.
- **Everything is inspectable and forkable.** Rules, weights, and the agent grant live in Program-Derived Accounts. `fork_strategy` mints you a wallet-owned copy you fully control.
- **Real data only.** Live PreStocks prices come from Jupiter; the SOL/USD reference comes from Pyth; each basket's page reads the genuine *mainnet* PreStocks mints on-chain. No fabricated history, no fake sparklines.
- **Buy and sell move real tokens.** On the Devnet mirror, `subscribe`/`redeem` mint and burn real SPL tokens against a program-owned treasury — price-bound on-chain, with no server key in the path.
- **The track record lives on-chain.** A keeper records each basket's live-priced NAV into a `NavHistory` ring-buffer PDA (`record_nav`), so proof-of-return is a verifiable on-chain artifact read in one `getAccountInfo` — not a claim in a slide. It accumulates *forward* from launch (rebased to $1.000000); pre-IPO assets have no honest history to back-test, so the chart starts empty and fills in with real snapshots rather than a fabricated backtest.

## How the agent loop works

```text
  agent keypair                     strategy creator (wallet)
  READ + PROPOSE                    approve + execute
        |                                 |
        |  propose_rebalance  --------->  on-chain proposal
        |  (fresh Pyth price, guarded)    |
        |                                 |  approve_rebalance
        |                                 |  execute_rebalance
        +--------- never executes --------+  (two signatures)
```

1. The backend agent reads the strategy's on-chain targets and last-24h live prices, computes honest drift, and — only if drift exceeds the strategy's own rebalance band — signs a real `propose_rebalance` with its own funded Devnet keypair.
2. The program re-checks the proposal against every guard: reserve floor, max single-asset weight, per-trade and per-day notional caps, and oracle freshness.
3. The owner reviews it in the UI and signs **approve** then **execute**. The agent is never part of that step.

Because approve/execute are creator-only, the end-to-end loop runs on a basket **you own** (a fork). Official baskets are read-only to everyone but their creator.

---

## Build phases

StockWeave was built in two proven arcs. **Arc 1 (Phases 0–7)** designed and proved the protocol — strategy, rules, the constrained agent, and forking. **Arc 2 (Stages 6–10)** — after moving build/deploy to a local Anchor toolchain under a fresh program id — upgraded the *deployed* program so **every lifecycle action is a genuine on-chain token movement** on the Devnet mirror, not a simulation. Each row was proven on-chain before the next began; full rationale and per-stage upgrade signatures live in [`docs/decision-log.md`](docs/decision-log.md).

### Arc 1 — Protocol (Phases 0–7)

| Phase | Delivered | Status |
|-------|-----------|:------:|
| **0** | Scaffolding, asset freeze (OpenAI / Anthropic / xAI + USDC), decision log — no fabricated mints or feeds | ✅ |
| **1** | Static strategy page — communicates the product with zero wallet dependencies; risk disclosures surfaced | ✅ |
| **2** | Engine adapters + `/api/assets`·`/api/strategy`; valuation with an on-chain **stale-data gate** | ✅ |
| **3** | Rules engine — drift + state machine (`PAUSED > STALE > DISLOCATED > DRIFTED > NORMAL`), reason codes | ✅ |
| **4** | Anchor program authored + deployed; **Anchor tests 5/5 green on Devnet** (authority + pause guards) | ✅ |
| **5** | `propose → approve → execute` + all on-chain guards (**10/10**); hybrid oracle + **trustless Pyth** (5b) | ✅ |
| **6** | Constrained agent — deterministic **READ + PROPOSE** proposer, **never EXECUTE**; permissions surfaced | ✅ |
| **7** | `fork_strategy` — wallet-owned independent copies with automatic authority isolation | ✅ |

### Arc 2 — Devnet mirror, real tokens (Stages 6–10)

Because pre-IPO PreStocks assets have no Devnet liquidity, the program mints its own **mirror** SPL tokens (mint authority = a program `[b"vault"]` PDA — **no server key**) and uses capped **test-USDC** for cash. Every stage ships as a real Devnet **program upgrade** (program id unchanged) with a committed verifier that re-runs against the chain.

| Stage | Delivered | Decision | On-chain evidence |
|-------|-----------|:--------:|-------------------|
| **6** | Mirror **buy** + faucet: `subscribe` mints the buyer the basket; `faucet_usdc` mints capped test cash | reopens D-503 | [`stage06-buy-evidence.json`](tests/stage06-buy-evidence.json) |
| **7** | Real **execute**: an approved trim burns the mirror asset **and** returns treasury USDC, atomically | **D-702** | [`stage07-evidence.json`](tests/stage07-evidence.json) |
| **8** | **Price-binding guard**: an `AssetPrice` PDA binds buy + trim to a creator-published live price (± tolerance, 24 h freshness) | **D-703** | stage06 / stage07 (+ negative cases) |
| **9** | **On-chain NAV**: `record_nav` appends live-priced NAV to a `NavHistory` ring — forward-only, never back-filled | **D-704** | [`stage09-evidence.json`](tests/stage09-evidence.json) |
| **10** | **Sell / redeem**: mirror of `subscribe` — on-chain-computed payout + a pre-burn treasury-solvency guard | **D-705** | [`stage10-redeem-evidence.json`](tests/stage10-redeem-evidence.json) |

### On-chain instruction set

The deployed program exposes **16 instructions**:

> `initialize_strategy` · `set_assets` · `set_rules` · `set_agent_permission` · `pause_strategy` · `revoke_agent` · `propose_rebalance` · `approve_rebalance` · `execute_rebalance` · `fork_strategy` · `verify_reference_oracle` · `faucet_usdc` · `subscribe` · `redeem` · `set_asset_price` · `record_nav`

The three money-path instructions the browser signs (`faucet_usdc`, `subscribe`, `redeem`) are hand-encoded in [`web/lib/onchain.ts`](web/lib/onchain.ts) — there is no Anchor client in the browser.

---

## Repository layout

| Path | What |
|------|------|
| `programs/stockweave/` | The Anchor/Rust on-chain program: strategies, rules, assets, permissions, propose/approve/execute, fork, and the Devnet mirror (buy/sell/faucet/price/NAV). |
| `lib/` | Node engine: asset registry, basket catalogue, rules, price provider, live Jupiter prices (mirrored into `web/lib/core/`). |
| `server.js` | Standalone engine HTTP API + phase test harness — the web app is self-contained and does not require it. |
| `web/` | Next.js frontend — the demo UI (browse, follow, fork, inspect, buy, sell, assistant). |
| `tests/` | Phase + stage verifiers, on-chain evidence JSON, `seed-onchain-strategy.js`, and the NAV keeper/verifier (`record-nav.js` · `verify-nav.js`). |
| `docs/` | Architecture, protocol, decision log, and per-phase checkpoints. |
| `target/idl`, `target/types` | Hand-maintained IDL + TS types (the Anchor IDL sub-build is blocked upstream; treated as source). |

## The baskets

Two official strategies ship in the catalogue ([`lib/baskets.js`](lib/baskets.js)):

- **AI Infrastructure** — OpenAI, Anthropic, xAI at 30% each, plus 10% cash.
- **Space & Deep-Tech** — SpaceX 35%, Anduril 25%, Neuralink 20%, plus 20% cash.

Assets reference **real PreStocks mainnet mints**, verified on-chain (see [`lib/asset-registry.js`](lib/asset-registry.js)). Mints are never fabricated.

---

## Getting started

The web app is self-contained — its API routes reuse a mirrored copy of the engine — so running the demo only needs the `web/` app.

**Run the demo**
```bash
cd web
npm install
npm run dev
```
Open http://localhost:3000 and connect a Devnet wallet (Phantom, Solflare, Backpack, …). Browse and follow official baskets, **buy** the mix with test-USDC, **sell** it back, and **fork** one into your own wallet-owned strategy — each a real Devnet transaction.

**(Optional) Enable the constrained agent**

The proposer is a backend route that signs with its own keypair; it degrades gracefully when unconfigured (the app still runs, the agent just can't propose).

1. Generate and fund a Devnet keypair for the agent (a little SOL for proposal rent + fees).
2. Set server env `AGENT_SECRET_KEY` (JSON byte array) and `NEXT_PUBLIC_AGENT_PUBKEY` (the matching pubkey).
3. Seed the official strategies on-chain — this also grants the agent PROPOSE and publishes live per-asset prices:
   ```bash
   ANCHOR_WALLET=/path/to/deploy-keypair.json \
   NEXT_PUBLIC_AGENT_PUBKEY=<agent-pubkey> \
   node tests/seed-onchain-strategy.js
   ```
4. In the app, create your own fork (it grants the agent automatically), then use **Ask the agent to review** on the Assistant page.

**(Optional) Re-verify the on-chain evidence**

Every Arc-2 stage ships a verifier that hits Devnet directly and rewrites its evidence JSON, so you can reproduce the proofs rather than trust them. They hand-encode instructions (no IDL) and read `ANCHOR_WALLET` + an RPC from env:
```bash
ANCHOR_WALLET=/path/to/keypair.json HELIUS_RPC=<devnet-rpc> \
node tests/run-stage6-buy-direct.js       # buy: faucet → subscribe, + gamed-price rejection
node tests/run-stage7-execute-direct.js   # execute: propose → approve → real trim
node tests/run-redeem-direct.js           # sell: subscribe → redeem, + over-redeem rejection
```

**(Optional) Record + verify on-chain NAV**

The proof-of-return chart is fed by a keeper that snapshots each basket's live-priced NAV on-chain. Record a few points, then re-read them straight from the chain:
```bash
# append real live-priced NAV snapshots to each basket's on-chain ring
ANCHOR_WALLET=/path/to/deploy-keypair.json \
NAV_ROUNDS=4 NAV_INTERVAL_MS=3000 \
node tests/record-nav.js

# read both rings back from chain, check invariants, write stage09-evidence.json
node tests/verify-nav.js
```
`record_nav` is creator/keeper-signed (the agent never records); inception prices are captured once into `tests/nav-basis.json` and reused, so the NAV is rebased to $1.000000 at launch. Nothing is back-filled.

**(Optional) Standalone engine + tests (repo root)**
```bash
npm install
npm start   # node server.js — original engine API
npm test    # phase + basket tests
```

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AGENT_SECRET_KEY` | agent route (server) | JSON byte array of the agent keypair; required to enable proposing. **Secret — server-only.** |
| `NEXT_PUBLIC_AGENT_PUBKEY` | web · agent · seed | Agent public key (fork grant, client display, key-match check). |
| `ANCHOR_WALLET` | seed · verifiers · keeper | Path to the deploy/creator keypair (also the seller in the buy/sell verifiers). |
| `HELIUS_RPC` · `ANCHOR_PROVIDER_URL` · `AGENT_RPC` | seed · agent · verifiers | Optional Devnet RPC override (defaults to the public Devnet endpoint). |
| `NAV_ROUNDS` · `NAV_INTERVAL_MS` | keeper | Optional — how many NAV snapshots `tests/record-nav.js` appends per run (default 1) and the delay between them (default 3000 ms). |
| `MAINNET_RPC` | `/api/mainnet-assets` (server) | Optional mainnet RPC for the real tokenized-stock grounding read (defaults to the public `mainnet-beta` endpoint, which is rate-limited — set this to a reliable endpoint if the panel keeps degrading). Read-only; no keys are ever sent to the browser. |

The browser wallet connection is fixed to Solana Devnet (`clusterApiUrl("devnet")`). Separately, the strategy page reads the **real** PreStocks mints' live state from Solana **mainnet** server-side (`/api/mainnet-assets`) to prove each basket points at the genuine on-chain token — identity/facts only; all transactions stay on the Devnet mirror.

---

## Scope & honesty

This is a **Devnet demo built for a hackathon**, and it is deliberate about what is real:

- **Real:** the deployed program and all its guards; wallet-signed create / fork / propose / approve / execute / buy / sell transactions; live PreStocks prices (Jupiter) and a fresh SOL/USD reference (Pyth); on-chain rules, permissions, and forking. **`execute_rebalance` moves real tokens on Devnet** — an approved trim burns the asset's Devnet mirror token from the creator and returns the proposal's guarded notional in test-USDC from the strategy treasury, atomically (decision D-702, supersedes D-503).
- **Devnet mirror world:** because pre-IPO PreStocks assets have no Devnet liquidity, the program mints its own **mirror** SPL tokens (mint authority = a program `[b"vault"]` PDA, no server key) and uses capped **test-USDC** for cash. Balances, buys, sells, and trims are genuine on-chain token movements; the mints are Devnet stand-ins for the real *mainnet* PreStocks mints, not the mainnet tokens themselves.
- **Buys and trims are price-bound on-chain.** Both `subscribe` (buy) and `execute_rebalance` (trim) check the token quantity against a creator-published `AssetPrice` PDA (1% tolerance, 24 h freshness), so a buyer can't mint shares for negligible USDC and a trim can't drain the treasury while burning ~0 asset. Prices come from **live Jupiter quotes** published per asset by the seed script — never fabricated; an unpriced asset reverts rather than guessing (decision D-703).
- **You can sell back out on-chain, too.** `redeem` is the mirror image of `subscribe`: it burns your mirror tokens and returns test-USDC from the strategy treasury at the published price — a real exit, not a one-way buy. The payout is **computed on-chain** (`usdc_out = qty · price / 10^dec`), never supplied by the caller, so you can't ask to be paid more than the burn is worth; and a **treasury-solvency check runs before the burn**, so an over-redeem reverts with no balances touched. The dashboard's **"Sell this mix"** action redeems your whole holding, wallet-signed with no server key (`[b"vault"]` PDA signs the payout). Verify with `node tests/run-redeem-direct.js` → `tests/stage10-redeem-evidence.json`, which proves a real 0.5-token sell and an over-redeem rejected with `InsufficientTreasury` (decision D-705).
- **Proof-of-return is forward-tracked on-chain, not back-tested.** A creator/keeper-signed `record_nav` appends each basket's live-priced NAV (a weight-faithful index rebased to $1.000000 at inception) to a `NavHistory` ring-buffer PDA. There is deliberately **no back-fill**: the live price source is spot-only and pre-IPO mirror assets have no honest history, so the track record starts empty at launch and grows with real snapshots. The dashboard reads the whole ring in one `getAccountInfo` and shows honest empty / single-point states instead of inventing a curve. Verify it yourself with `node tests/verify-nav.js`, which re-reads both official rings from chain and writes `tests/stage09-evidence.json` (decision D-704).
- **Prices, not history:** there is no historical NAV, so the UI shows no fabricated time-series or sparklines. Every figure derives from live data.
- **PreStocks mints** are real *mainnet* mints referenced for identity/verification; the demo itself runs on Devnet.
- **The agent proposer endpoint is unauthenticated** (demo only). Proposing is non-custodial and fully guarded on-chain, so the only abuse is spending the agent's own Devnet SOL — but add auth + rate-limiting before any non-demo deployment.

## Tech stack

Solana · Anchor 0.30.1 (Rust) · Next.js · TypeScript · `@solana/web3.js` (raw instruction encoding in the browser, no Anchor client) · `@solana/wallet-adapter` · Jupiter (prices) · Pyth (reference oracle) · Node engine API.

## Security

- The agent keypair is a **secret**: server-side env only, never shipped to the browser. `.env*` and keypair files are git-ignored — keep them out of version control.
- The deploy/creator keypair is a Devnet throwaway; use a fresh keypair and never commit it.
- No server key sits in the money path: mirror mints and the USDC treasury are owned by the program's `[b"vault"]` PDA, which signs mints and payouts via CPI.
- Nothing in this repository should ever hold real funds.

## License

UNLICENSED (see `package.json`). Hackathon submission — please contact the author before reuse.
