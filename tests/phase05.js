// Phase 5 local tests — run by `npm test`. These test the OFF-CHAIN MIRROR
// (lib/onchain-mirror.js) of the rebalance lifecycle, NOT the Solana cluster.
// On-chain build/test/deploy + transaction signatures happen in Solana
// Playground; see docs/solana-playground-phase05.md. The mirror replicates the
// program guards 1:1, so a failure here means a design failure — but PASS here
// is NOT on-chain evidence.
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
const AGENT = "clawpump-agent-1";
const MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const REFERENCE_FEED = "0x1111111111111111111111111111111111111111111111111111111111111111";
const WRONG_FEED = "0x2222222222222222222222222222222222222222222222222222222222222222";
const NOW = 1_000_000; // deterministic base timestamp

function setup({ allowedActions = 0b011, expiry = NOW + 1_000_000 } = {}) {
  const w = new MirrorWorld();
  const strategy = w.initializeStrategy(CREATOR, "ai-infrastructure");
  w.setAssets(strategy, CREATOR, MINT, 3000, 3500);
  w.setRules(strategy, CREATOR, {
    reserveWeightBps: 1000,
    rebalanceDriftBps: 500,
    maxSingleAssetWeightBps: 3500,
    maxTradeNotional: 50,
    maxDailyNotional: 200,
    maxPriceAgeSeconds: 30,
    referenceFeedId: REFERENCE_FEED,
  });
  w.setAgentPermission(strategy, CREATOR, AGENT, {
    allowedActions, maxNotionalPerAction: 50, maxDailyNotional: 200, expiry,
  });
  return { w, strategy };
}

// A compliant proposal (Scenario B baseline): 34.8% weight, 10.5% reserve,
// $42 notional, fresh oracle on the correct feed.
function validArgs(overrides = {}) {
  return {
    proposalId: 1,
    mint: MINT,
    newTargetWeightBps: 3480,
    projectedReserveBps: 1050,
    notional: 42,
    reasonCode: 1,
    oracleFeedId: REFERENCE_FEED,
    oraclePrice: 100,
    oraclePublishTime: NOW, // age 0
    approvalNonce: 7,
    expiresAt: NOW + 300,
    ...overrides,
  };
}

// --- Scenario B: valid proposal → approval → simulated execution ---
check("Scenario B: valid proposal accepted, needs approval, then executes", () => {
  const { w, strategy } = setup();
  const addr = w.proposeRebalance(strategy, AGENT, validArgs(), NOW);
  assert.strictEqual(w.proposals.get(addr).status, "PROPOSED");
  // Cannot execute before approval.
  assert.throws(() => w.executeRebalance(strategy, CREATOR, 1, NOW + 1), /BadProposalState/);
  // Approve with the exact nonce.
  w.approveRebalance(strategy, CREATOR, 1, 7, NOW + 1);
  assert.strictEqual(w.proposals.get(addr).status, "APPROVED");
  // Execute (simulate).
  w.executeRebalance(strategy, CREATOR, 1, NOW + 2);
  assert.strictEqual(w.proposals.get(addr).status, "EXECUTED");
  const names = w.events.map((e) => e.event);
  for (const ev of ["RebalanceProposed", "RebalanceApproved", "RebalanceExecuted"]) {
    assert.ok(names.includes(ev), `missing event: ${ev}`);
  }
});

// --- Scenario A: invalid weight rejected on propose ---
check("Scenario A: weight above 35% is rejected (MaxWeightExceeded)", () => {
  const { w, strategy } = setup();
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ newTargetWeightBps: 4120 }), NOW),
    /MaxWeightExceeded/
  );
  // 35.00% exactly is allowed; 35.01% is not.
  assert.ok(w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 2, newTargetWeightBps: 3500 }), NOW));
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 3, newTargetWeightBps: 3501 }), NOW),
    /MaxWeightExceeded/
  );
});

// --- Scenario C: stale oracle rejected on propose ---
check("Scenario C: stale oracle is rejected (StaleOracle)", () => {
  const { w, strategy } = setup();
  // age 45s > 30s
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ oraclePublishTime: NOW - 45 }), NOW),
    /StaleOracle/
  );
  // Boundary: exactly 30s is fresh; 31s is stale.
  assert.ok(w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 2, oraclePublishTime: NOW - 30 }), NOW));
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 3, oraclePublishTime: NOW - 31 }), NOW),
    /StaleOracle/
  );
});

check("Wrong oracle feed id is rejected (WrongFeed)", () => {
  const { w, strategy } = setup();
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ oracleFeedId: WRONG_FEED }), NOW),
    /WrongFeed/
  );
});

check("Reserve below 10% is rejected (ReserveBreach)", () => {
  const { w, strategy } = setup();
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ projectedReserveBps: 999 }), NOW),
    /ReserveBreach/
  );
  // 10.00% exactly is allowed.
  assert.ok(w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 2, projectedReserveBps: 1000 }), NOW));
});

check("Notional above the per-action limit is rejected (ExcessiveNotional)", () => {
  const { w, strategy } = setup();
  assert.throws(
    () => w.proposeRebalance(strategy, AGENT, validArgs({ notional: 51 }), NOW),
    /ExcessiveNotional/
  );
  // $50 exactly is allowed.
  assert.ok(w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 2, notional: 50 }), NOW));
});

check("Revoked agent cannot propose (PermissionRevoked)", () => {
  const { w, strategy } = setup();
  w.revokeAgent(strategy, CREATOR, AGENT);
  assert.throws(() => w.proposeRebalance(strategy, AGENT, validArgs(), NOW), /PermissionRevoked/);
});

check("Expired permission cannot propose (PermissionExpired)", () => {
  const { w, strategy } = setup({ expiry: NOW - 1 });
  assert.throws(() => w.proposeRebalance(strategy, AGENT, validArgs(), NOW), /PermissionExpired/);
});

check("Agent without PROPOSE grant is rejected (ProposeNotAllowed)", () => {
  const { w, strategy } = setup({ allowedActions: 0b001 }); // READ only
  assert.throws(() => w.proposeRebalance(strategy, AGENT, validArgs(), NOW), /ProposeNotAllowed/);
});

check("Paused strategy rejects proposals (StrategyPaused)", () => {
  const { w, strategy } = setup();
  w.pauseStrategy(strategy, CREATOR);
  assert.throws(() => w.proposeRebalance(strategy, AGENT, validArgs(), NOW), /StrategyPaused/);
});

check("Approval requires the exact nonce (BadApprovalNonce)", () => {
  const { w, strategy } = setup();
  w.proposeRebalance(strategy, AGENT, validArgs(), NOW);
  assert.throws(() => w.approveRebalance(strategy, CREATOR, 1, 8, NOW + 1), /BadApprovalNonce/);
  // Correct nonce works.
  assert.ok(w.approveRebalance(strategy, CREATOR, 1, 7, NOW + 1));
});

check("Only the creator can approve (Unauthorized)", () => {
  const { w, strategy } = setup();
  w.proposeRebalance(strategy, AGENT, validArgs(), NOW);
  assert.throws(() => w.approveRebalance(strategy, "attacker-X", 1, 7, NOW + 1), /Unauthorized/);
});

check("Expired proposal cannot be approved (ProposalExpired)", () => {
  const { w, strategy } = setup();
  w.proposeRebalance(strategy, AGENT, validArgs({ expiresAt: NOW + 100 }), NOW);
  assert.throws(() => w.approveRebalance(strategy, CREATOR, 1, 7, NOW + 200), /ProposalExpired/);
});

check("Approval is tied to the exact proposal PDA seeds", () => {
  const { w, strategy } = setup();
  const addr = w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 42 }), NOW);
  assert.strictEqual(addr, simAddress("proposal", strategy, 42));
  // A different proposal id derives a different address.
  const addr2 = w.proposeRebalance(strategy, AGENT, validArgs({ proposalId: 43 }), NOW);
  assert.notStrictEqual(addr, addr2);
});

check("Program source ships Phase 5 lifecycle instructions, events, and errors", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "programs/stockweave/src/lib.rs"), "utf8");
  for (const ix of ["propose_rebalance", "approve_rebalance", "execute_rebalance"]) {
    assert.ok(src.includes(`pub fn ${ix}`), `missing instruction: ${ix}`);
  }
  for (const ev of ["RebalanceProposed", "RebalanceApproved", "RebalanceExecuted"]) {
    assert.ok(src.includes(ev), `missing event: ${ev}`);
  }
  for (const err of [
    "MaxWeightExceeded", "ReserveBreach", "StaleOracle", "WrongFeed",
    "ExcessiveNotional", "PermissionRevoked", "PermissionExpired",
    "ProposeNotAllowed", "ProposalExpired", "BadApprovalNonce", "BadProposalState",
  ]) {
    assert.ok(src.includes(err), `missing error: ${err}`);
  }
  assert.ok(src.includes('b"proposal"'), "missing proposal PDA seed");
});

console.log(`\n${passed} Phase 5 checks passed${process.exitCode ? " (with failures)" : ""}.`);
