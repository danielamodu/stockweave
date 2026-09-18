// Phase 2 acceptance tests — zero dependencies, deterministic.
// Verifies: server-side allowlist, snapshot fields, feed validation, timestamp-based
// age, fresh/stale/invalid/missing handling, UI token/reference separation,
// and the gate: Pyth quality changes state/valuation behavior.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { listApprovedAssets, getAsset } = require("../lib/asset-registry");
const { isValidFeedId, assessPriceQuality, DEMO_FEED_ID } = require("../lib/pyth");
const { getTokenPrice, getReferencePrice } = require("../lib/price-provider");
const { calculate } = require("../lib/valuator");

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
const SNAPSHOT_FIELDS = ["source", "price", "confidence", "publishTimeMs", "receivedTimeMs", "ageSeconds", "validity"];

check("Allowlist is server-side with approved assets only", () => {
  const assets = listApprovedAssets();
  assert.strictEqual(assets.length, 4);
  const symbols = assets.map((a) => a.symbol).sort();
  assert.deepStrictEqual(symbols, ["ANTHROPIC", "OPENAI", "USDC", "XAI"]);
  assert.ok(assets.every((a) => a.allowed === true));
  assert.ok(assets.every((a) => a.issuer === "PreStocks" || a.issuer === "Centre"));
  const libSrc = fs.readFileSync(path.join(ROOT, "lib/asset-registry.js"), "utf8");
  assert.ok(!/tessera/i.test(libSrc), "non-PreStocks asset in allowlist");
});

check("getAsset resolves approved mints and rejects arbitrary mints", () => {
  const asset = getAsset("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF");
  assert.strictEqual(asset.symbol, "OPENAI");
  assert.throws(() => getAsset("So11111111111111111111111111111111111111112"), /UNAPPROVED_MINT/);
});

check("Every price snapshot carries source, id, price, confidence, timestamps, age, validity", () => {
  const snap = getTokenPrice("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", { nowMs: NOW });
  for (const f of [...SNAPSHOT_FIELDS, "mint"]) assert.ok(snap[f] !== undefined, `missing field: ${f}`);
  assert.strictEqual(snap.source, "FIXTURE");
  const ref = getReferencePrice(null, { nowMs: NOW });
  for (const f of [...SNAPSHOT_FIELDS, "feedId"]) assert.ok(ref[f] !== undefined, `missing field: ${f}`);
});

check("Pyth feed ID is validated", () => {
  assert.ok(isValidFeedId(DEMO_FEED_ID));
  assert.ok(isValidFeedId("a".repeat(64)));
  assert.ok(!isValidFeedId("NOT_A_FEED"));
  assert.ok(!isValidFeedId(null));
  assert.ok(!isValidFeedId("0x1234"));
});

check("Pyth age is calculated from timestamps", () => {
  const fresh = assessPriceQuality({ feedId: DEMO_FEED_ID, publishTimeMs: NOW - 4000, receivedTimeMs: NOW });
  assert.strictEqual(fresh.validity, "FRESH");
  assert.strictEqual(fresh.ageSeconds, 4);
  const stale = assessPriceQuality({ feedId: DEMO_FEED_ID, publishTimeMs: NOW - 45000, receivedTimeMs: NOW });
  assert.strictEqual(stale.validity, "STALE_DATA");
  assert.strictEqual(stale.ageSeconds, 45);
});

check("Stale data produces STALE_DATA; wrong feed rejected; missing reference is UNKNOWN", () => {
  assert.strictEqual(getReferencePrice(DEMO_FEED_ID, { nowMs: NOW, publishTimeMs: NOW - 45000 }).validity, "STALE_DATA");
  assert.strictEqual(getReferencePrice("NOT_A_FEED", { nowMs: NOW }).validity, "INVALID_FEED");
  const missing = getReferencePrice(null, { nowMs: NOW });
  assert.strictEqual(missing.validity, "UNKNOWN");
  assert.strictEqual(missing.price, null);
});

check("Valuator computes Mark NAV and UNKNOWN reference without fabrication", () => {
  const tokenPrices = [
    getTokenPrice("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", { nowMs: NOW }),
    getTokenPrice("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", { nowMs: NOW }),
  ];
  const v = calculate({ tokenPrices, reference: getReferencePrice(null, { nowMs: NOW }) });
  assert.strictEqual(v.markNAV, 3 * 100.0 + 6 * 50.0);
  assert.strictEqual(v.referenceNAV, null);
  assert.strictEqual(v.premiumDiscount, "UNKNOWN");
});

check("Gate: Pyth quality changes state and proposal eligibility", () => {
  const tokenPrices = [getTokenPrice("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", { nowMs: NOW })];
  const fresh = calculate({ tokenPrices, reference: getReferencePrice(null, { nowMs: NOW }) });
  assert.strictEqual(fresh.state, "NORMAL");
  assert.strictEqual(fresh.proposalAllowed, true);
  const stale = calculate({
    tokenPrices,
    reference: getReferencePrice(DEMO_FEED_ID, { nowMs: NOW, publishTimeMs: NOW - 45000 }),
  });
  assert.strictEqual(stale.state, "STALE_DATA");
  assert.strictEqual(stale.proposalAllowed, false);
  const invalid = calculate({ tokenPrices, reference: getReferencePrice("NOT_A_FEED", { nowMs: NOW }) });
  assert.strictEqual(invalid.state, "STALE_DATA");
  assert.strictEqual(invalid.proposalAllowed, false);
});

check("UI shows token price and reference price separately with source metadata", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/strategy/ai-infrastructure/index.html"), "utf8");
  assert.ok(/id="token-prices"/.test(html), "token price section missing");
  assert.ok(/id="reference-prices"/.test(html), "reference price section missing");
  assert.ok(/\/api\/strategy/.test(html), "page does not consume the adapter API");
  assert.ok(/DEMO_SIMULATION/.test(html), "demo simulation label missing");
});

console.log(`\n${passed} Phase 2 checks passed${process.exitCode ? " (with failures)" : ""}.`);
