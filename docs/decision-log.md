# StockWeave Decision Log

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
