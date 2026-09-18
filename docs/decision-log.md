# StockWeave Decision Log

## Phase 4 (2026-09-18)

- D-401: Anchor program source (`programs/stockweave/src/lib.rs`) is repo source of truth: 6 instructions, 4 PDA types, 5 events, authority/pause guards, `declare_id!` left as compile-only placeholder — no program ID claimed until Playground deploy.
- D-402: Local verification via labelled off-chain mirror (`lib/onchain-mirror.js`, SIMULATED addresses) — explicitly NOT on-chain evidence. Rejected: installing Solana toolchain on PC (forbidden by project constraint).
- D-403: Phase 4 marked BLOCKED, not PASS: build/test/deploy evidence requires the user's browser Playground run per `docs/solana-playground-phase04.md`. Mirror PASS does not satisfy the on-chain gate.

## Phase 3 (2026-09-18)

- D-301: Rules engine in `lib/rules.js` (10 functions, bps weights, pure/deterministic). Fixture holdings resized to 3/6/12/100 units so fixture prices land exactly on 30/30/30/10 targets (fresh = NORMAL, drift 0). Supersedes D-203 in one respect: XAI gets a FIXTURE-labelled, mint-null snapshot for rules completeness — still unverified, never on-chain.
- D-302: State precedence PAUSED > STALE_DATA > DISLOCATED > DRIFTED > NORMAL; breaches surface as DRIFTED reason codes; stale/invalid blocks proposals; notional breach blocks proposals via reason code.
- D-303: `/api/strategy` now serves rules-engine valuations (+`?demo=drift|paused`, labelled `DEMO_SIMULATION`); response keeps Phase 2 shape with added `reasonCodes/currentWeights/targetWeights/maxDriftBps`.

## Phase 2 (2026-09-18)

- D-201: Adapters live server-side in `lib/` with JSON endpoints `/api/assets` + `/api/strategy`. Token prices FIXTURE-labelled; reference UNKNOWN (no verified public Pyth feed for pre-IPO mints — never fabricated).
- D-202: Stale/invalid simulations via `?demo=` param, always labelled `DEMO_SIMULATION` in API + UI. Demo feed ID is synthetic format-valid hex, never presented as a real Pyth feed.
- D-203: XAI excluded from pricing until its mint is verified (allowlist mint null); valuator prices only resolved mints. Rejected: inventing an XAI mint to complete the basket.
- D-204: Gate proven at API level: STALE reference → `STALE_DATA` + `proposalAllowed:false`; fresh/UNKNOWN → `NORMAL` + allowed. On-chain enforcement deferred to Phase 4/5.

## Phase 1 (2026-09-18)

- D-101: Static fixture page at `/strategy/ai-infrastructure` with `DATA_MODE: FIXTURE`, target weights 30/30/30 + 10% USDC reserve, state NORMAL. Rejected: live Pyth/PreStocks wiring now. Reason: Phase 1 gate is communication without wallet; live valuation is Phase 2.
- D-102: Fork button ships disabled with “coming in Phase 7” label. Reason: protocol requires disabled/placeholder fork in Phase 1; real fork is Phase 7.
- D-103: Loading/empty/error states as client-side preview panel on the same static page. Reason: smallest implementation proving the states exist with zero dependencies.
- D-104: Server directory → index.html fallback so the nested route serves without a framework. Reason: no new dependencies for Phase 1.

## Phase 0 (2026-09-18)

- D-001: Freeze asset tickers as OpenAI / Anthropic / xAI (PreStocks) + USDC for AI Infrastructure Basket. Mints/feed IDs stay VERIFYING; Phase 1/2 must re-verify against prestocks.com + explorer + Jupiter before on-chain use. Reason: only AI-lab trio fitting theme without mixing SpaceX/defense/prediction markets; preserves PreStocks-only bounty route.
- D-002: Candidate mints recorded as unverified observations (OPENAI `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF`, ANTHROPIC `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` from public registry; xAI mint unknown). Rejected alternative: freezing unverified mints as truth. Reason: agent instructions forbid fabricating oracle values/mints.
- D-003: Pyth feed IDs deferred to Phase 2 as TBD/`UNKNOWN`-capable. Reason: pre-IPO names may have no valid public feed; contract requires UNKNOWN over fabrication.
- D-004: Baseline = minimal Node zero-dep placeholder (`npm start / npm run health / npm test`), target stack (Next.js/Anchor/Postgres) documented only. Rejected: Next.js skeleton now. Reason: smallest implementation satisfying Phase 0 gate; user-approved.
- D-005: Version identifier = local `git init`, no remote/push. Fallback `docs/VERSION` if git unavailable. User-approved.
- D-006: Meteora params, Clawpump IDs, pool addresses deferred to Phase 6/8. Recorded as TBD; no placeholder values invented.
- D-007: Risk disclosures frozen into contract (May 2026 SPV-validity warnings; SpaceX S-1 conversion risk; thin liquidity). Must surface in UI from Phase 1.
- D-008: Devnet-first, no mainnet/meaningful funds without explicit approval; repo is source of truth, Playground changes copied back + checkpointed.

## Assumptions

- Node >= 18 available; no Solana toolchain on PC per user constraint.
- PreStocks catalog from public web sources (2026-09-18); re-verification required before any financial/pool use.
