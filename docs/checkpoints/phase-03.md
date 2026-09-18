# Phase 03 Checkpoint

Status: PASS

## Objective

Make portfolio logic deterministic and independent of the LLM: ten pure rules functions, five states, boundary-tested limits, every transition explainable from numeric inputs.

## What changed

- Added `lib/rules.js`: `calculateCurrentWeights/WeightDrift/MarkNAV/ReferenceNAV/Dislocation`, `validateReserve/MaxWeights/PriceQuality/NotionalLimits`, `classifyStrategyState`; precedence PAUSED > STALE_DATA > DISLOCATED > DRIFTED > NORMAL.
- Added `getTokenPriceBySymbol` (XAI FIXTURE-labelled, mint-null); resized fixture holdings to 3/6/12/100 so fresh = exactly 30/30/30/10.
- Rewired `/api/strategy` through the rules engine (+`?demo=drift|paused`); response keeps Phase 2 shape plus `reasonCodes/currentWeights/targetWeights/maxDriftBps`.
- Added `tests/phase03.js` (11 checks incl. all six boundary values); health check extended; phase label 3.

## Tests run

- `npm test`: 35/35 PASS (6 + 9 + 9 + 11 — determinism, no-LLM, exact-target fixture, 35%/35.01%, 10%/9.99%, 30s/30.01s, stale block, breach codes, notional $42/$50/$50.01/daily, full transition table).
- Live: fresh → NORMAL drift 0; drift → DRIFTED [ASSET_OVERWEIGHT, RESERVE_BREACH] 750bps; stale → STALE_DATA blocked; paused → PAUSED blocked.

## Evidence

- command or URL: `npm test`, `/api/strategy`, `?demo=drift|stale|paused`
- artifact or transaction: live valuations — fresh `{"state":"NORMAL","maxDriftBps":0,"proposalAllowed":true}`, drift `{"state":"DRIFTED","reasonCodes":["ASSET_OVERWEIGHT","RESERVE_BREACH"],"maxDriftBps":750}`, stale `{"state":"STALE_DATA","proposalAllowed":false}`, paused `{"state":"PAUSED","proposalAllowed":false}`; markNAV 1000 → 1120 on drift
- screenshot or recording: none (JSON + assertions verified live)
- State-transition table:

```text
fresh target weights + fresh Pyth-UNKNOWN ref → NORMAL, proposals allowed
OPENAI 140 (+750bps drift, 37.5% weight, 8.93% reserve) → DRIFTED [ASSET_OVERWEIGHT, RESERVE_BREACH]
45s-old Pyth update → STALE_DATA [STALE_DATA], proposals blocked
wrong feed ID → STALE_DATA [INVALID_FEED], proposals blocked
paused flag → PAUSED [STRATEGY_PAUSED], everything blocked
6% mark/reference spread (synthetic) → DISLOCATED, execution blocked
$50.01 or daily overflow → proposal blocked [EXCESSIVE_NOTIONAL / DAILY_LIMIT_EXCEEDED]
```

## Known failures

- None. All mandatory Phase 3 checks pass.

## Risks

- Reference leg still UNKNOWN (no verified feed); DISLOCATED path unit-tested with synthetic reference, not live data.
- Fixture prices labelled FIXTURE; XAI mint still unverified.

## Scope decisions

- No on-chain program (Phase 4), no proposal lifecycle (Phase 5), no agent (Phase 6). See D-301–D-303.

## Decision

Proceed to next phase: NO (awaiting explicit user approval per phase gate)

## Next action

Wait for user to review this report and reply `PROCEED TO PHASE 04` to authorize Phase 4 only.
