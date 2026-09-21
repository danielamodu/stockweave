# Solana Playground Runbook — Phase 7 (forking)

Phase 7 adds one instruction (`fork_strategy`) — no account-layout change — so
this is a normal rebuild + upgrade of the existing program
(`2z9QVsHonA4QcZkwLAcb1P5BGyrTL9UYUrE45TrmqC2a`). Two files, create nothing:
`src/lib.rs` and `tests/anchor.test.ts`.

## Steps (~15 min, Devnet)

1. Open your existing `stockweave` project at https://beta.solpg.io/.
2. `src/lib.rs` → select-all → paste the repo `programs/stockweave/src/lib.rs`
   (keep Playground's `declare_id!`).
3. `tests/anchor.test.ts` → select-all → paste the repo `tests/stockweave.ts`.
   It now has phase-4, phase-5, and phase-7 describe blocks.
4. `solana balance` (a redeploy needs more SOL; `solana airdrop 2` if low).
5. **Build** → **Deploy** (upgrade in place).
6. `anchor test --skip-deploy`. Expect **14 passing**:
   5 phase-4 + 5 phase-5 + 4 phase-7 (setup / fork / B-edits-fork /
   A-cannot-control-fork).
7. Paste the output in chat.

## Report back

```text
test output (all PASS/FAIL lines + the fork_strategy signature + the
"parent-owner cannot edit fork" rejection log)
```

## What phase-7 proves

- Wallet B forks Wallet A's strategy → new Strategy PDA with
  `parent_strategy = A`, `creator = B`, and its own copied Rules (version 1).
- Wallet B changes a rule on the fork (version → 2).
- Wallet A's `set_rules` on the fork fails (has_one=creator) — the parent owner
  has no authority over the fork. Independent on-chain state + authority.

Note (D-701): `fork_strategy` copies the strategy identity + rule template.
Assets and agent permissions are re-registered on the fork by its new owner
(who holds authority) rather than bulk-copied — keeps the instruction bounded.

## Troubleshooting

- `anchor test` slow / SOL: use `anchor test --skip-deploy` after a manual
  Deploy (step 5).
- Fork setup fails with "already in use": you re-ran with the same ids in the
  same second. The ids are timestamped per run; just re-run.
