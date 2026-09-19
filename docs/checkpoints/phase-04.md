# Phase 04 Checkpoint

Status: PASS — program deployed + verified, Anchor tests 5/5 green on Devnet

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
- Anchor build: PASS (Solana Playground, browser; init-if-needed feature enabled).
- Anchor/Devnet tests (`anchor test`, Playground → Devnet): **5/5 PASS (10s)**.
  1. initializes the strategy with deterministic seeds — PASS
  2. rejects an unauthorized writer — PASS (on-chain `ConstraintHasOne` / 2001)
  3. sets assets, rules, and agent permission, then pauses — PASS
  4. rejects protected actions while paused — PASS (on-chain `StrategyPaused` / 6001)
  5. revokes the agent — PASS (`perm.revoked == true`)

### Test-file fixes made during verification (repo = source of truth)

- `programs/stockweave/Cargo.toml`: enabled `init-if-needed` feature on
  anchor-lang — the program uses `init_if_needed` in set_assets/set_rules/
  set_agent_permission and did not compile without it.
- `tests/stockweave.ts`:
  - Removed the `chai` import (Playground can't resolve the package, even a
    type-only import); `assert` is declared against Playground's injected global.
  - Test 2 funds the throwaway "attacker" via a wallet-to-wallet transfer
    instead of `requestAirdrop` — the Devnet faucet threw "Internal error" and
    failed the test for the wrong reason. Transfer reaches the authority guard.
  - Strategy id is now unique per run (`ai-infrastructure-${Date.now()}`).
    Devnet persists state across runs, so a fixed id collided ("already in
    use") and left a paused strategy that broke later tests. Derivation stays
    deterministic per id.

## Evidence

- command or URL: `npm test` (mirror only); Playground runbook `docs/solana-playground-phase04.md`
- artifact or transaction:
  - Program ID (Devnet, user-deployed via Playground, agent-verified 2026-09-19
    with read-only `getAccountInfo`): `2z9QVsHonA4QcZkwLAcb1P5BGyrTL9UYUrE45TrmqC2a`
    — lamports 833120, owner `BPFLoaderUpgradeab1e11111111111111111111111`,
    executable=true.
  - Recorded in `programs/stockweave/src/lib.rs` (`declare_id!`) and
    `Anchor.toml` (`[programs.devnet]`).
  - Anchor test output (5/5 PASS, Devnet, via Playground `anchor test`):
    - initialize_strategy:
      `2JzQhKJM2ZsbCpSLZAAkjaZWikb1LE3YUH649YdtW3wXVsbgHH2KnnNJpiKKj17abBevaA2ZUFT9owwbRCJeGMYi`
    - set_agent_permission:
      `htVrXJHkQqoyUtSQWqCezPo1NpBDYq4HgRJmPLgRY7sgwUMBWTwWS3A52iT2ELMcr4wYWuRfzKMh5PRDW2Fm2QC`
    - pause_strategy:
      `SyQ7bWwqaisyTKM5y9PwGML1VQoVVrmtWNa9iz31VhzNZUwNjWimCkBEr5PSrByFkroLrgZ2td4iLS8vWdPdqgj`
    - revoke_agent:
      `5TsHBSQADo5ygJ5dNDXBR8YZzACf4SkhSaBB2yN95MuTGqeZyqUua9L1thSv9V9BTmzbM3RTEQ4XGbEZQ3MBBnqX`
  - On-chain rejections proven (not just UI warnings):
    - Unauthorized write → `ConstraintHasOne` (error 2001).
    - Protected action while paused → `StrategyPaused` (error 6001).

## Known failures

- None. All 5 Anchor tests pass on Devnet; both rejection paths
  (unauthorized, paused) are proven by on-chain AnchorErrors.

## Risks

- Mirror logic could drift from program logic if either is edited independently — the Playground test file mirrors the same 5 scenarios to catch divergence.
- `declare_id!` placeholder must be replaced by the Playground keypair at deploy; claiming the placeholder as a program ID would be fabrication.

## Scope decisions

- No proposal/approval instructions (Phase 5), no Playground execution by agent (impossible without browser/toolchain). See D-401–D-403.

## Decision

Proceed to next phase: YES (recommended) — Phase 4 objective met and verified.
Awaiting explicit user approval (`PROCEED TO PHASE 05`) before any Phase 5 work.

## Next action

USER: review this checkpoint and, if satisfied, reply `PROCEED TO PHASE 05`.
Agent will not begin Phase 5 (propose/approve/execute rebalance) until then.
