// Phase 4 local tests — run by `npm test`. These test the OFF-CHAIN MIRROR
// (lib/onchain-mirror.js), NOT the Solana cluster. On-chain build/test/deploy
// happens in Solana Playground; see docs/solana-playground-phase04.md.
// The mirror replicates instruction logic + guards 1:1 so failures here mean
// failures in the program design, but PASS here is not on-chain evidence.
const assert = require("assert");
const { MirrorWorld, simAddress } = require("../lib/onchain-mirror");

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

const CREATOR = "creator-wallet-A";
const ATTACKER = "attacker-wallet-X";
const AGENT = "clawpump-agent-1";
const MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";

function setup() {
  const w = new MirrorWorld();
  const strategy = w.initializeStrategy(CREATOR, "ai-infrastructure");
  return { w, strategy };
}

check("Mirror: seeds are deterministic", () => {
  const a = setup();
  const b = setup();
  assert.strictEqual(a.strategy, b.strategy);
  const assetA = a.w.setAssets(a.strategy, CREATOR, MINT, 3000, 3500);
  const assetB = b.w.setAssets(b.strategy, CREATOR, MINT, 3000, 3500);
  assert.strictEqual(assetA, assetB);
  assert.ok(a.strategy.startsWith("SIMULATED_"), "must be labelled simulated");
});

check("Mirror: unauthorized wallet cannot modify the strategy", () => {
  const { w, strategy } = setup();
  assert.throws(() => w.pauseStrategy(strategy, ATTACKER), /Unauthorized/);
  assert.throws(() => w.setAssets(strategy, ATTACKER, MINT, 3000, 3500), /Unauthorized/);
  assert.throws(() => w.setRules(strategy, ATTACKER, {
    reserveWeightBps: 1000, rebalanceDriftBps: 500, maxSingleAssetWeightBps: 3500,
    maxTradeNotional: 50, maxDailyNotional: 200, maxPriceAgeSeconds: 30,
  }), /Unauthorized/);
  assert.throws(() => w.revokeAgent(strategy, ATTACKER, AGENT), /Unauthorized/);
  assert.strictEqual(w.strategies.get(strategy).status, "ACTIVE");
});

check("Mirror: lifecycle emits all five events", () => {
  const { w, strategy } = setup();
  w.setAssets(strategy, CREATOR, MINT, 3000, 3500);
  w.setRules(strategy, CREATOR, {
    reserveWeightBps: 1000, rebalanceDriftBps: 500, maxSingleAssetWeightBps: 3500,
    maxTradeNotional: 50, maxDailyNotional: 200, maxPriceAgeSeconds: 30,
  });
  w.setAgentPermission(strategy, CREATOR, AGENT, {
    allowedActions: 0b011, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 9999999999,
  });
  w.pauseStrategy(strategy, CREATOR);
  const names = w.events.map((e) => e.event);
  for (const ev of ["StrategyCreated", "RulesUpdated", "PermissionSet", "StrategyPaused"]) {
    assert.ok(names.includes(ev), `missing event: ${ev}`);
  }
});

check("Mirror: paused strategy rejects protected actions", () => {
  const { w, strategy } = setup();
  w.pauseStrategy(strategy, CREATOR);
  assert.throws(() => w.setAssets(strategy, CREATOR, MINT, 3000, 3500), /StrategyPaused/);
  assert.throws(() => w.setRules(strategy, CREATOR, {
    reserveWeightBps: 1000, rebalanceDriftBps: 500, maxSingleAssetWeightBps: 3500,
    maxTradeNotional: 50, maxDailyNotional: 200, maxPriceAgeSeconds: 30,
  }), /StrategyPaused/);
  assert.throws(() => w.assertAgentCanPropose(strategy, AGENT, 1000), /StrategyPaused/);
});

check("Mirror: revoked agent loses authority", () => {
  const { w, strategy } = setup();
  w.setAgentPermission(strategy, CREATOR, AGENT, {
    allowedActions: 0b011, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 9999999999,
  });
  assert.ok(w.assertAgentCanPropose(strategy, AGENT, 1000));
  w.revokeAgent(strategy, CREATOR, AGENT);
  assert.throws(() => w.assertAgentCanPropose(strategy, AGENT, 1000), /Unauthorized/);
  assert.ok(w.events.map((e) => e.event).includes("AgentRevoked"));
});

check("Mirror: expired permission rejected; bad action bits rejected", () => {
  const { w, strategy } = setup();
  w.setAgentPermission(strategy, CREATOR, AGENT, {
    allowedActions: 0b011, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 500,
  });
  assert.throws(() => w.assertAgentCanPropose(strategy, AGENT, 1000), /PermissionExpired/);
  assert.throws(() => w.setAgentPermission(strategy, CREATOR, "agent-2", {
    allowedActions: 0b1000, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 9999999999,
  }), /BadPermission/);
});

check("Program source ships all six instructions + five events + PDA seeds", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "programs/stockweave/src/lib.rs"), "utf8");
  for (const ix of ["initialize_strategy", "set_assets", "set_rules", "set_agent_permission", "pause_strategy", "revoke_agent"]) {
    assert.ok(src.includes(`pub fn ${ix}`), `missing instruction: ${ix}`);
  }
  for (const ev of ["StrategyCreated", "RulesUpdated", "PermissionSet", "StrategyPaused", "AgentRevoked"]) {
    assert.ok(src.includes(ev), `missing event: ${ev}`);
  }
  for (const seed of ['b"strategy"', 'b"rules"', 'b"asset"', 'b"permission"']) {
    assert.ok(src.includes(seed), `missing seed: ${seed}`);
  }
  assert.ok(src.includes("declare_id!"), "declare_id missing");
});

console.log(`\n${passed} Phase 4 checks passed${process.exitCode ? " (with failures)" : ""}.`);
