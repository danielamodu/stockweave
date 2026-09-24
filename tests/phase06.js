// Phase 6 acceptance tests — Clawpump agent (constrained, untrusted proposer).
// Deterministic, zero-dependency. Verifies the agent is useful but cannot
// change rules, add assets, execute, act on stale data, exceed notional, or
// act once revoked/expired — and that revocation blocks it immediately.
const assert = require("assert");
const agent = require("../lib/agent");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name} — ${e.message}`);
    process.exitCode = 1;
  }
}

const NOW = 1_700_000_000;
const TARGET = { OPENAI: 3000, ANTHROPIC: 3000, FIGUREAI: 3000, USDC: 1000 };
const ALLOWED_ACTIONS = new Set(["PROPOSE_REBALANCE", "HOLD", "NONE"]);

function perm(overrides = {}) {
  return {
    allowedActions: 0b011, // READ + PROPOSE, EXECUTE off
    maxNotionalPerAction: 50,
    maxDailyNotional: 200,
    expiry: NOW + 1_000_000,
    revoked: false,
    ...overrides,
  };
}

function driftedInput(overrides = {}) {
  return {
    strategyState: "DRIFTED",
    reasonCodes: ["DRIFT_THRESHOLD"],
    currentWeightsBps: { OPENAI: 4120, ANTHROPIC: 2380, FIGUREAI: 2500, USDC: 1000 },
    targetWeightsBps: TARGET,
    dataQuality: "FRESH",
    proposalAllowed: true,
    navUsd: 1000,
    rules: { maxTradeNotional: 50 },
    permissions: perm(),
    nowSeconds: NOW,
    ...overrides,
  };
}

check("Structured input → structured output shape", () => {
  const out = agent.decide(driftedInput());
  for (const k of ["state", "reasonCodes", "action", "trades", "requiresApproval", "summary", "permissionSummary"]) {
    assert.ok(k in out, `missing output field: ${k}`);
  }
  assert.ok(ALLOWED_ACTIONS.has(out.action), `unexpected action: ${out.action}`);
  assert.strictEqual(out.requiresApproval, true);
});

check("Drift + eligible → proposes a rebalance, requires approval, never executes", () => {
  const out = agent.decide(driftedInput());
  assert.strictEqual(out.action, "PROPOSE_REBALANCE");
  assert.strictEqual(out.requiresApproval, true);
  assert.notStrictEqual(out.action, "EXECUTE");
  assert.ok(out.trades.length === 1);
  assert.strictEqual(out.trades[0].symbol, "OPENAI"); // the overweight asset
  assert.strictEqual(out.trades[0].side, "SELL");
});

check("Proposed notional never exceeds the per-action limit", () => {
  const out = agent.decide(driftedInput());
  // Full rebalance needs $112 (11.2% of $1000); mandate caps at $50.
  assert.ok(out.notionalUsd <= 50, `notional ${out.notionalUsd} exceeds cap`);
  assert.strictEqual(out.trades[0].notionalUsd, 50);
  assert.strictEqual(out.cappedByLimit, true);
});

check("Even with EXECUTE granted, the agent never returns action EXECUTE", () => {
  const out = agent.decide(driftedInput({ permissions: perm({ allowedActions: 0b111 }) }));
  assert.notStrictEqual(out.action, "EXECUTE");
  assert.strictEqual(out.requiresApproval, true);
});

check("Revoked agent is blocked immediately (no proposal)", () => {
  const out = agent.decide(driftedInput({ permissions: perm({ revoked: true }) }));
  assert.strictEqual(out.action, "NONE");
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.blockReason, "AGENT_REVOKED");
  assert.strictEqual(out.trades.length, 0);
});

check("Expired permission is blocked", () => {
  const out = agent.decide(driftedInput({ permissions: perm({ expiry: NOW - 1 }) }));
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.blockReason, "PERMISSION_EXPIRED");
  assert.strictEqual(out.trades.length, 0);
});

check("Agent without PROPOSE grant cannot propose", () => {
  const out = agent.decide(driftedInput({ permissions: perm({ allowedActions: 0b001 }) }));
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.blockReason, "PROPOSE_NOT_GRANTED");
  assert.strictEqual(out.trades.length, 0);
});

check("Paused strategy → agent holds, no proposal", () => {
  const out = agent.decide(driftedInput({ strategyState: "PAUSED" }));
  assert.strictEqual(out.action, "NONE");
  assert.strictEqual(out.blockReason, "STRATEGY_PAUSED");
  assert.strictEqual(out.trades.length, 0);
});

check("Stale/invalid data → agent explains but will not propose", () => {
  for (const q of ["STALE_DATA", "INVALID_FEED", "LOW_CONFIDENCE"]) {
    const out = agent.decide(driftedInput({ dataQuality: q, proposalAllowed: false }));
    assert.strictEqual(out.action, "HOLD");
    assert.strictEqual(out.blockReason, "DATA_NOT_FRESH");
    assert.strictEqual(out.trades.length, 0, `${q} must not propose`);
  }
});

check("NORMAL state → hold, no trades", () => {
  const out = agent.decide(driftedInput({
    strategyState: "NORMAL",
    currentWeightsBps: TARGET,
    reasonCodes: [],
  }));
  assert.strictEqual(out.action, "HOLD");
  assert.strictEqual(out.trades.length, 0);
});

check("Agent output cannot change rules or add assets (no such fields/actions)", () => {
  const out = agent.decide(driftedInput());
  assert.ok(ALLOWED_ACTIONS.has(out.action));
  for (const forbidden of ["setRules", "addAsset", "newRules", "rules", "assets", "mint"]) {
    assert.ok(!(forbidden in out), `agent output must not carry: ${forbidden}`);
  }
});

check("Deterministic: identical inputs produce identical output", () => {
  const a = JSON.stringify(agent.decide(driftedInput()));
  const b = JSON.stringify(agent.decide(driftedInput()));
  assert.strictEqual(a, b);
});

check("Permissions render in plain language for the UI", () => {
  const text = agent.describePermissions(perm());
  assert.ok(/propose/i.test(text));
  assert.ok(/approval/i.test(text));
  assert.ok(/cannot execute/i.test(text));
  assert.ok(/\$50/.test(text) && /\$200/.test(text));
  const revoked = agent.describePermissions(perm({ revoked: true }));
  assert.ok(/revoked/i.test(revoked));
});

console.log(`\n${passed} Phase 6 checks passed${process.exitCode ? " (with failures)" : ""}.`);
