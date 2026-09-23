// Basket catalogue tests — the multi-basket offering.
// Verifies: two baskets exist, each satisfies the guardrails, symbols are all
// approved, and each basket's fixture holdings land exactly on target weights
// (NORMAL, proposal-eligible) so the demo starts clean.
const assert = require("assert");
const { listBaskets, getBasket, targetWeightsBps, holdingsUnits } = require("../lib/baskets");
const { listApprovedAssets } = require("../lib/asset-registry");
const { getTokenPriceBySymbol } = require("../lib/price-provider");
const { RULES, calculateCurrentWeights, classifyStrategyState } = require("../lib/rules");

const NOW = 1_700_000_000_000;
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

check("Offers at least two baskets with unique ids", () => {
  const baskets = listBaskets();
  assert.ok(baskets.length >= 2, `expected >= 2 baskets, got ${baskets.length}`);
  const ids = baskets.map((b) => b.id);
  assert.strictEqual(new Set(ids).size, ids.length, "duplicate basket id");
  assert.ok(ids.includes("ai-infrastructure"));
  assert.ok(ids.includes("space-deep-tech"));
});

check("Baskets are distinct offerings (different constituents)", () => {
  const ai = new Set(getBasket("ai-infrastructure").constituents.map((c) => c.symbol));
  const space = new Set(getBasket("space-deep-tech").constituents.map((c) => c.symbol));
  const overlap = [...ai].filter((s) => space.has(s) && s !== "USDC");
  assert.strictEqual(overlap.length, 0, `baskets should not overlap on stocks: ${overlap}`);
});

check("Every basket satisfies the guardrails and uses approved assets only", () => {
  const approved = new Set(listApprovedAssets().map((a) => a.symbol));
  for (const b of listBaskets()) {
    let sum = 0;
    let usdc = 0;
    for (const c of b.constituents) {
      assert.ok(approved.has(c.symbol), `${b.id}: unapproved ${c.symbol}`);
      assert.ok(c.targetBps <= RULES.maxSingleAssetWeightBps, `${b.id}: ${c.symbol} overweight`);
      sum += c.targetBps;
      if (c.symbol === "USDC") usdc += c.targetBps;
    }
    assert.strictEqual(sum, 10000, `${b.id}: weights must total 100%`);
    assert.ok(usdc >= RULES.minUsdcReserveBps, `${b.id}: cash below reserve floor`);
  }
});

check("Unknown basket id is rejected", () => {
  assert.throws(() => getBasket("does-not-exist"), /UNKNOWN_BASKET/);
});

check("Each basket's fixtures land exactly on target and start NORMAL", () => {
  for (const b of listBaskets()) {
    const target = targetWeightsBps(b.id);
    const units = holdingsUnits(b.id);
    const values = {};
    const tokenPrices = [];
    let nav = 0;
    for (const c of b.constituents) {
      const snap = getTokenPriceBySymbol(c.symbol, { nowMs: NOW });
      const value = snap.price * units[c.symbol];
      values[c.symbol] = value;
      nav += value;
      if (c.symbol !== "USDC") tokenPrices.push(snap);
    }
    const current = calculateCurrentWeights(values, nav);
    assert.deepStrictEqual(current, target, `${b.id}: current weights should equal target`);
    const state = classifyStrategyState({
      currentWeightsBps: current,
      targetWeightsBps: target,
      tokenPrices,
      reference: null,
    });
    assert.strictEqual(state.state, "NORMAL", `${b.id}: expected NORMAL, got ${state.state}`);
    assert.strictEqual(state.proposalAllowed, true, `${b.id}: proposals should be allowed`);
  }
});

console.log(`\n${passed} basket checks passed${process.exitCode ? " (with failures)" : ""}.`);
