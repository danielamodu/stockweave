# StockWeave AI Build Protocol

## Purpose

This document is the operating protocol for building StockWeave with AI assistance. The AI must work in phases and must not begin the next phase until the current phase passes its checkpoint.

The governing rule is:

> **Build one proof at a time. Verify it with evidence. Only then expand the system.**

The AI must never report a phase as complete because code was written. A phase is complete only when its acceptance tests pass and the required evidence is recorded.

## Operating rules for the AI

1. Read the current phase only after the previous phase is marked `PASS`.
2. Before coding, state the phase objective, files or components that will change, and the acceptance tests.
3. Make the smallest implementation that satisfies the phase.
4. Run the phase tests before adding optional polish.
5. If a test fails, stop and fix the current phase. Do not move forward.
6. Never replace a failing integration with an unlabelled mock. If a mock is necessary, label it `DEMO_MODE` in the UI and documentation.
7. Never claim a transaction, oracle check, wallet action, or sponsor integration is real unless there is a verifiable artifact.
8. After each checkpoint, write a short evidence record to `docs/checkpoints/phase-XX.md`.
9. Keep a `docs/decision-log.md` containing scope decisions, assumptions, and rejected alternatives.
10. At the end of every phase, report only: status, evidence, failures, risks, and next phase.

## Status vocabulary

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
PASS
FAIL
```

A phase may transition to `PASS` only when all mandatory checks pass. `BLOCKED` means an external dependency or credential is missing. A blocked phase is not complete.

## Phase map

```text
Phase 0  Product contract and repository baseline
Phase 1  Public strategy page with static verified data
Phase 2  Data adapters and Pyth-driven valuation
Phase 3  Deterministic rules engine and state machine
Phase 4  Solana strategy accounts and lifecycle
Phase 5  Proposal rejection and user approval
Phase 6  Clawpump agent with constrained permissions
Phase 7  Forking and independent strategy state
Phase 8  Meteora stock-paired market
Phase 9  Integration hardening and demo rehearsal
Phase 10 Submission packaging and final audit
```

## Phase 0 — Product contract and repository baseline

### Objective

Freeze the scope before implementation and establish a reproducible project baseline.

### Build

Create:

```text
README.md
docs/product-contract.md
docs/decision-log.md
docs/checkpoints/
tests/
```

Record these fixed MVP decisions:

```text
Product: public, forkable strategy layer for tokenized stocks
Target user: crypto-native strategy follower
Asset universe: three PreStocks assets plus USDC
Strategy: AI Infrastructure Basket
Agent: observe + propose by default
Execution: simulated or user-approved only
Approval: required for every action
Maximum single asset: 35%
Minimum USDC reserve: 10%
Rebalance trigger: 5 percentage points
Pyth maximum age: 30 seconds
```

### Checkpoint

The AI must verify:

- The project starts from a clean checkout.
- The README contains the one-sentence product promise.
- The scope excludes Tessera and other non-PreStocks pre-IPO assets.
- The repository has a documented run command.
- A basic health check or placeholder page loads.

### Evidence

Record:

```text
commit or version identifier
run command
health-check output
scope decisions
```

### Gate

**PASS only if a new AI session can understand the project, start it, and identify the exact MVP without asking for architectural clarification.**

## Phase 1 — Public strategy page with static verified data

### Objective

Build the product’s primary surface before adding wallets, agents, or complex infrastructure.

### Build

Create a public route such as:

```text
/strategy/ai-infrastructure
```

Show:

- Strategy name and thesis
- Three assets and target weights
- USDC reserve
- Current state
- Rule set
- Agent permission summary
- Fork button placeholder or disabled state
- Risk and asset disclosures

Use a clearly labelled fixture only if sponsor APIs are not yet connected:

```text
DATA_MODE: FIXTURE
```

### Checkpoint

The AI must verify:

- The page works without wallet connection.
- A new visitor understands what the strategy is within 20 seconds.
- The page does not claim that the basket is equity ownership.
- No unsupported asset appears.
- Responsive layout works at desktop and mobile widths.
- Loading, empty, and error states exist.

### Evidence

Record:

- Route screenshot
- Asset list used
- UI test result
- Fixture disclosure if applicable

### Gate

**PASS only if the public page communicates the product without needing an explanation from the team.**

## Phase 2 — Data adapters and Pyth-driven valuation

### Objective

Replace unverified fixture values with source-aware adapters and make Pyth data affect the product.

### Build

Implement internal interfaces:

```typescript
AssetRegistry.listApprovedAssets()
AssetRegistry.getAsset(mint)
PriceProvider.getTokenPrice(mint)
PriceProvider.getReferencePrice(feedId)
StrategyValuator.calculate(snapshot)
```

Every price snapshot must contain:

```text
source
feed ID or mint
price
confidence if available
publish time
received time
age
validity
```

Implement:

```text
Mark NAV
Reference NAV
Premium/discount
Data freshness
Data confidence
```

### Checkpoint

The AI must verify:

- The approved asset allowlist is server-side or checked into the backend, not only in frontend code.
- Every displayed price has a source and timestamp.
- Pyth feed ID is validated.
- Pyth age is calculated from timestamps, not guessed.
- Stale data produces `STALE_DATA` or an equivalent explicit state.
- Missing reference data produces `UNKNOWN`, not a fabricated estimate.
- The UI visibly shows token price and reference price separately.

### Evidence

Record:

- Sample raw response from each adapter with secrets removed
- Pyth feed ID
- Price age and confidence output
- Screenshot showing source metadata
- Tests for fresh, stale, invalid, and missing data

### Gate

**PASS only if removing the Pyth adapter changes the strategy’s state or valuation behavior, not merely a chart.**

## Phase 3 — Deterministic rules engine and state machine

### Objective

Make portfolio logic deterministic and independent of the LLM.

### Build

Implement:

```text
calculateCurrentWeights()
calculateWeightDrift()
calculateMarkNAV()
calculateReferenceNAV()
calculateDislocation()
validateReserve()
validateMaxWeights()
validatePriceQuality()
validateNotionalLimits()
classifyStrategyState()
```

Use these states:

```text
NORMAL
DRIFTED
STALE_DATA
DISLOCATED
PAUSED
```

Use these demo rules:

```text
Maximum single asset: 35%
Minimum USDC reserve: 10%
Rebalance trigger: 5 percentage points
Maximum action: $50 demo notional
Maximum daily notional: $200 demo notional
Pyth maximum age: 30 seconds
```

### Checkpoint

The AI must verify:

- Identical inputs produce identical outputs.
- No LLM call is required to calculate a state.
- A price or weight change produces the expected state.
- A stale Pyth snapshot blocks proposal eligibility.
- A maximum-weight breach is detected.
- A reserve breach is detected.
- Unit tests cover boundary values: exactly 35%, 35.01%, exactly 10%, 9.99%, exactly 30 seconds, and 30.01 seconds.

### Evidence

Record:

- Rules-engine test output
- Fixture inputs and outputs
- State-transition table
- Boundary-test results

### Gate

**PASS only if the AI can explain every state transition using numeric inputs and deterministic code.**

## Phase 4 — Solana strategy accounts and lifecycle

### Objective

Move the strategy’s critical identity, assets, rules, and status on-chain.

### Build

Implement the smallest program containing:

```text
initialize_strategy()
set_assets()
set_rules()
set_agent_permission()
pause_strategy()
revoke_agent()
```

Create accounts for:

```text
Strategy PDA
Rules PDA
Permission PDA
Asset PDAs
```

Emit events for:

```text
StrategyCreated
RulesUpdated
PermissionSet
StrategyPaused
AgentRevoked
```

### Checkpoint

The AI must verify:

- The program builds from a clean checkout.
- Local validator or configured network tests pass.
- Account seeds are deterministic.
- Unauthorized wallet cannot modify the strategy.
- Paused strategy rejects protected actions.
- Revoked agent loses authority.
- Transaction signatures or test logs are captured.

### Evidence

Record:

- Program ID
- Account addresses or deterministic derivations
- Build and test output
- One creation transaction or local proof
- Authorization failure test

### Gate

**PASS only if the strategy’s critical permissions exist on-chain and unauthorized actions fail.**

## Phase 5 — Proposal rejection and user approval

### Objective

Prove that the system can reject an invalid agent action and approve a valid one.

### Build

Implement:

```text
propose_rebalance()
approve_rebalance()
execute_rebalance_or_simulate()
```

The program must reject:

- Maximum-weight breach
- Reserve breach
- Stale Pyth data
- Wrong feed ID
- Expired permission
- Excessive notional
- Invalid approval nonce
- Expired proposal

### Required scenarios

#### Scenario A: invalid weight

```text
Current weight: 41.2%
Maximum: 35%
Expected: rejected with MAX_WEIGHT_EXCEEDED
```

#### Scenario B: valid proposal

```text
New weight: 34.8%
USDC reserve: 10.5%
Notional: $42
Pyth age: 4 seconds
Expected: proposal accepted, approval required
```

#### Scenario C: stale oracle

```text
Pyth age: 45 seconds
Maximum: 30 seconds
Expected: blocked with STALE_DATA
```

### Checkpoint

The AI must verify:

- Invalid proposal produces a verifiable program failure.
- Valid proposal cannot execute without approval.
- Approval is tied to the exact proposal and nonce.
- Proposal expiry works.
- Public UI shows the rejected reason.
- Public UI shows the approved event.

### Evidence

Record:

- Invalid transaction signature or deterministic test output
- Valid proposal signature
- Approval signature
- Explorer links if deployed
- Before/after state

### Gate

**PASS only if the team can show an actual rejection, not merely display a red warning in the frontend.**

## Phase 6 — Clawpump agent with constrained permissions

### Objective

Make Clawpump operate the protocol without making the agent a trusted authority.

### Build

The agent receives structured state and returns structured output:

```json
{
  "state": "DRIFTED",
  "reasonCodes": ["ASSET_OVERWEIGHT"],
  "summary": "Asset A is 6.2 percentage points above target.",
  "action": "PROPOSE_REBALANCE",
  "requiresApproval": true
}
```

Start with:

```text
READ: enabled
PROPOSE: enabled
EXECUTE: disabled
```

For the final demo, if execution is enabled:

```text
per-action limit: $50
 daily limit: $200
approval: required
expiry: configured
```

### Checkpoint

The AI must verify:

- Agent cannot change strategy rules.
- Agent cannot add assets.
- Agent cannot bypass the program.
- Agent cannot execute stale-data proposals.
- Agent cannot exceed notional limits.
- Revoking the agent immediately blocks its proposals.
- The UI displays agent permissions in plain language.

### Evidence

Record:

- Agent ID and public configuration
- Permission snapshot
- Example structured input and output
- One agent-generated proposal
- One blocked agent action

### Gate

**PASS only if the agent is useful while remaining an untrusted proposer.**

## Phase 7 — Forking and independent strategy state

### Objective

Prove that StockWeave is a public strategy network, not a private portfolio dashboard.

### Build

Implement a real fork transaction:

```text
fork_strategy(parent_strategy_id)
```

The fork copies:

- Asset list
- Target weights
- Rule template
- Thesis and metadata reference

The fork receives new:

- Strategy PDA
- Creator wallet
- Agent permission account
- Rule-set version
- Activity history

### Checkpoint

The AI must verify:

- Wallet B can fork Wallet A’s strategy.
- Wallet B can change one rule.
- Wallet A cannot control Wallet B’s strategy.
- The public pages show parent and fork relationship.
- Fork activity is visible on-chain or through indexed events.

### Evidence

Record:

- Parent strategy address
- Fork strategy address
- Wallet identities abbreviated safely
- Changed rule
- Fork transaction or test output

### Gate

**PASS only if the fork creates independent on-chain state and authority.**

## Phase 8 — Purposeful Meteora market

### Objective

Use Meteora as a meaningful market-design component, not a sponsor logo or generic token launch.

### Build

Create or configure a StockWeave strategy token paired with one approved PreStocks token through Meteora DBC.

Document:

```text
strategy-token utility
quote mint
curve shape
fee schedule
graduation threshold
post-graduation destination
liquidity policy
```

The strategy token must not be described as direct ownership of the underlying companies or as a guaranteed claim on basket assets.

### Required rationale

Explain how the DBC is designed for a thin, newly formed tokenized-stock market:

- Slower early price movement
- Higher launch-protection fee
- Defined quote-reserve threshold
- Explicit graduation path
- Clear separation between strategy-token price and reference-stock price

### Checkpoint

The AI must verify:

- Pool address exists.
- Configuration is reproducible.
- Pair uses the approved asset route.
- Pool parameters are visible in the product or README.
- A judge can understand why the configuration is not a default meme launch.
- Token utility and economic rights are stated clearly.

### Evidence

Record:

- Pool address
- Configuration values
- Transaction signature
- Screenshot of pool and product explanation
- Short market-design rationale

### Gate

**PASS only if Meteora is necessary to the product story and the configuration demonstrates original thought.**

## Phase 9 — Integration hardening and demo rehearsal

### Objective

Make the golden path reliable from a clean environment.

### Build

Create a seeded demo environment containing:

- One public strategy
- Three approved assets
- One drift scenario
- One stale-data fallback scenario
- One invalid proposal
- One valid proposal
- One forked strategy
- One Meteora pool reference

Add a visible mode indicator:

```text
LIVE_DATA
DEMO_MODE
```

Never mix live and simulated values without labelling them.

### Checkpoint

Run the entire flow from a clean browser session:

1. Open public strategy page.
2. Inspect assets and rules.
3. Show Pyth data.
4. Trigger drift.
5. Get Clawpump explanation.
6. Submit invalid proposal.
7. Show rejection.
8. Submit valid proposal.
9. Approve it.
10. Show on-chain event.
11. Fork with another wallet.
12. Show Meteora pool.

### Evidence

Record:

- Full-screen recording
- Time to complete the flow
- Failure points
- Fallback video
- Fresh-checkout run output

### Gate

**PASS only if the demo completes in under three minutes without manual database edits or hidden operator actions.**

## Phase 10 — Submission packaging and final audit

### Objective

Prepare a submission that is easy for a judge to verify.

### README must contain

1. One-sentence product promise.
2. Target user.
3. What is real versus demo mode.
4. Architecture diagram.
5. Setup instructions.
6. Asset policy and PreStocks eligibility statement.
7. Pyth integration details.
8. Clawpump permission model.
9. Solana program ID and accounts.
10. Invalid and valid proposal evidence.
11. Fork evidence.
12. Meteora pool and configuration.
13. Risk and asset disclosures.
14. Demo video and live URL.
15. Known limitations and next steps.

### Final AI audit questions

The AI must answer `PASS` or `FAIL` with evidence for every question:

```text
Can a new visitor understand the product in 20 seconds?
Is the target user explicit?
Are only permitted PreStocks assets used?
Does Pyth change valuation or state?
Are stale and invalid data handled?
Is the rules engine deterministic?
Can the Solana program reject invalid actions?
Does approval protect valid actions?
Can the agent be revoked?
Can another wallet fork independently?
Is Meteora’s configuration purposeful?
Is the strategy-token utility clear?
Can every important claim be verified?
Can the demo finish in under three minutes?
```

Any `FAIL` blocks submission packaging until fixed or explicitly documented as a limitation.

## Checkpoint file format

After every phase, create:

```markdown
# Phase XX Checkpoint

Status: PASS | FAIL | BLOCKED
Date:

## Objective

## What changed

## Tests run

## Evidence

- command or URL:
- transaction or artifact:
- screenshot or recording:

## Known failures

## Risks

## Decision

Proceed to Phase XX+1: YES | NO

## Next action
```

## AI handoff prompt

Use this prompt at the start of every build session:

```text
You are building StockWeave. Read the architecture, this build protocol, the latest checkpoint, and the decision log before changing code.

First report:
1. Current phase and status.
2. Previous checkpoint result.
3. Phase objective.
4. Files/components you will change.
5. Acceptance tests you will run.
6. What would block progression.

Then implement only the current phase. Do not start the next phase. Run the acceptance tests. If any mandatory test fails, mark the phase FAIL, explain the failure, and stop. If all mandatory tests pass, write docs/checkpoints/phase-XX.md with evidence and mark the phase PASS.
```

## Final principle

> **The AI is not allowed to optimize for visible progress. It must optimize for verified progress.**

A smaller system with ten proven behaviors is stronger than a large system with ten unverified integrations.
