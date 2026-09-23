# StockWeave

**A public, forkable strategy layer for tokenized stocks on Solana — with a constrained AI agent that can propose, but never move, your money.**

StockWeave turns a basket of tokenized pre-IPO stocks into an on-chain *strategy*: a set of target weights and risk rules anyone can inspect, follow, or fork into their own wallet-owned copy. A constrained agent watches the mix and proposes tune-ups — but every change is guarded on-chain and requires the owner's signature. The agent is granted **READ + PROPOSE**, and execution can *never* be delegated to it.

> **Status:** Devnet demo. The Anchor program is deployed and all protocol phases (1–7, plus trustless Pyth 5b) are proven on-chain. See [Scope & honesty](#scope--honesty) for exactly what is real vs. simulated.

- **Program (Devnet):** [`EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN`](https://explorer.solana.com/address/EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN?cluster=devnet)
- **Official strategy creator:** `3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD`
- **Cluster:** Solana Devnet · **Anchor** 0.30.1

---

## Why it's different

- **The agent is constrained by the chain, not by a prompt.** Permissions are a bitmask (`READ=1`, `PROPOSE=2`, `EXECUTE=4`) stored in an on-chain permission account. Execution is never delegated — the program enforces it, so "it can't move your money" is a fact, not a promise.
- **Approval is mandatory and on-chain.** `approve_rebalance` and `execute_rebalance` use `has_one = creator`: only the strategy's on-chain creator can approve and execute. The agent, a separate keypair, can only `propose_rebalance`.
- **Everything is inspectable and forkable.** Rules, weights, and the agent grant live in Program-Derived Accounts. `fork_strategy` mints you a wallet-owned copy you fully control.
- **Real data only.** Live PreStocks prices come from Jupiter; the SOL/USD reference comes from Pyth. No fabricated history, no fake sparklines.

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

## Repository layout

| Path | What |
|------|------|
| `programs/stockweave/` | The Anchor/Rust on-chain program: strategies, rules, assets, permissions, propose/approve/execute, fork. |
| `lib/` | Node engine: asset registry, basket catalogue, rules, price provider, live Jupiter prices (mirrored into `web/lib/core/`). |
| `server.js` | Standalone engine HTTP API + phase test harness — the web app is self-contained and does not require it. |
| `web/` | Next.js frontend — the demo UI (browse, follow, fork, inspect, assistant). |
| `tests/` | Phase tests, on-chain evidence JSON, and `seed-onchain-strategy.js`. |
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
Open http://localhost:3000 and connect a Devnet wallet (Phantom, Solflare, Backpack, …). Browse and follow official baskets, and **fork** one into your own wallet-owned strategy with a real Devnet transaction.

**(Optional) Enable the constrained agent**

The proposer is a backend route that signs with its own keypair; it degrades gracefully when unconfigured (the app still runs, the agent just can't propose).

1. Generate and fund a Devnet keypair for the agent (a little SOL for proposal rent + fees).
2. Set server env `AGENT_SECRET_KEY` (JSON byte array) and `NEXT_PUBLIC_AGENT_PUBKEY` (the matching pubkey).
3. Seed the official strategies on-chain — this also grants the agent PROPOSE:
   ```bash
   ANCHOR_WALLET=/path/to/deploy-keypair.json \
   NEXT_PUBLIC_AGENT_PUBKEY=<agent-pubkey> \
   node tests/seed-onchain-strategy.js
   ```
4. In the app, create your own fork (it grants the agent automatically), then use **Ask the agent to review** on the Assistant page.

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
| `ANCHOR_WALLET` | seed script | Path to the deploy/creator keypair. |
| `HELIUS_RPC` · `ANCHOR_PROVIDER_URL` · `AGENT_RPC` | seed · agent | Optional Devnet RPC override (defaults to the public Devnet endpoint). |

The browser wallet connection is fixed to Solana Devnet (`clusterApiUrl("devnet")`).

---

## Scope & honesty

This is a **Devnet demo built for a hackathon**, and it is deliberate about what is real:

- **Real:** the deployed program and all its guards; wallet-signed create / fork / propose / approve / execute transactions; live PreStocks prices (Jupiter) and a fresh SOL/USD reference (Pyth); on-chain rules, permissions, and forking.
- **Simulated:** `execute_rebalance` records the approved decision and marks the position **simulated** — it does not custody funds or perform real token swaps yet (decision D-503). What the loop proves is the authorization + guard path, which is real.
- **Prices, not history:** there is no historical NAV, so the UI shows no fabricated time-series or sparklines. Every figure derives from live data.
- **PreStocks mints** are real *mainnet* mints referenced for identity/verification; the demo itself runs on Devnet.
- **The agent proposer endpoint is unauthenticated** (demo only). Proposing is non-custodial and fully guarded on-chain, so the only abuse is spending the agent's own Devnet SOL — but add auth + rate-limiting before any non-demo deployment.

## Tech stack

Solana · Anchor 0.30.1 (Rust) · Next.js · TypeScript · `@solana/web3.js` (raw instruction encoding in the browser, no Anchor client) · `@solana/wallet-adapter` · Jupiter (prices) · Pyth (reference oracle) · Node engine API.

## Security

- The agent keypair is a **secret**: server-side env only, never shipped to the browser. `.env*` and keypair files are git-ignored — keep them out of version control.
- The deploy/creator keypair is a Devnet throwaway; use a fresh keypair and never commit it.
- Nothing in this repository should ever hold real funds.

## License

UNLICENSED (see `package.json`). Hackathon submission — please contact the author before reuse.
