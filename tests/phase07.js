// Phase 7 local tests — OFF-CHAIN MIRROR of forking (lib/onchain-mirror.js).
// On-chain build/test/deploy happens in Solana Playground; see
// docs/solana-playground-phase07.md. PASS here is design proof, not on-chain
// evidence. Verifies a fork creates INDEPENDENT state + authority: parent link,
// new creator, copied rules, fork owner can change a rule, parent owner cannot.
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

const WALLET_A = "wallet-A-creator";
const WALLET_B = "wallet-B-forker";
const AGENT_A = "agent-A";
const AGENT_B = "agent-B";
const MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const RULES = {
  reserveWeightBps: 1000, rebalanceDriftBps: 500, maxSingleAssetWeightBps: 3500,
  maxTradeNotional: 50, maxDailyNotional: 200, maxPriceAgeSeconds: 30,
  referenceFeedId: "0x1111111111111111111111111111111111111111111111111111111111111111",
};

function setupParent() {
  const w = new MirrorWorld();
  const parent = w.initializeStrategy(WALLET_A, "ai-infrastructure");
  w.setAssets(parent, WALLET_A, MINT, 3000, 3500);
  w.setRules(parent, WALLET_A, RULES);
  w.setAgentPermission(parent, WALLET_A, AGENT_A, {
    allowedActions: 0b011, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 9999999999,
  });
  return { w, parent };
}

check("Wallet B can fork Wallet A's strategy into new independent state", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "ai-infrastructure-fork");
  const f = w.strategies.get(fork);
  assert.strictEqual(f.creator, WALLET_B, "fork creator must be Wallet B");
  assert.strictEqual(f.parentStrategy, parent, "fork must record its parent");
  assert.notStrictEqual(fork, parent, "fork PDA must differ from parent");
  assert.ok(fork.startsWith("SIMULATED_"));
});

check("Parent is an original (no parent link); fork points to parent", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  assert.strictEqual(w.strategies.get(parent).parentStrategy, null);
  assert.strictEqual(w.strategies.get(fork).parentStrategy, parent);
});

check("Fork copies the rule template into its OWN rules account (version 1)", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  const forkRules = w.rules.get(simAddress("rules", fork));
  const parentRules = w.rules.get(simAddress("rules", parent));
  assert.ok(forkRules, "fork must have its own rules account");
  assert.notStrictEqual(forkRules.address, parentRules.address, "independent rules PDA");
  assert.strictEqual(forkRules.strategy, fork);
  assert.strictEqual(forkRules.maxSingleAssetWeightBps, RULES.maxSingleAssetWeightBps);
  assert.strictEqual(forkRules.reserveWeightBps, RULES.reserveWeightBps);
  assert.strictEqual(forkRules.version, 1, "fork rule-set version resets to 1");
});

check("Wallet B can change a rule on its fork", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  // Wallet B tightens the drift threshold on its own fork.
  w.setRules(fork, WALLET_B, { ...RULES, rebalanceDriftBps: 300 });
  const forkRules = w.rules.get(simAddress("rules", fork));
  assert.strictEqual(forkRules.rebalanceDriftBps, 300);
  assert.strictEqual(forkRules.version, 2, "fork rule edit bumps its own version");
  // Parent rules are untouched.
  assert.strictEqual(w.rules.get(simAddress("rules", parent)).rebalanceDriftBps, 500);
});

check("Wallet A cannot control Wallet B's fork", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  assert.throws(() => w.setRules(fork, WALLET_A, { ...RULES, rebalanceDriftBps: 100 }), /Unauthorized/);
  assert.throws(() => w.pauseStrategy(fork, WALLET_A), /Unauthorized/);
  assert.throws(() => w.setAssets(fork, WALLET_A, MINT, 4000, 4500), /Unauthorized/);
});

check("Fork has independent agent authority (B's agent ≠ A's agent)", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  // Wallet B attaches its own agent to the fork.
  w.setAgentPermission(fork, WALLET_B, AGENT_B, {
    allowedActions: 0b011, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry: 9999999999,
  });
  const forkPerm = w.permissions.get(simAddress("permission", fork, AGENT_B));
  assert.ok(forkPerm, "fork must have its own permission account");
  assert.strictEqual(forkPerm.authority, WALLET_B);
  // A's agent permission does not exist on the fork.
  assert.strictEqual(w.permissions.get(simAddress("permission", fork, AGENT_A)), undefined);
});

check("Fork PDA derivation is deterministic; StrategyForked event emitted", () => {
  const { w, parent } = setupParent();
  const fork = w.forkStrategy(parent, WALLET_B, "fork-1");
  assert.strictEqual(fork, simAddress("strategy", WALLET_B, "fork-1"));
  const ev = w.events.find((e) => e.event === "StrategyForked");
  assert.ok(ev && ev.parent === parent && ev.fork === fork && ev.creator === WALLET_B);
});

check("Program source ships fork_strategy + StrategyForked + parent link", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "programs/stockweave/src/lib.rs"), "utf8");
  assert.ok(src.includes("pub fn fork_strategy"), "missing fork_strategy");
  assert.ok(src.includes("StrategyForked"), "missing StrategyForked event");
  assert.ok(src.includes("parent_strategy"), "missing parent link");
});

console.log(`\n${passed} Phase 7 checks passed${process.exitCode ? " (with failures)" : ""}.`);
