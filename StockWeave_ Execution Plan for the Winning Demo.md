# StockWeave: Execution Plan for the Winning Demo

## Objective

Build one reliable, judgeable flow rather than a broad platform:

```text
Public strategy page
→ Pyth-powered valuation
→ induced drift or stale-data event
→ Clawpump explanation
→ invalid proposal rejected on-chain
→ valid proposal approved
→ verifiable Solana event
→ independent fork
→ purposeful Meteora stock-paired market
```

The product should be demonstrated with a **PreStocks-only asset universe plus USDC** to preserve the PreStocks bounty route.

## 1. Freeze the product contract before coding

Write this one-sentence contract into the README, landing page, and demo script:

> StockWeave lets anyone inspect, simulate, fork, and follow a tokenized-stock strategy without trusting an opaque portfolio manager.

Define the first user as a crypto-native strategy follower. Do not build for every investor, every asset class, or every financial workflow.

### Fixed MVP assumptions

```text
Asset universe: three PreStocks assets plus USDC
Strategy: AI Infrastructure Basket
Agent mode: observe + propose by default
Execution: simulated or user-approved only
Approval: required for every action
Maximum action: $50 demo notional
Maximum daily notional: $200 demo notional
Maximum single asset: 35%
Minimum USDC reserve: 10%
Rebalance trigger: 5 percentage points of drift
Pyth maximum age: 30 seconds
```

### Exit test

The team can explain the product and scope in under 20 seconds without mentioning every sponsor.

## 2. Create the public strategy page first

The public page is the product’s centre of gravity. It should work before wallet connection and should make the strategy understandable immediately.

### Build

Create a route such as:

```text
/strategy/ai-infrastructure
```

Display:

- Strategy name and thesis
- Three assets and target weights
- USDC reserve
- Current weights
- Mark NAV
- Reference NAV where available
- Premium or discount
- Pyth timestamp and confidence
- Current state
- Rule set
- Agent permissions
- Rebalance history
- Fork button
- Risk and asset disclosures

### Acceptance test

A new visitor can answer these questions from the page without connecting a wallet:

1. What is this strategy?
2. What does it contain?
3. What rules govern it?
4. Is its data fresh?
5. What can the agent do?
6. What happened previously?
7. How do I fork it?

## 3. Build the asset registry and data adapters

Do not let the frontend call sponsor APIs directly. Put all external data behind stable internal interfaces.

### Internal interfaces

```typescript
interface AssetRegistry {
  listApprovedAssets(): Promise<ApprovedAsset[]>;
  getAsset(mint: string): Promise<ApprovedAsset>;
}

interface PriceProvider {
  getTokenPrice(mint: string): Promise<TokenPriceSnapshot>;
  getReferencePrice(feedId: string): Promise<ReferencePriceSnapshot>;
}

interface StrategyValuator {
  calculate(snapshot: StrategySnapshot): ValuationResult;
}
```

### Asset registry rules

Each approved asset record should contain:

```text
mint address
symbol
issuer: PreStocks
product URL
metadata URL
Pyth feed ID if available
price decimals
allowed: true/false
```

Do not accept arbitrary mints in the MVP. Use a small checked-in allowlist.

### Acceptance test

Given a strategy ID, the server can return the complete asset list, source URLs, mint addresses, and feed IDs without relying on frontend constants.

## 4. Implement Pyth as a state dependency

Pyth must change system behavior.

### Build

Implement a price snapshot containing:

```text
feed ID
price
confidence
publish time
received time
age
validity
```

Create a deterministic validator:

```text
if feed ID is wrong        → INVALID_FEED
if age > 30 seconds        → STALE_DATA
if confidence too wide     → LOW_CONFIDENCE
otherwise                  → FRESH
```

Use the result to control strategy state:

```text
FRESH + no drift           → NORMAL
FRESH + drift              → DRIFTED
STALE_DATA                 → STALE_DATA
large token/reference gap  → DISLOCATED
```

### Demo control

Create an explicit demo mode that can freeze or age the reference snapshot. This lets the team reliably show a stale-data rejection without depending on live market conditions.

The demo control must be visually marked as a simulation. Never present manipulated data as live market data.

### Acceptance test

When the Pyth snapshot is stale, the UI changes state and the proposal/execution path is blocked. The result is visible in the UI and enforced by the program where applicable.

## 5. Build the deterministic rules engine

The rules engine calculates facts. The AI explains facts.

### Required functions

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

### Example output

```json
{
  "state": "DRIFTED",
  "reasonCodes": ["ASSET_OVERWEIGHT"],
  "currentWeights": {"ASSET_A": 4120, "ASSET_B": 2380, "USDC": 1000},
  "targetWeights": {"ASSET_A": 3500, "ASSET_B": 2500, "USDC": 1000},
  "dataQuality": "FRESH",
  "proposalAllowed": true,
  "executionAllowed": false,
  "requiresApproval": true
}
```

### Acceptance test

The same inputs always produce the same state and proposal eligibility. No LLM call is needed to calculate the result.

## 6. Implement the Solana program around rejection and approval

The smart contract should be small. Its job is not to become a complete portfolio protocol. Its job is to make the key claims credible.

### Minimum instructions

```text
initialize_strategy()
set_rules()
set_agent_permission()
propose_rebalance()
approve_rebalance()
execute_rebalance_or_simulate()
pause_strategy()
revoke_agent()
```

### Minimum accounts

```text
Strategy PDA
Rules PDA
Permission PDA
Proposal PDA
```

### Minimum on-chain checks

The program must reject a proposal when:

- The strategy is paused.
- The authority is invalid.
- The permission expired.
- The proposed asset exceeds 35%.
- USDC reserve falls below 10%.
- The action exceeds $50.
- The Pyth update is stale.
- The proposal nonce or expiry is wrong.

### Acceptance test

The team can produce a transaction signature for:

1. A rejected invalid proposal.
2. A valid proposal.
3. A user approval.

The README links to the relevant explorer pages or a reproducible local proof.

## 7. Add the Clawpump agent after the protocol works

Do not begin with an autonomous agent. Begin with a deterministic protocol flow, then let Clawpump operate it.

### Agent role

The agent receives structured facts:

```json
{
  "strategyState": "DRIFTED",
  "reasonCodes": ["ASSET_OVERWEIGHT"],
  "currentWeights": {},
  "targetWeights": {},
  "rules": {},
  "permissions": {},
  "priceQuality": {}
}
```

It returns:

```json
{
  "summary": "Asset A is 6.2 percentage points above target.",
  "action": "PROPOSE_REBALANCE",
  "trades": [],
  "requiresApproval": true
}
```

### Agent permissions

Start with:

```text
READ: enabled
PROPOSE: enabled
EXECUTE: disabled
```

For the final demo, enable execution only with:

```text
per-action limit: $50
 daily limit: $200
approval: required
expiry: configured
```

### Acceptance test

The agent cannot directly execute a trade. It can only create a proposal, and the program decides whether the proposal is valid.

## 8. Build the invalid and valid demo scenarios

The demo should be deterministic and rehearsed.

### Scenario A: invalid proposal

Input:

```text
Current Asset A weight: 41.2%
Maximum allowed: 35%
```

Expected behavior:

```text
Strategy state: DRIFTED
Agent explanation: asset overweight
Proposal: rejected by Solana program
Reason: MAX_WEIGHT_EXCEEDED
```

### Scenario B: valid proposal

Input:

```text
Proposed Asset A weight: 34.8%
USDC reserve: 10.5%
Notional: $42
Pyth age: 4 seconds
```

Expected behavior:

```text
Proposal: accepted
User approval: required
Approval: signed
Simulation or execution: completed
Event: indexed and visible publicly
```

### Scenario C: stale data

Input:

```text
Pyth age: 45 seconds
Maximum allowed: 30 seconds
```

Expected behavior:

```text
Strategy state: STALE_DATA
Proposal: blocked
Agent: explains but cannot execute
```

Only one invalid and one valid scenario are required for the final presentation. Keep the stale-data scenario as a backup because it demonstrates the strongest Pyth integration.

## 9. Implement forking as a real state transition

Forking must create an independent strategy, not merely copy a frontend object.

### Build

A fork transaction should:

- Create a new strategy PDA
- Store the parent strategy ID
- Copy the approved asset list
- Copy the rule template
- Require the new owner to set permissions
- Create a new event

The fork must have independent:

- Creator wallet
- Agent authority
- Rule-set version
- Status
- Activity history

### Acceptance test

Wallet B forks Wallet A’s strategy, changes the drift threshold, and receives a separate public strategy page. Wallet A cannot control Wallet B’s agent or permissions.

## 10. Make Meteora a product feature

Do this after the basket and proposal lifecycle works.

### Market-design decision

Create a StockWeave strategy token paired with one selected PreStocks token using Meteora DBC. The strategy token must have a clear utility statement and must not be described as direct ownership of the underlying companies or guaranteed entitlement to basket assets.

### Required Meteora work

- Create or configure the DBC pool.
- Document quote mint.
- Document curve shape.
- Document fee schedule.
- Document graduation threshold.
- Document post-graduation liquidity destination.
- Capture pool address and transaction evidence.
- Show the configuration in the product.

### Market-specific rationale

The team should explain that the configuration is designed for a thin, newly formed tokenized-stock market:

- Slower early price movement
- Higher launch protection fee
- Defined reserve threshold
- Explicit graduation path
- Clear warning that strategy-token price is not identical to the reference stock price

### Acceptance test

A judge can see the pool, understand why its parameters differ from a generic meme launch, and verify the pool address.

## 11. Integrate all ten judge requirements into the demo

| Requirement | Proof in demo |
|---|---|
| Public strategy page | Open the strategy URL before wallet connection |
| Three PreStocks assets | Show the allowlisted assets and source links |
| Pyth valuation | Show price, feed ID, age, confidence, and state change |
| Drift/stale event | Trigger one deterministic scenario |
| Clawpump explanation | Agent returns a structured reason and plain-language summary |
| Invalid proposal rejection | Show failed transaction or program error |
| Valid approved proposal | Show user approval and resulting event |
| Verifiable Solana event | Link transaction signature and indexed event |
| Independent fork | Switch to second wallet or forked strategy page |
| Purposeful Meteora market | Show DBC configuration, pool address, and rationale |

## 12. Build order and cut line

### Phase 1: Core proof

Build first:

1. Public strategy page
2. Static strategy data
3. Pyth snapshot adapter
4. Deterministic valuation and rules engine
5. Strategy state display

Do not add the agent or Meteora yet.

### Phase 2: On-chain proof

Build next:

6. Strategy creation
7. Rules account
8. Proposal account
9. Invalid proposal rejection
10. Valid approval event

Do not add publishing, ranking, or a marketplace yet.

### Phase 3: Agent proof

Build next:

11. Clawpump agent
12. Structured explanation
13. Proposal creation from agent
14. Permission display
15. Pause and revoke

### Phase 4: Network and liquidity proof

Build last:

16. Fork flow
17. Meteora DBC pool
18. Public event history
19. Demo polish
20. Video and README

### Hard cut line

If the team falls behind, remove features in this order:

1. Followers
2. Strategy ranking
3. Historical backtesting
4. Live execution
5. Automated scheduling
6. Multiple strategy templates

Do not remove:

- Pyth-driven state
- On-chain rejection
- User approval
- Forking
- Meteora evidence
- Public strategy page

## 13. Final demo script

### 0:00–0:20: Explain the product

> “StockWeave lets anyone inspect, simulate, fork, and follow a tokenized-stock strategy without trusting an opaque portfolio manager.”

### 0:20–0:50: Show the strategy

Open the public strategy page. Show assets, weights, reserve, rules, current state, Pyth data, and agent permissions.

### 0:50–1:20: Trigger the problem

Create a drift condition. Show the state changing from `NORMAL` to `DRIFTED`. Ask the Clawpump agent for an explanation.

### 1:20–1:50: Prove enforcement

Submit the invalid proposal. Show the Solana program rejecting it. Then submit the compliant proposal and require user approval.

### 1:50–2:10: Prove composability

Show the on-chain event and link the transaction. Fork the strategy from another wallet and change one rule.

### 2:10–2:35: Prove the market design

Open the Meteora DBC configuration, show the stock pair, curve, fee schedule, graduation threshold, and pool address.

### 2:35–2:50: Close

> “The agent proposes, but the strategy rules and Solana program decide. The strategy is public, forkable, and inspectable.”

## 14. Submission checklist

### Product

- [ ] The one-sentence promise is visible.
- [ ] The target user is explicit.
- [ ] The public strategy page works without a wallet.
- [ ] The fork flow creates independent state.

### Technical

- [ ] Pyth feed ID, timestamp, confidence, and age are displayed.
- [ ] Stale or invalid data changes state.
- [ ] Agent permissions are visible.
- [ ] Invalid proposal is rejected by the program.
- [ ] Valid proposal requires approval.
- [ ] Pause and revoke work.
- [ ] Events are indexed and verifiable.

### Sponsor

- [ ] Only permitted PreStocks assets are used in this submission.
- [ ] Clawpump agent is real or clearly documented.
- [ ] Meteora pool is real and its configuration is purposeful.
- [ ] Meteora parameters are explained in the README.

### Presentation

- [ ] Demo completes in under three minutes.
- [ ] Demo has a recorded fallback.
- [ ] README includes setup and architecture.
- [ ] Every deployed address is listed.
- [ ] Risk and asset disclosures are visible.
- [ ] No claim implies direct equity ownership unless supported.

## Final operating principle

**Build the proof, not the platform.**

The submission wins or loses on whether judges believe this statement after the demo:

> “This is a real, public, forkable strategy object. The data changes its state, the agent explains it, Solana enforces the rules, and the market design is intentional.”
