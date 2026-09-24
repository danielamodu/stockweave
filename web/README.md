# StockWeave — web

The demo UI for **StockWeave**: inspect, simulate, fork & follow a tokenized-stock
(PreStocks) strategy on Solana, with a constrained assistant that can **read and
propose but never spend**. Every weight, cap and permission is on-chain and checkable.

**Live:** https://stockweavexbt.vercel.app
**Network:** Solana **Devnet** · program `EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN`

For the full protocol — the 16 on-chain instructions, build phases, decision log and
the scope-and-honesty notes — see the [root README](../README.md) and [`../docs/`](../docs).

## Stack

- **Next.js 16.3.5** (App Router, Turbopack dev) · **React 19** · **TypeScript**
- **Tailwind v4** — a deliberately flat blueprint/wireframe aesthetic
- **@solana/web3.js** + **wallet-adapter** (Devnet, non-custodial)

## Getting started

Requires **Node 20+**.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The marketing page and strategy inspector work with no
config; connecting a wallet requires a Devnet wallet (e.g. Phantom set to Devnet).

## What's real (no fabricated data)

- **Strategy state is read from the deployed Devnet program** — rules, weights, caps,
  agent permissions, holdings and the on-chain NAV track record.
- **Live prices via Jupiter** — real spot quotes for each PreStocks asset, not fixtures.
- **Mainnet mint verification** — the strategy page reads the real PreStocks asset mints
  on mainnet (supply, decimals, authorities, Token-2022 controls) server-side.
- **PreStocks catalogue API** — each asset's mint is matched to the official published
  contract address; verified marks and implied valuations are shown when available.

When a data source is unreachable the UI **degrades honestly** (shows the verified
addresses / an explicit "unavailable" state) rather than inventing numbers.

## Environment variables

All are optional — the app runs and degrades gracefully without them.

| Variable | Side | Purpose |
| --- | --- | --- |
| `AGENT_SECRET_KEY` | server | Agent keypair (JSON byte array) that signs `propose_rebalance`. **Secret — never expose to the client.** Unset → the propose API returns 503. |
| `NEXT_PUBLIC_AGENT_PUBKEY` | client | Agent pubkey granted READ+PROPOSE when a user forks a strategy. Must match `AGENT_SECRET_KEY`. |
| `AGENT_RPC` / `HELIUS_RPC` | server | Devnet RPC for the propose route (defaults to public devnet). |
| `NEXT_PUBLIC_SOLANA_RPC` | both | Fallback Devnet RPC. |
| `MAINNET_RPC` | server | Mainnet RPC for mint verification (the default public endpoint is flaky). |

The constrained agent is **READ+PROPOSE only** — its key can draft a rebalance, but
approve/execute require the strategy creator to sign with their own wallet. The propose
endpoint is unauthenticated by design (demo); proposing is non-custodial and moves no
funds. Do not deploy it as-is to a trust boundary that assumes otherwise.

## Devnet mirror world

Because PreStocks tokens are mainnet-only, the Devnet demo trades program-issued
**mirror mints** (authority = the program vault PDA, so no key can mint them). They are
created and bound to each strategy by the seed scripts in [`../tests`](../tests)
(`seed-devnet-mints.js`, then `seed-onchain-strategy.js`), which publish real live
Jupiter prices per asset. See the root README for the seed/run steps.
