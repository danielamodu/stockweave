# StockWeave Product Contract (Phase 0 — frozen)

> StockWeave lets crypto-native users inspect, simulate, fork, and follow a tokenized-stock strategy without trusting an opaque portfolio manager.

## 1. Product

Public, forkable strategy layer for tokenized stocks on Solana.

## 2. Target user

Crypto-native strategy follower who understands wallets/tokens and values public state, explainable rules, forkability, and user-controlled permissions over a conventional brokerage interface.

## 3. MVP decisions (fixed)

```text
Product: public, forkable strategy layer for tokenized stocks
Target user: crypto-native strategy follower
Asset universe: three PreStocks assets plus USDC
Strategy: AI Infrastructure Basket
Agent: observe + propose by default
Execution: simulated or user-approved only
Approval: required for every action
Maximum single asset: 35%
Minimum USDC reserve: 10%
Rebalance trigger: 5 percentage points
Pyth maximum age: 30 seconds
Maximum action (demo): $50 notional
Maximum daily (demo): $200 notional
```

## 4. Asset universe (Phase 0 freeze)

Tickers frozen; mints/feed IDs VERIFYING in Phase 1/2. Do not use unverified mints on-chain.

- OpenAI (PreStocks) — candidate mint `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` — STATUS: VERIFYING against prestocks.com + explorer
- Anthropic (PreStocks) — candidate mint `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` — STATUS: VERIFYING
- xAI (PreStocks) — mint VERIFYING (not yet confirmed, do not fabricate)
- USDC — reserve asset

PreStocks-only route. Scope excludes Tessera, xStocks, and all other non-PreStocks pre-IPO assets in this submission. Screenshots, pool pairs, and deployed universe must stay consistent with this rule.

## 5. Golden path (only primary workflow)

```text
Open public strategy page
→ inspect three PreStocks assets and USDC
→ view Pyth price, timestamp, confidence, and state
→ trigger a drift or stale-data condition
→ receive a structured Clawpump explanation
→ submit an invalid proposal
→ show Solana rejecting it
→ submit a valid proposal
→ require user approval
→ show the on-chain event
→ fork the strategy from another wallet
→ show the purposeful Meteora market
```

## 6. Non-negotiable exclusions

No additional asset families beyond PreStocks route; no Tessera/xStocks/non-PreStocks pre-IPO assets; no multi-chain; no generalized ETF/index issuance; no custody; no unrestricted autonomous trading; no unreviewed advice or performance guarantees; no social network; no leaderboards; no advanced backtesting; no multiple basket templates; no additional agents; no arbitrary mints; no unapproved protocols; no style-only refactors; no off-golden-path UI screens.

## 7. Data-quality rules (deferred to implementation, contract fixed)

- Pyth controls state, not charts. Stale/invalid data blocks protected proposal/execution paths.
- Distinguish token price vs reference price vs age vs confidence vs freshness; missing reference = `UNKNOWN`, never fabricated.
- States: `NORMAL`, `DRIFTED`, `STALE_DATA`, `DISLOCATED`, `PAUSED`.
- Pyth feed IDs: TBD in Phase 2. Pre-IPO names may have no valid public feed — record `UNKNOWN` rather than inventing IDs.

## 8. Authority rules (contract)

- Critical permissions on-chain (Phase 4+). Frontend warnings alone insufficient.
- Clawpump default `READ + PROPOSE`; execution requires user approval, limits ($50/action, $200/day), expiry, revoke.
- Fork creates independent PDA, authority, permissions, history — not a frontend copy.
- Meteora DBC must be purposeful thin-market design with documented curve/fees/graduation; strategy token is not equity, not a guaranteed claim, not a regulated ETF.

## 9. Asset language + risk disclosures

- Strategy token = participation in strategy/community layer, not direct equity, voting, dividends, or redemption unless issuer docs support it.
- PreStocks tokens = SPV-backed economic exposure, 1:1 claim per issuer, transferable SPL Token-2022; Reg S, not offered to US persons per issuer.
- Known risks (must surface in UI/README from Phase 1 on): May 2026 issuer SPV-validity warnings (Anthropic/OpenAI non-approved SPV transfer statements); SpaceX S-1 conversion risk (May 2026, no standardized pre-IPO→public conversion); thin-liquidity/exit risk; reference/token divergence (market hours, liquidity, structure).
- No mainnet, no meaningful funds, Devnet first without explicit approval.

## 10. Phase 0 baseline definition

- Minimal Node placeholder: `npm start / npm run health / npm test`. No Solana toolchain on PC; Playground workflow for Phase 4+.
- `BASELINE_PLACEHOLDER` label on page. No live prices. No fabricated signatures, oracle values, pools, or integrations.
- Version identifier via local git (no remote/push).
