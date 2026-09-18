// Phase 1 acceptance tests — zero dependencies, deterministic.
// Verifies the public strategy page: fixture label, assets, no-wallet, no equity claims,
// no unsupported assets, responsive, loading/empty/error states, disabled fork.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "public/strategy/ai-infrastructure/index.html");
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

const html = fs.readFileSync(PAGE, "utf8");

check("Route file exists with fixture disclosure", () => {
  assert.ok(fs.existsSync(PAGE), "strategy page missing");
  assert.ok(html.includes("DATA_MODE: FIXTURE"), "DATA_MODE: FIXTURE label missing");
});

check("Page works without wallet connection", () => {
  assert.ok(/no wallet required/i.test(html), "no-wallet statement missing");
  assert.ok(!/wallet-adapter|connectWallet|window\.solana/i.test(html), "page requires a wallet");
});

check("New visitor sees strategy, assets, rules, permissions", () => {
  for (const token of [
    "AI Infrastructure",
    "OpenAI",
    "Anthropic",
    "xAI",
    "USDC",
    "35%",
    "10%",
    "5 percentage points",
    "30 seconds",
    "READ",
    "PROPOSE",
    "EXECUTE",
    "NORMAL",
  ]) {
    assert.ok(html.includes(token), `page missing: ${token}`);
  }
});

check("Page does not claim basket is equity ownership", () => {
  assert.ok(/not equity ownership/i.test(html), "non-equity disclosure missing");
  for (const bad of ["you own shares", "shareholder", "guaranteed profit", "you own OpenAI"]) {
    assert.ok(!html.toLowerCase().includes(bad), `prohibited claim present: ${bad}`);
  }
});

check("No unsupported asset appears", () => {
  assert.ok(/excluded from this submission/i.test(html), "exclusion disclosure missing");
  const withoutDisclosure = html.replace(/<div class="disclosure">[\s\S]*?<\/div>/, "");
  for (const bad of ["Tessera", "xStock", "SpaceX", "SPACEX", "NVDA", "AAPL", "TSLA"]) {
    assert.ok(!withoutDisclosure.includes(bad), `unsupported asset present: ${bad}`);
  }
});

check("Responsive layout (viewport + mobile breakpoint)", () => {
  assert.ok(html.includes('name="viewport"'), "viewport meta missing");
  assert.ok(/@media[^{]*max-width/.test(html), "mobile media query missing");
});

check("Loading, empty, and error states exist", () => {
  for (const token of ["Loading strategy data", "No strategy found", "Could not load strategy data"]) {
    assert.ok(html.includes(token), `state missing: ${token}`);
  }
});

check("Fork button present in placeholder/disabled state", () => {
  assert.ok(/fork strategy/i.test(html), "fork button missing");
  assert.ok(/disabled/.test(html), "fork button is not disabled/placeholder");
});

check("Server routes strategy path to page", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.ok(/isDirectory/.test(server), "directory → index.html fallback missing in server.js");
});

console.log(`\n${passed} Phase 1 checks passed${process.exitCode ? " (with failures)" : ""}.`);
