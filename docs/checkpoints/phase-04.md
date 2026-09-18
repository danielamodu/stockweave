# Phase 04 Checkpoint

Status: BLOCKED

## Objective

Move the strategy's critical identity, assets, rules, and status on-chain: 6 instructions, deterministic PDA seeds, authority/pause/revoke guards, lifecycle events — proven by a real build + network tests + transaction evidence.

## What changed

- Added `programs/stockweave/src/lib.rs`: `initialize_strategy/set_assets/set_rules/set_agent_permission/pause_strategy/revoke_agent`, Strategy/Rules/Asset/Permission accounts, seeds `strategy/rules/asset/permission`, 5 events, `Unauthorized/StrategyPaused/BadRules/BadPermission` errors. `declare_id!` is a compile-only placeholder — no program ID claimed.
- Added `Anchor.toml`, `programs/stockweave/Cargo.toml`, `tests/stockweave.ts` (5 Playground tests for Devnet).
- Added `lib/onchain-mirror.js`: labelled OFF-CHAIN logic mirror (SIMULATED addresses) + `tests/phase04.js` (7 checks).
- Added `docs/solana-playground-phase04.md`: exact browser runbook (build → test → deploy → report back).
- Health/`/health` phase label 4.

## Tests run

- `npm test`: 42/42 PASS (6 + 9 + 9 + 11 + 7 mirror checks — deterministic seeds, unauthorized rejection, 5 events, pause rejection, revoke, expiry, program-source completeness).
- Anchor build: NOT RUN (no toolchain on PC by constraint; browser Playground required).
- Anchor/Devnet tests: NOT RUN (same reason). No transaction signatures exist.

## Evidence

- command or URL: `npm test` (mirror only); Playground runbook `docs/solana-playground-phase04.md`
- artifact or transaction: NONE on-chain — program ID: UNASSIGNED; build output: PENDING; tx signatures: PENDING
- screenshot or recording: none

## Known failures

- On-chain evidence items are missing, not failed: build, network tests, deploy, and tx signatures all await the Playground run. Mirror PASS is explicitly not on-chain evidence.

## Risks

- Mirror logic could drift from program logic if either is edited independently — the Playground test file mirrors the same 5 scenarios to catch divergence.
- `declare_id!` placeholder must be replaced by the Playground keypair at deploy; claiming the placeholder as a program ID would be fabrication.

## Scope decisions

- No proposal/approval instructions (Phase 5), no Playground execution by agent (impossible without browser/toolchain). See D-401–D-403.

## Decision

Proceed to next phase: NO — phase is BLOCKED on the Playground run

## Next action

USER: follow `docs/solana-playground-phase04.md` (build → test → deploy on Devnet) and paste back program ID + test output + signatures. Agent will then record them here and flip Phase 4 to PASS. Do NOT approve Phase 5 until then.
