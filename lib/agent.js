// Phase 6 — Clawpump agent (constrained, untrusted proposer).
//
// The agent is deterministic: it consumes the rules-engine classification and
// the on-chain-mirrored permission, then decides an ACTION and (if allowed)
// sizes a rebalance proposal. It NEVER decides numeric limits, weight validity,
// or oracle freshness — those come from the deterministic rules engine
// (lib/rules.js) and are re-enforced on-chain (programs/stockweave). The
// summary is a TEMPLATED explanation of the real numbers, not fabricated LLM
// prose; a real LLM/Clawpump binding is a documented seam (D-601), not faked.
//
// Guarantees proven by tests (phase06.js) and mirrored on-chain:
// - Cannot change rules or add assets (no such output exists).
// - Cannot execute: EXECUTE is off by default; a proposal always
//   requiresApproval and action is never EXECUTE.
// - Cannot act on stale/invalid data or a paused strategy (returns HOLD).
// - Cannot exceed notional: proposed trade is capped at maxNotionalPerAction.
// - Revoked or expired permission, or missing PROPOSE grant, blocks proposals.

const ACTION_BITS = { READ: 0b001, PROPOSE: 0b010, EXECUTE: 0b100 };

// Blocking reasons (permission/state) — distinct from rules-engine reasonCodes.
const BLOCK = {
  REVOKED: "AGENT_REVOKED",
  EXPIRED: "PERMISSION_EXPIRED",
  NO_PROPOSE: "PROPOSE_NOT_GRANTED",
  PAUSED: "STRATEGY_PAUSED",
  DATA: "DATA_NOT_FRESH",
};

function bps2pct(bps) {
  return (bps / 100).toFixed(2);
}

// Permission gate mirroring the on-chain AgentPermission guard. Returns null if
// the agent may propose, or a { blocked, blockReason } object if not.
function checkPermission(permissions, nowSeconds) {
  if (!permissions) return { blocked: true, blockReason: BLOCK.NO_PROPOSE };
  if (permissions.revoked) return { blocked: true, blockReason: BLOCK.REVOKED };
  if (permissions.expiry != null && nowSeconds >= permissions.expiry) {
    return { blocked: true, blockReason: BLOCK.EXPIRED };
  }
  if (!(permissions.allowedActions & ACTION_BITS.PROPOSE)) {
    return { blocked: true, blockReason: BLOCK.NO_PROPOSE };
  }
  return null;
}

// Renders the permission mandate in plain language for the UI.
function describePermissions(permissions) {
  if (!permissions) return "No agent attached.";
  const can = [];
  if (permissions.allowedActions & ACTION_BITS.READ) can.push("read strategy state");
  if (permissions.allowedActions & ACTION_BITS.PROPOSE) can.push("propose rebalances (your approval required)");
  if (permissions.allowedActions & ACTION_BITS.EXECUTE) can.push("execute approved rebalances");
  const capped = `Capped at $${permissions.maxNotionalPerAction} per action, $${permissions.maxDailyNotional} per day.`;
  if (permissions.revoked) return `Agent REVOKED — it can do nothing. ${capped}`;
  const verb = can.length ? `This agent can ${can.join(", ")}.` : "This agent has no granted actions.";
  const exec = permissions.allowedActions & ACTION_BITS.EXECUTE
    ? ""
    : " It cannot execute, cannot change rules, and cannot add assets.";
  return `${verb}${exec} ${capped}`;
}

// Finds the asset furthest above its target (the rebalance candidate).
function topOverweight(currentWeightsBps, targetWeightsBps) {
  let sym = null;
  let maxOverBps = 0;
  for (const s of Object.keys(targetWeightsBps)) {
    const over = (currentWeightsBps[s] || 0) - targetWeightsBps[s];
    if (over > maxOverBps) {
      maxOverBps = over;
      sym = s;
    }
  }
  return { sym, overBps: maxOverBps };
}

// Main entry: structured state in → structured agent output out.
// input: {
//   strategyState, reasonCodes, currentWeightsBps, targetWeightsBps,
//   dataQuality, proposalAllowed, navUsd, rules, permissions, nowSeconds
// }
function decide(input) {
  const {
    strategyState,
    reasonCodes = [],
    currentWeightsBps = {},
    targetWeightsBps = {},
    dataQuality = "UNKNOWN",
    proposalAllowed = false,
    navUsd = 0,
    rules = {},
    permissions = null,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = input;

  const base = {
    state: strategyState,
    reasonCodes,
    permissionSummary: describePermissions(permissions),
    requiresApproval: true, // always — the agent never self-approves
  };

  // 1) Permission gate (mirrors on-chain guard; revocation blocks immediately).
  const permBlock = checkPermission(permissions, nowSeconds);
  if (permBlock) {
    return {
      ...base,
      action: "NONE",
      trades: [],
      blocked: true,
      blockReason: permBlock.blockReason,
      summary: `Agent cannot propose: ${permBlock.blockReason}.`,
    };
  }

  // 2) Paused strategy — explain, do nothing.
  if (strategyState === "PAUSED") {
    return {
      ...base,
      action: "NONE",
      trades: [],
      blocked: true,
      blockReason: BLOCK.PAUSED,
      summary: "Strategy is paused. The agent takes no action until it resumes.",
    };
  }

  // 3) Stale/invalid data — the agent may explain but must NOT propose.
  if (dataQuality === "STALE_DATA" || dataQuality === "INVALID_FEED" || dataQuality === "LOW_CONFIDENCE") {
    return {
      ...base,
      action: "HOLD",
      trades: [],
      blocked: true,
      blockReason: BLOCK.DATA,
      summary: `Oracle data is ${dataQuality}; the agent holds and will not propose on unreliable data.`,
    };
  }

  // 4) Normal / no drift — nothing to do.
  if (strategyState === "NORMAL" || !proposalAllowed) {
    const reason = proposalAllowed ? "within target bands" : `not proposal-eligible (${reasonCodes.join(", ") || "no drift"})`;
    return {
      ...base,
      action: "HOLD",
      trades: [],
      blocked: false,
      summary: `Strategy is ${reason}. No rebalance needed.`,
    };
  }

  // 5) DRIFTED + proposal-eligible → size a compliant proposal.
  const { sym, overBps } = topOverweight(currentWeightsBps, targetWeightsBps);
  const maxPerAction = permissions.maxNotionalPerAction != null
    ? permissions.maxNotionalPerAction
    : (rules.maxTradeNotional != null ? rules.maxTradeNotional : 0);

  // Notional needed to bring the asset back to target, capped by the mandate.
  const neededUsd = Math.round((navUsd * overBps) / 10000);
  const notionalUsd = Math.min(neededUsd, maxPerAction);
  const capped = notionalUsd < neededUsd;

  if (!sym || notionalUsd <= 0) {
    return {
      ...base,
      action: "HOLD",
      trades: [],
      blocked: false,
      summary: "Drift detected but no compliant trade is available. Holding.",
    };
  }

  const trade = { symbol: sym, side: "SELL", intoReserve: "USDC", notionalUsd };
  const summary =
    `${sym} is ${bps2pct(overBps)} percentage points above its ${bps2pct(targetWeightsBps[sym])}% target. ` +
    `Proposing to sell $${notionalUsd} of ${sym} into the USDC reserve` +
    (capped ? ` (capped at the $${maxPerAction} per-action limit; a full rebalance needs $${neededUsd}).` : ".") +
    " Requires your approval.";

  return {
    ...base,
    action: "PROPOSE_REBALANCE",
    trades: [trade],
    blocked: false,
    notionalUsd,
    cappedByLimit: capped,
    summary,
  };
}

module.exports = { decide, describePermissions, checkPermission, ACTION_BITS, BLOCK };
