# Phase 05 Checkpoint

Status: PASS (stage 5a) — off-chain mirror 15/15 + Anchor tests 10/10 green on
Devnet (5 phase-4 + 5 phase-5). Stage 5b (real Pyth receiver demo) still to build.

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

## Decision

Stage 5a: PASS. Proceed to next phase: NOT YET — stage 5b (real Pyth
`PriceUpdateV2` receiver demo on a labelled borrowed feed, per D-502) is the
remaining Phase 5 work before requesting `PROCEED TO PHASE 06`.

## Next action

AGENT: build stage 5b (pyth-solana-receiver read path + labelled demo) after
user approval. Then re-run Playground for the receiver evidence and update this
checkpoint. Phase 5 is complete only when 5a + 5b are both proven.
