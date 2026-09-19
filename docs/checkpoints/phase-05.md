# Phase 05 Checkpoint

Status: PASS — stage 5a proven (off-chain mirror 15/15 + Anchor tests 10/10 on
Devnet: 5 phase-4 + 5 phase-5). Stage 5b (trustless Pyth receiver) is BLOCKED in
Solana Playground and deferred to a Pyth-capable build env — design preserved in
`docs/phase05b-pending.md`. Phase 5 gate met via 5a's on-chain StaleOracle guard.

## Objective

Prove the rebalance lifecycle on-chain: the program REJECTS an invalid agent
proposal and a valid proposal CANNOT execute without the creator's approval,
tied to the exact proposal + nonce. Covers Scenarios A (invalid weight),
B (valid → approval → execution), C (stale oracle).

## What changed

- `programs/stockweave/src/lib.rs`: added `propose_rebalance` / `approve_rebalance`
  / `execute_rebalance`, the `RebalanceProposal` account + `Proposal` PDA
  (`["proposal", strategy, proposal_id]`), `ProposeArgs`, `ProposalStatus`,
  events `RebalanceProposed/Approved/Executed`, and errors
  `MaxWeightExceeded / ReserveBreach / StaleOracle / WrongFeed /
  ExcessiveNotional / PermissionRevoked / PermissionExpired / ProposeNotAllowed
  / ProposalExpired / BadApprovalNonce / BadProposalState`. Added
  `reference_feed_id` to `Rules`/`RuleSetParams` (feed-id guard). D-502/D-503.
- `lib/onchain-mirror.js`: mirrored the lifecycle (`proposeRebalance/
  approveRebalance/executeRebalance`) with the same guards + error names.
- `tests/phase05.js`: 15 off-chain mirror checks (Scenarios A/B/C, wrong feed,
  reserve, notional, revoked/expired permission, no-PROPOSE, paused, bad nonce,
  creator-only approval, expired proposal, deterministic proposal PDA, source
  completeness). Wired into `npm test`.
- `tests/stockweave.ts`: added `stockweave-phase5` describe block (setup +
  Scenario B propose/approve/execute + Scenario A + Scenario C + bad-nonce).
  Phase-4 `setRules` call updated with `referenceFeedId`.
- `docs/solana-playground-phase05.md`: browser runbook (rebuild + upgrade + test).

## Tests run

- `npm test` (mirror): 57/57 PASS overall, including **15/15 Phase 5** checks
  (Scenarios A/B/C, wrong feed, reserve, notional, revoked/expired permission,
  no-PROPOSE, paused, bad nonce, creator-only approval, expired proposal,
  deterministic proposal PDA, source completeness).
- Anchor build: PASS (Playground). Deploy: PASS (in-place upgrade of program
  `2z9Q…qC2a`; Devnet rate-limited, retried, completed).
- Anchor/Devnet `anchor test`: **10/10 PASS (45s)** — 5 phase-4 (re-run green)
  + 5 phase-5:
  1. sets up an active phase-5 strategy — PASS
  2. Scenario B: valid proposal accepted, needs approval, then executes — PASS
  3. Scenario A: weight above 35% rejected — PASS (`MaxWeightExceeded` / 6010)
  4. Scenario C: stale oracle rejected — PASS (`StaleOracle` / 6009)
  5. approval requires the exact nonce — PASS (`BadApprovalNonce` / 6014)

## Evidence

- command or URL: `npm test`; Playground runbook `docs/solana-playground-phase05.md`
- artifact or transaction (Devnet, via Playground `anchor test`):
  - propose_rebalance:
    `tC6bpPARs54dUXWYh2zvAJcjU34o4svbKRKzUP4PmMHxgSCCRWGwHoLVJ34MYw3XL5s84R1nAany5LKSGjw82gT`
  - approve_rebalance:
    `5V3DkHHNgk572VNiQWvW7BXtL3kBwCnEtgC9LDpk7E7qVpeJAL8vw1hHuj9i1pxXQno9asdQwDHRhWQ7zUp3qKra`
  - execute_rebalance (simulated):
    `2txzANuYSep6K1kjAvKQGxqAvoCy1qe3KZLpD7mns4dREWT9aXd4cxVYXqxhWxZDX7bGbxzyDiLSa1AiwmggU9yu`
  - on-chain rejections proven (AnchorErrors, not UI warnings):
    - Scenario A: `MaxWeightExceeded` (6010) at lib.rs:207
    - Scenario C: `StaleOracle` (6009) at lib.rs:204
    - bad nonce: `BadApprovalNonce` (6014) at lib.rs:263
  - phase-4 re-run signatures also captured (initialize
    `5LGKjN3pvRnBN2j4rVfmzKsByxGUJqRRwHbdHPxKLTK6G8k8sEx7LoKWTG6t5uZRjzxLJgWUnEsMJbmaW6gnDpon`,
    unauthorized→`ConstraintHasOne` 2001, paused→`StrategyPaused` 6001).
- screenshot or recording: Playground terminal (10 passing, 45s) captured.

## Known failures

- None known; on-chain evidence not yet captured.

## Risks

- Oracle freshness uses a caller-supplied snapshot checked against the cluster
  Clock (D-502 stage 5a). Price authenticity is enforced off-chain and LABELLED,
  not cryptographically verified on-chain. Stage 5b (real Pyth PriceUpdateV2 on
  a borrowed feed) is not yet built.
- `execute_rebalance` is simulate-only (D-503): it records state + emits an
  event; it does not move tokens.
- Program upgrade required on Devnet (Rules layout changed + new instructions);
  fresh per-run strategies avoid stale-layout conflicts.

## Scope decisions

- D-502 (hybrid Pyth), D-503 (simulate-only execution). Stage 5b (Pyth receiver
  demo) tracked as the remaining Phase 5 work after 5a is proven on-chain.

## Stage 5b (trustless Pyth) — BLOCKED in Playground, deferred

- Attempted: `verify_reference_oracle` reading a real `PriceUpdateV2` via
  `pyth-solana-receiver-sdk`. Blocked: Solana Playground ships a fixed crate set
  and cannot resolve the crate (`error[E0433]: use of undeclared crate
  pyth_solana_receiver_sdk`); no local Solana toolchain (project constraint).
- The 5b working-tree changes were reverted from `Cargo.toml` / `src/lib.rs` /
  `tests/stockweave.ts` so Playground keeps building 5a. The verbatim 5b code +
  unblock instructions are preserved in `docs/phase05b-pending.md` (D-504).
- Not a gate failure: the Phase 5 Pyth requirement ("stale data blocks
  protected paths") is already met on-chain by 5a's `StaleOracle` (6009).
  5b is the extra trustless-authenticity demo for the Pyth bounty.

## Decision

Phase 5: PASS via stage 5a (10/10 on Devnet). Stage 5b deferred (D-504) to a
Pyth-capable build environment (Codespaces / local Anchor) as a pre-submission
task. Proceed to next phase: recommend YES (Phase 6 — Clawpump agent), pending
explicit user approval `PROCEED TO PHASE 06`.

## Next action

USER: `PROCEED TO PHASE 06` when ready. Before final submission, unblock 5b per
`docs/phase05b-pending.md` to strengthen the Pyth-bounty story.
