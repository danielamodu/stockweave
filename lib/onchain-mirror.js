// OFF-CHAIN MIRROR — NOT on-chain proof. DO NOT present as Solana execution.
//
// Purpose: replicate the Phase 4 program's instruction logic deterministically
// in Node so the state machine (authority, pause, revoke) is unit-testable
// without Solana tooling on this PC. Real build/test/deploy happens in
// Solana Playground per docs/solana-playground-phase04.md.
//
// Differences from on-chain (recorded, not hidden):
// - Addresses are sha256(seed) hex labelled SIMULATED, NOT ed25519 PDAs.
// - No rent, no real signatures, no cluster. Authority = key strings.
// - Error codes mirror the program's StockWeaveError names.
const crypto = require("crypto");

function simAddress(...seeds) {
  const h = crypto.createHash("sha256");
  for (const s of seeds) h.update(String(s), "utf8");
  return "SIMULATED_" + h.digest("hex").slice(0, 44);
}

function fail(code, msg) {
  const err = new Error(`${code}: ${msg}`);
  err.code = code;
  throw err;
}

class MirrorWorld {
  constructor() {
    this.strategies = new Map();
    this.assets = new Map();
    this.rules = new Map();
    this.permissions = new Map();
    this.proposals = new Map();
    this.events = [];
  }

  initializeStrategy(creator, strategyId) {
    if (!strategyId || strategyId.length > 64) fail("BadStrategyId", "id length");
    const address = simAddress("strategy", creator, strategyId);
    if (this.strategies.has(address)) fail("BadStrategyId", "already exists");
    this.strategies.set(address, {
      address, creator, strategyId, parentStrategy: null,
      status: "ACTIVE", rulesHash: null,
    });
    this.events.push({ event: "StrategyCreated", strategy: address, creator, strategyId });
    return address;
  }

  _strategy(address) {
    const s = this.strategies.get(address);
    if (!s) fail("BadStrategyId", "unknown strategy");
    return s;
  }

  _requireAuthority(strategy, signer) {
    if (signer !== strategy.creator) fail("Unauthorized", `${signer} is not creator`);
  }

  _requireActive(strategy) {
    if (strategy.status === "PAUSED") fail("StrategyPaused", "protected action rejected");
  }

  setAssets(strategyAddr, signer, mint, targetWeightBps, maxWeightBps) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    this._requireActive(s);
    if (targetWeightBps > 10000 || maxWeightBps > 10000) fail("BadRules", "weight range");
    const address = simAddress("asset", strategyAddr, mint);
    this.assets.set(address, { address, strategy: strategyAddr, mint, targetWeightBps, maxWeightBps, enabled: true });
    return address;
  }

  setRules(strategyAddr, signer, rules) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    this._requireActive(s);
    if (rules.maxSingleAssetWeightBps > 10000 || rules.reserveWeightBps > 10000 || rules.maxPriceAgeSeconds <= 0) {
      fail("BadRules", "rule range");
    }
    const address = simAddress("rules", strategyAddr);
    const prev = this.rules.get(address);
    const version = (prev ? prev.version : 0) + 1;
    this.rules.set(address, { address, strategy: strategyAddr, ...rules, requireUserApproval: true, version });
    s.rulesHash = address;
    this.events.push({ event: "RulesUpdated", strategy: strategyAddr, version });
    return address;
  }

  setAgentPermission(strategyAddr, signer, agent, perm) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    this._requireActive(s);
    if (perm.allowedActions & ~0b111) fail("BadPermission", "unknown action bits");
    const address = simAddress("permission", strategyAddr, agent);
    this.permissions.set(address, {
      address, strategy: strategyAddr, agent, authority: signer,
      approvalRequired: true, revoked: false, ...perm,
    });
    this.events.push({ event: "PermissionSet", strategy: strategyAddr, agent, allowedActions: perm.allowedActions });
    return address;
  }

  pauseStrategy(strategyAddr, signer) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    s.status = "PAUSED";
    this.events.push({ event: "StrategyPaused", strategy: strategyAddr });
  }

  revokeAgent(strategyAddr, signer, agent) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    const address = simAddress("permission", strategyAddr, agent);
    const perm = this.permissions.get(address);
    if (!perm || perm.strategy !== strategyAddr) fail("Unauthorized", "unknown permission");
    perm.revoked = true;
    this.events.push({ event: "AgentRevoked", strategy: strategyAddr, agent });
  }

  // Agent authority check mirroring Phase 5's future guard (used by tests).
  assertAgentCanPropose(strategyAddr, agent, now) {
    const s = this._strategy(strategyAddr);
    if (s.status === "PAUSED") fail("StrategyPaused", "strategy paused");
    const perm = this.permissions.get(simAddress("permission", strategyAddr, agent));
    if (!perm || perm.revoked) fail("Unauthorized", "agent revoked or unknown");
    if (perm.expiry <= now) fail("PermissionExpired", "permission expired");
    if (!(perm.allowedActions & 0b010)) fail("Unauthorized", "PROPOSE not granted");
    return true;
  }

  // Phase 5 — rebalance lifecycle. Error codes mirror the program's
  // StockWeaveError names 1:1 so a divergence surfaces as a test failure.
  proposeRebalance(strategyAddr, agent, args, now) {
    const s = this._strategy(strategyAddr);
    if (s.status === "PAUSED") fail("StrategyPaused", "strategy paused");
    const perm = this.permissions.get(simAddress("permission", strategyAddr, agent));
    if (!perm || perm.strategy !== strategyAddr) fail("Unauthorized", "unknown permission");
    if (perm.agent !== agent) fail("Unauthorized", "wrong agent");
    if (perm.revoked) fail("PermissionRevoked", "agent revoked");
    if (perm.expiry <= now) fail("PermissionExpired", "permission expired");
    if (!(perm.allowedActions & 0b010)) fail("ProposeNotAllowed", "PROPOSE not granted");

    const rules = this.rules.get(simAddress("rules", strategyAddr));
    if (!rules) fail("BadRules", "rules not set");
    if (args.oracleFeedId !== rules.referenceFeedId) fail("WrongFeed", "feed id mismatch");
    if (args.oraclePublishTime > now) fail("StaleOracle", "publish time in future");
    if (now - args.oraclePublishTime > rules.maxPriceAgeSeconds) fail("StaleOracle", "oracle stale");
    if (args.newTargetWeightBps > rules.maxSingleAssetWeightBps) fail("MaxWeightExceeded", "weight breach");
    if (args.projectedReserveBps < rules.reserveWeightBps) fail("ReserveBreach", "reserve breach");
    if (args.notional > rules.maxTradeNotional) fail("ExcessiveNotional", "over trade limit");
    if (args.notional > perm.maxNotionalPerAction) fail("ExcessiveNotional", "over per-action limit");
    if (args.expiresAt <= now) fail("ProposalExpired", "expiry not in future");

    const address = simAddress("proposal", strategyAddr, args.proposalId);
    this.proposals.set(address, {
      address, strategy: strategyAddr, proposalId: args.proposalId, createdBy: agent,
      mint: args.mint, newTargetWeightBps: args.newTargetWeightBps,
      projectedReserveBps: args.projectedReserveBps, notional: args.notional,
      reasonCode: args.reasonCode, oracleFeedId: args.oracleFeedId,
      approvalNonce: args.approvalNonce, expiresAt: args.expiresAt, status: "PROPOSED",
    });
    this.events.push({ event: "RebalanceProposed", strategy: strategyAddr, proposal: address, proposalId: args.proposalId });
    return address;
  }

  approveRebalance(strategyAddr, signer, proposalId, approvalNonce, now) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    if (s.status === "PAUSED") fail("StrategyPaused", "strategy paused");
    const proposal = this.proposals.get(simAddress("proposal", strategyAddr, proposalId));
    if (!proposal) fail("BadProposalState", "unknown proposal");
    if (proposal.strategy !== strategyAddr) fail("Unauthorized", "wrong strategy");
    if (proposal.status !== "PROPOSED") fail("BadProposalState", "not in Proposed state");
    if (now > proposal.expiresAt) fail("ProposalExpired", "proposal expired");
    if (approvalNonce !== proposal.approvalNonce) fail("BadApprovalNonce", "nonce mismatch");
    proposal.status = "APPROVED";
    this.events.push({ event: "RebalanceApproved", strategy: strategyAddr, proposal: proposal.address, proposalId });
    return proposal.address;
  }

  executeRebalance(strategyAddr, signer, proposalId, now) {
    const s = this._strategy(strategyAddr);
    this._requireAuthority(s, signer);
    if (s.status === "PAUSED") fail("StrategyPaused", "strategy paused");
    const proposal = this.proposals.get(simAddress("proposal", strategyAddr, proposalId));
    if (!proposal) fail("BadProposalState", "unknown proposal");
    if (proposal.status !== "APPROVED") fail("BadProposalState", "not Approved");
    if (now > proposal.expiresAt) fail("ProposalExpired", "proposal expired");
    proposal.status = "EXECUTED";
    this.events.push({ event: "RebalanceExecuted", strategy: strategyAddr, proposal: proposal.address, proposalId, simulated: true });
    return proposal.address;
  }
}

module.exports = { MirrorWorld, simAddress };
