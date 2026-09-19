# StockWeave Decision Log

## Phase 6 (2026-09-19)

- D-601: Clawpump agent implemented as a DETERMINISTIC constrained proposer in `lib/agent.js`. It consumes the rules-engine classification + on-chain-mirrored permission and returns structured output (state, reasonCodes, summary, action, trades, requiresApproval). It never decides numeric limits/weight-validity/oracle-freshness (rules engine does) and never returns EXECUTE. The plain-language `summary` is a TEMPLATE over the real numbers — NOT fabricated LLM prose. A real LLM/Clawpump-platform/MCP binding is a documented seam (the `decide()` input/output contract); it is not faked. Rejected: inventing a Clawpump SDK/agent id (see D-006 — Clawpump IDs still TBD) or claiming an LLM call we don't make.
- D-602: Agent surfaced at `GET /api/agent[?demo=…][&revoked=1]`; permissions rendered in plain language via `describePermissions`. `revoked=1` demonstrates that revocation immediately blocks proposals. Default mandate READ+PROPOSE, EXECUTE off, $50/action + $200/day caps — mirrors the on-chain AgentPermission.

## Phase 5 (2026-09-19)

- D-501: Phase 4 flipped to PASS — Anchor tests 5/5 green on Devnet via Playground (init/unauthorized/set+pause/paused-rejection/revoke). On-chain rejections proven: `ConstraintHasOne` (2001), `StrategyPaused` (6001). Signatures recorded in `docs/checkpoints/phase-04.md`. Repo fixes: `init-if-needed` feature enabled; test file drops chai import, funds attacker by transfer (not faucet), uses unique per-run strategy id (Devnet persists state).
- D-502: Pyth on-chain enforcement approach = **HYBRID** (user-approved 2026-09-19). Stage 5a: `propose_rebalance` takes a caller-supplied oracle snapshot (feed_id, price, publish_time) and the program rejects on-chain when `Clock - publish_time > max_price_age_seconds` (STALE) or `feed_id` mismatches (WRONG_FEED) — real on-chain freshness/feed guard, price authenticity enforced off-chain and LABELLED (not cryptographically verified on-chain). Stage 5b: separate demonstrated path reading a real Pyth `PriceUpdateV2` (pyth-solana-receiver) on a clearly-labelled borrowed feed, since pre-IPO assets have no native feed (see D-203). Rationale: satisfies the Phase 5 gate (real rejection) without fabricating a feed for the assets, while still proving trustless Pyth verification.
- D-503: `execute_rebalance` is SIMULATE-only in Phase 5 (per product contract: "simulated or user-approved only"; no custody, no real token transfers). It records executed state + emits an event after approval + guards pass. Real swap execution is out of MVP scope.
- D-504: Stage 5a (propose/approve/execute + guards) PASS on Devnet (10/10, sigs in phase-05.md). Stage 5b (trustless Pyth via `pyth-solana-receiver-sdk`) is BLOCKED in Solana Playground — Playground ships a fixed crate set and cannot resolve the crate (`E0433`), and there is no local toolchain (constraint). Reverted the 5b working-tree edits so Playground keeps building 5a; preserved verbatim 5b code + unblock checklist in `docs/phase05b-pending.md`. Deferred to a Pyth-capable build env (Codespaces / local Anchor) as a pre-submission task. Phase 5 gate still met by 5a's on-chain `StaleOracle` guard. Rejected: forcing a fake pass or editing feed/program ids to dodge the block.

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
