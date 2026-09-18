// Phase 3 acceptance tests — zero dependencies, deterministic.
// Verifies: identical inputs → identical outputs; no LLM dependency; all ten
// engine functions; weight/price changes drive state; stale blocks proposals;
// max-weight + reserve breaches detected; boundary values (35%, 35.01%, 10%,
// 9.99%, 30s, 30.01s); notional limits; full state-transition coverage.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rules = require("../lib/rules");
const { assessPriceQuality, DEMO_FEED_ID } = require("../lib/pyth");

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

const NOW = 1_700_000_000_000;
const TARGET = { OPENAI: 3000, ANTHROPIC: 3000, XAI: 3000, USDC: 1000 };
function freshTokens() {
  return ["OPENAI", "ANTHROPIC", "XAI", "USDC"].map((s) => ({ symbol: s, validity: "FRESH" }));
}
const unknownRef = { validity: "UNKNOWN" };

check("All ten engine functions exist", () => {
  for (const fn of [
    "calculateCurrentWeights", "calculateWeightDrift", "calculateMarkNAV",
    "calculateReferenceNAV", "calculateDislocation", "validateReserve",
    "validateMaxWeights", "validatePriceQuality", "validateNotionalLimits",
    "classifyStrategyState",
  ]) {
    assert.strictEqual(typeof rules[fn], "function", `missing: ${fn}`);
  }
});

check("Identical inputs produce identical outputs", () => {
  const input = {
    currentWeightsBps: { ...TARGET },
    targetWeightsBps: TARGET,
    tokenPrices: freshTokens(),
    reference: unknownRef,
    markNAV: 1000,
    referenceNAV: null,
  };
  assert.deepStrictEqual(rules.classifyStrategyState(input), rules.classifyStrategyState(input));
});

check("No LLM call is required to calculate a state", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8");
  for (const pat of [
    /fetch\s*\(/, /XMLHttpRequest/, /https\.request/,
    /require\s*\(\s*['"](openai|anthropic|axios|node-fetch)['"]\s*\)/,
    /from\s+['"](openai|anthropic)['"]/, /apiKey/i, /OPENAI_API/,
  ]) {
    assert.ok(!pat.test(src), `LLM/network dependency: ${pat}`);
  }
});

check("Fixture prices land exactly on target weights (NORMAL)", () => {
  const nav = rules.calculateMarkNAV({ OPENAI: 100, ANTHROPIC: 50, XAI: 25, USDC: 1 }, rules.HOLDINGS_UNITS);
  assert.strictEqual(nav, 1000);
  const weights = rules.calculateCurrentWeights({ OPENAI: 300, ANTHROPIC: 300, XAI: 300, USDC: 100 }, 1000);
  assert.deepStrictEqual(weights, TARGET);
  const drift = rules.calculateWeightDrift(weights, TARGET);
  assert.strictEqual(drift.maxDriftBps, 0);
  const s = rules.classifyStrategyState({
    currentWeightsBps: weights, targetWeightsBps: TARGET,
    tokenPrices: freshTokens(), reference: unknownRef, markNAV: 1000, referenceNAV: null,
  });
  assert.strictEqual(s.state, "NORMAL");
  assert.deepStrictEqual(s.reasonCodes, []);
  assert.strictEqual(s.proposalAllowed, true);
});

check("Boundary: exactly 35% passes, 35.01% breaches", () => {
  assert.ok(rules.validateMaxWeights({ OPENAI: 3500, USDC: 1000 }).ok);
  const breach = rules.validateMaxWeights({ OPENAI: 3501, USDC: 1000 });
  assert.strictEqual(breach.ok, false);
  assert.strictEqual(breach.code, "ASSET_OVERWEIGHT");
  assert.deepStrictEqual(breach.breaches, ["OPENAI"]);
});

check("Boundary: exactly 10% reserve passes, 9.99% breaches", () => {
  assert.ok(rules.validateReserve(1000).ok);
  const breach = rules.validateReserve(999);
  assert.strictEqual(breach.ok, false);
  assert.strictEqual(breach.code, "RESERVE_BREACH");
});

check("Boundary: exactly 30s is fresh, 30.01s is stale", () => {
  const exact = assessPriceQuality({ feedId: DEMO_FEED_ID, publishTimeMs: NOW - 30000, receivedTimeMs: NOW });
  assert.strictEqual(exact.validity, "FRESH");
  assert.strictEqual(exact.ageSeconds, 30);
  const over = assessPriceQuality({ feedId: DEMO_FEED_ID, publishTimeMs: NOW - 30010, receivedTimeMs: NOW });
  assert.strictEqual(over.validity, "STALE_DATA");
  assert.strictEqual(over.ageSeconds, 30.01);
});

check("Stale Pyth snapshot blocks proposal eligibility", () => {
  const s = rules.classifyStrategyState({
    currentWeightsBps: { ...TARGET }, targetWeightsBps: TARGET,
    tokenPrices: freshTokens(),
    reference: { validity: "STALE_DATA" }, markNAV: 1000, referenceNAV: null,
  });
  assert.strictEqual(s.state, "STALE_DATA");
  assert.strictEqual(s.proposalAllowed, false);
});

check("Maximum-weight and reserve breaches detected with reason codes", () => {
  const over = rules.classifyStrategyState({
    currentWeightsBps: { OPENAI: 4120, ANTHROPIC: 2380, XAI: 2500, USDC: 1000 },
    targetWeightsBps: TARGET, tokenPrices: freshTokens(), reference: unknownRef,
    markNAV: 1000, referenceNAV: null,
  });
  assert.strictEqual(over.state, "DRIFTED");
  assert.ok(over.reasonCodes.includes("ASSET_OVERWEIGHT"));
  const thin = rules.classifyStrategyState({
    currentWeightsBps: { OPENAI: 3000, ANTHROPIC: 3000, XAI: 3100, USDC: 900 },
    targetWeightsBps: TARGET, tokenPrices: freshTokens(), reference: unknownRef,
    markNAV: 1000, referenceNAV: null,
  });
  assert.strictEqual(thin.state, "DRIFTED");
  assert.ok(thin.reasonCodes.includes("RESERVE_BREACH"));
});

check("Notional limits: $42 and $50 pass, $50.01 and daily overflow fail", () => {
  assert.ok(rules.validateNotionalLimits(42).ok);
  assert.ok(rules.validateNotionalLimits(50).ok);
  assert.strictEqual(rules.validateNotionalLimits(50.01).code, "EXCESSIVE_NOTIONAL");
  assert.strictEqual(rules.validateNotionalLimits(30, 190).code, "DAILY_LIMIT_EXCEEDED");
  assert.ok(rules.validateNotionalLimits(30, 150).ok);
  const s = rules.classifyStrategyState({
    currentWeightsBps: { ...TARGET }, targetWeightsBps: TARGET,
    tokenPrices: freshTokens(), reference: unknownRef, markNAV: 1000, referenceNAV: null,
    proposalNotional: 42,
  });
  assert.strictEqual(s.proposalAllowed, true);
});

check("State transitions: DRIFTED, PAUSED, DISLOCATED, UNKNOWN reference", () => {
  const drifted = rules.classifyStrategyState({
    currentWeightsBps: { OPENAI: 3600, ANTHROPIC: 2700, XAI: 2700, USDC: 1000 },
    targetWeightsBps: TARGET, tokenPrices: freshTokens(), reference: unknownRef,
    markNAV: 1000, referenceNAV: null,
  });
  assert.strictEqual(drifted.state, "DRIFTED");
  const paused = rules.classifyStrategyState({
    currentWeightsBps: { ...TARGET }, targetWeightsBps: TARGET,
    tokenPrices: freshTokens(), reference: unknownRef, paused: true,
  });
  assert.strictEqual(paused.state, "PAUSED");
  assert.strictEqual(paused.proposalAllowed, false);
  const dislocated = rules.classifyStrategyState({
    currentWeightsBps: { ...TARGET }, targetWeightsBps: TARGET,
    tokenPrices: freshTokens(), reference: { validity: "FRESH" },
    markNAV: 1060, referenceNAV: 1000,
  });
  assert.strictEqual(dislocated.state, "DISLOCATED");
  assert.strictEqual(dislocated.proposalAllowed, false);
  assert.strictEqual(rules.calculateReferenceNAV(), null);
  assert.strictEqual(rules.calculateDislocation(1000, null), "UNKNOWN");
  assert.strictEqual(rules.calculateDislocation(1060, 1000), 600);
});

console.log(`\n${passed} Phase 3 checks passed${process.exitCode ? " (with failures)" : ""}.`);
