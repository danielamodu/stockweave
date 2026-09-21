# Phase 07 Checkpoint

Status: PASS — on-chain verified on Devnet 2026-09-21 (local WSL toolchain +
Helius RPC). `fork_strategy` executed; parent-isolation rejection confirmed.

## Objective

Prove StockWeave is a public strategy NETWORK: a real `fork_strategy` creates
independent on-chain state + authority. Wallet B forks Wallet A's strategy,
changes a rule, and Wallet A cannot control the fork.

## What changed

- `programs/stockweave/src/lib.rs`: added `fork_strategy(new_strategy_id)` —
  new Strategy PDA (caller = creator, `parent_strategy` = source) + new Rules
  PDA copying the parent's rule template (version reset to 1). `ForkStrategy`
  context + `StrategyForked` event. No account-layout change (D-701).
- `lib/onchain-mirror.js`: `forkStrategy(parent, newCreator, id)` mirror.
- `tests/phase07.js`: 8 mirror checks (fork independence, parent link, copied
  rules v1, B changes a rule → v2, A cannot control fork, independent agent
  authority, deterministic PDA + event, program-source completeness). Wired
  into `npm test`.
- `tests/stockweave.ts`: `stockweave-phase7` block (setup + fork + B edits fork
  + A cannot edit fork), Wallet B funded by transfer.
- Runbook `docs/solana-playground-phase07.md`.

## Tests run

- `npm test` (mirror): 8/8 Phase 7 checks green (design proof).
- On-chain Devnet run via `tests/run-phase7-direct.js` (Helius RPC): parent
  setup + fork + fork-edit + parent-isolation rejection, all confirmed on-chain.
  Program rebuilt locally in WSL (anchor 0.30.1) and deployed to Devnet.

## Deployment

- Program id: `EVx3g8ooCpshuemiNz3bt3vqoYapu7XjPab86BbnrgYN` (local upgrade authority)
- Deploy tx: `4HEU7uuivn8vfQd7ec5mFhdpPBEG8phYnf4UBo2z1JDAWvHeSsG9yDB9tG4bDDWgxcVqgG6hNico8CcBe66rZkPE`
- BPF upgradeable loader, executable on-chain.

## Evidence

Full record: `tests/phase07-evidence.json`. On-chain signatures:

- initialize_strategy (parent): `5Tq7kwFD5ekMREmrVLN8waZgercYK1uh8ie23oBRUS22pE8NBXXuhJoja2E7cJAFsyarst1jzZLuTYsoEHs3PuFx`
- set_rules (parent): `4n8kjDPpy6hyoevRbZiywi39T9rys6fDZfWNkacQZkM3C4NQ1pwCXcX6nH2SUuH4tr4RMMS9BQ5nKtf4qVASDeu1`
- **fork_strategy: `7secvXc3otw9rpvp7mt4TQQYyfc9QyrbtiktwcEKpJedwMDuzTeQAAyGpoiH8FxrYNSRq2SZUEDPnn5WtsLdjkF`**
  - parent strategy PDA: `AtUXprHpwrcGLt8Kjks6jFeSihftbbVep4KXGYSjBESo`
  - fork strategy PDA: `4NQrZK4qxbjVb386ms5XxBk9coYwTqF6qn4SQoMFwVwt`
  - fork creator (Wallet B): `BVj3o8D65gjzPL1VWzzbY7NqTN5RT5xxWYBfdum8Di5L`
  - parent creator (Wallet A): `3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD`
  - fork copied parent rules (v1), then Wallet B edited its own fork → v2.
- fork set_rules by Wallet B: `J28A28V7TPbD3xHPrM9E7gyxTWV3LUp1HvsVtLQJYbwJkurfFKy9hc6FCLJ3atYNA2c7jcwxovmXTu3yXNHzfYd`
- **Parent-isolation rejection: CONFIRMED** — Wallet A's set_rules on the fork
  failed on-chain with `ConstraintHasOne` (error 2001, `has_one = creator`).

## Known failures

- None. All on-chain assertions passed.

## Risks / limitations

- D-701: assets + agent permissions are re-registered on the fork by the new
  owner (authority-holder), not bulk-copied in `fork_strategy`. Gate still met
  (independent state + authority + rule change + parent isolation).
- Another Devnet redeploy required (new instruction).

## Scope decisions

- D-701 (bounded fork: copy identity + rule template; owner re-registers assets).

## Decision

Proceed to next phase: YES — fork_strategy proven on-chain with independent
state + authority and parent isolation. Phase 7 gate met.

## Next action

None for Phase 7. Deploy/verify now runs on the local WSL toolchain (Playground
retired) against a user-controlled Devnet wallet + Helius RPC.
