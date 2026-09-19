# Solana Playground Runbook — Phase 5 (user operates the browser)

Phase 5 adds new instructions and changes the `Rules` account layout, so the
program must be **rebuilt and redeployed (upgraded)** before the tests run.
Reuse the SAME Playground project that already holds program id
`2z9QVsHonA4QcZkwLAcb1P5BGyrTL9UYUrE45TrmqC2a` — an upgrade keeps that id.

You touch exactly TWO files (same as Phase 4) and create nothing:
`src/lib.rs` and `tests/anchor.test.ts`.

## Steps (~15 min, Devnet, no real funds)

1. Open your existing `stockweave` project at https://beta.solpg.io/.
2. Open `src/lib.rs` → select-all → paste the CONTENT of the repo file
   `programs/stockweave/src/lib.rs` (verbatim). Keep Playground's `declare_id!`
   value (`2z9Q…qC2a`); do not overwrite it with the repo placeholder.
3. Open `tests/anchor.test.ts` → select-all → paste the CONTENT of the repo
   file `tests/stockweave.ts` (verbatim). It now has two `describe` blocks:
   `stockweave-phase4` (5 tests) and `stockweave-phase5` (5 tests).
4. In the Playground terminal: `solana balance` (need ~1+ SOL; a redeploy costs
   more than a first deploy). Top up with `solana airdrop 2` if low.
5. Click **Build**. Expect success, no errors.
6. Click **Deploy**. This **upgrades** the existing program in place (same id).
   Wait for the deploy confirmation.
7. In the terminal: `anchor test --skip-deploy` (it already deployed in step 6;
   skip re-deploy to save time). Expect **10/10 passing**:
   - phase4: initialize / unauthorized / set+pause / paused-rejection / revoke
   - phase5: setup / Scenario B (propose→approve→execute) / Scenario A
     (MaxWeightExceeded) / Scenario C (StaleOracle) / bad-approval-nonce
8. Paste the full terminal output back here in CHAT (not the terminal).

## Report back (paste into chat)

```text
build output (last 5 lines):
test output (all PASS/FAIL lines + the logged signatures:
  propose_rebalance / approve_rebalance / execute_rebalance, and the three
  rejection logs: invalid weight / stale oracle / bad approval nonce):
```

## After the report

The agent records the propose/approve/execute signatures + the three on-chain
rejection reasons into `docs/checkpoints/phase-05.md`, flips Phase 5 to PASS,
and waits for `PROCEED TO PHASE 06`. Nothing here touches mainnet.

## Stage 5b — trustless Pyth: BLOCKED in Playground

Stage 5b (`verify_reference_oracle` reading a real Pyth `PriceUpdateV2`) needs
`pyth-solana-receiver-sdk`. Solana Playground ships a fixed crate set and cannot
resolve it (`error[E0433]: use of undeclared crate pyth_solana_receiver_sdk`),
and there is no local Solana toolchain (project constraint). It is deferred to a
Pyth-capable build env (GitHub Codespaces with Anchor, or a local toolchain).

The verbatim 5b code + unblock checklist live in `docs/phase05b-pending.md`.
Do NOT try to add the crate in Playground — it will not build.

Phase 5 remains PASS via stage 5a: the on-chain `StaleOracle` (6009) rejection
already satisfies the Pyth-freshness gate. 5b is bonus trustless-authenticity
for the Pyth bounty.

## Troubleshooting

- Build error mentioning `init_if_needed`: your Playground `Cargo.toml` is
  missing the feature. Open it and set
  `anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }`.
- `anchor test` redeploys and is slow / runs out of SOL: use
  `anchor test --skip-deploy` after a manual Deploy (step 6).
- A phase-5 propose test fails with `StaleOracle` unexpectedly: the cluster
  clock drifted from the fetched `clusterNow`. Re-run; the test reads the
  block time fresh each run. If it persists, paste the error.
- `AccountNotInitialized` / seeds errors on approve: make sure Build + Deploy
  (steps 5–6) actually ran against THIS code — an old deployed program lacks
  `propose_rebalance`.
