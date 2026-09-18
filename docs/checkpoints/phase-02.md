# Phase 02 Checkpoint

Status: PASS

## Objective

Replace unverified fixture values with source-aware adapters and make Pyth data affect the product: every price carries source/timestamp/validity, and Pyth quality changes strategy state and proposal eligibility.

## What changed

- Added `lib/asset-registry.js`: server-side allowlist (OPENAI/ANTHROPIC VERIFYING, XAI mint unknown, USDC verified); `getAsset` rejects arbitrary mints with `UNAPPROVED_MINT`.
- Added `lib/pyth.js`: 64-hex feed-ID validation, timestamp-derived age, `FRESH`/`STALE_DATA`/`INVALID_FEED`/`LOW_CONFIDENCE`/`UNKNOWN` assessment, 30s max age.
- Added `lib/price-provider.js`: `getTokenPrice` (FIXTURE-labelled snapshots with all 8 fields), `getReferencePrice` (UNKNOWN when no feed, never fabricated).
- Added `lib/valuator.js`: deterministic Mark NAV, null reference NAV, `UNKNOWN` premium, Pyth-driven `NORMAL`/`STALE_DATA` + `proposalAllowed`.
- Added `GET /api/assets` + `GET /api/strategy[?demo=fresh|stale|invalid-feed|missing]` (`DEMO_SIMULATION`-labelled).
- Updated strategy page: separate Token vs Reference (Pyth) panels with source/timestamp/age/validity + labelled simulation links.
- Added `tests/phase02.js` (9 checks); `npm test` runs all three suites. Health check covers new files, phase label 2.

## Tests run

- `npm test`: 24/24 PASS (6 Phase 0 + 9 Phase 1 + 9 Phase 2 — allowlist, mint rejection, snapshot fields, feed validation, timestamp age, fresh/stale/invalid/missing, NAV/UNKNOWN, Pyth gate, UI separation).
- Live: `/api/assets` → 4 allowlisted assets; `/api/strategy` → NORMAL/allowed; `?demo=stale` → STALE_DATA/blocked, age 45s, `DEMO_SIMULATION`.

## Evidence

- command or URL: `npm test`, `http://localhost:3000/api/assets`, `http://localhost:3000/api/strategy`, `http://localhost:3000/api/strategy?demo=stale`
- artifact or transaction: raw responses — fresh `{"state":"NORMAL","proposalAllowed":true,"reference":{"validity":"UNKNOWN"}}`, markNAV 610; stale `{"state":"STALE_DATA","proposalAllowed":false,"reference":{"validity":"STALE_DATA","ageSeconds":45}}`; no on-chain activity in Phase 2 by design
- screenshot or recording: none (JSON API + page panels verified by assertions + live content match)
- Pyth feed ID: no verified public feed exists for these pre-IPO mints — `pythFeedId:null`, reference `UNKNOWN`; demo uses synthetic `0xab…ab` format-valid ID labelled `DEMO_SIMULATION`, never claimed as real

## Known failures

- None. All mandatory Phase 2 checks pass.

## Risks

- Token prices still FIXTURE (no sponsor API connected); XAI unpriced until mint verified — basket NAV partial by explicit design, not silent omission.
- Reference leg UNKNOWN until a verified Pyth feed exists; premium/discount cannot be computed — surfaced as UNKNOWN in API + UI.

## Scope decisions

- No rules-engine weights/drift (Phase 3), no on-chain program (Phase 4+), no agent (Phase 6). See D-201–D-204.

## Decision

Proceed to next phase: NO (awaiting explicit user approval per phase gate)

## Next action

Wait for user to review this report and reply `PROCEED TO PHASE 03` to authorize Phase 3 only.
