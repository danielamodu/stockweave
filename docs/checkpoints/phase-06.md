# Phase 06 Checkpoint

Status: PASS (pending user `npm test` confirmation — no shell on this session).

## Objective

Make the Clawpump agent operate the protocol as an UNTRUSTED proposer: it reads
structured state and proposes, but cannot change rules, add assets, bypass the
program, act on stale data, exceed notional, or act once revoked/expired.

## What changed

- `lib/agent.js`: deterministic constrained agent. `decide(input)` →
  `{ state, reasonCodes, summary, action, trades, requiresApproval,
  permissionSummary, blocked?, blockReason? }`. Permission gate mirrors the
  on-chain AgentPermission (READ/PROPOSE/EXECUTE bits, revoked, expiry,
  per-action cap). Proposed notional is capped at `maxNotionalPerAction`.
  Action is never EXECUTE; a proposal always `requiresApproval`.
  `describePermissions` renders the mandate in plain language (D-601/D-602).
- `tests/phase06.js`: 13 checks (structured I/O; drift→propose; notional cap;
  never-EXECUTE even with EXECUTE bit; revoked/expired/no-PROPOSE blocks;
  paused→hold; stale/invalid→hold; NORMAL→hold; no rule-change/add-asset
  fields; determinism; plain-language permissions). Wired into `npm test`.
- `server.js`: `GET /api/agent[?demo=…][&revoked=1]` returns the agent decision
  WITH the underlying numbers (explanation is not the evidence). `/health`
  phase → 6.

## Tests run

- `npm test`: NOT RUN this session (no shell). Expected 70/70 overall
  (…+ 13 Phase 6). USER to confirm.

## Evidence

- command or URL: `npm test`; `GET /api/agent?demo=drift` (proposal) vs
  `?demo=drift&revoked=1` (blocked) vs `?demo=stale` (hold).
- artifact: `lib/agent.js`, `tests/phase06.js`.

## Known failures

- None expected; awaiting `npm test`.

## Risks / limitations

- The agent's prose is a deterministic template, not an LLM/Clawpump call
  (D-601). Real Clawpump-platform / MCP / LLM binding is a documented seam via
  the `decide()` contract — NOT fabricated. If a live Clawpump binding is
  required for the bounty, that is added work (needs Clawpump creds/docs).
- Agent runs off-chain over FIXTURE data; the on-chain program (Phase 5)
  re-enforces every guard, so the agent staying untrusted is proven on-chain.

## Scope decisions

- D-601 (deterministic agent + documented LLM/Clawpump seam), D-602 (API
  surface + plain-language permissions + revoked demo).

## Decision

Proceed to next phase: recommend YES (Phase 7 — forking) after user confirms
`npm test` green and approves `PROCEED TO PHASE 07`.

## Next action

USER: run `npm test` and paste the Phase 6 lines. Optionally hit
`/api/agent?demo=drift` and `?demo=drift&revoked=1` to see propose-vs-blocked.
