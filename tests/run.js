// Phase 0 acceptance tests — zero dependencies, deterministic.
// Verifies: README promise, Tessera exclusion, run command, contract constants, placeholder page.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
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

const PROMISE = "StockWeave lets crypto-native users inspect, simulate, fork, and follow a tokenized-stock strategy without trusting an opaque portfolio manager.";

check("README contains one-sentence product promise", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes(PROMISE), "promise missing from README.md");
});

check("Scope excludes Tessera and non-PreStocks pre-IPO assets", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const contract = fs.readFileSync(path.join(ROOT, "docs/product-contract.md"), "utf8");
  for (const doc of [readme, contract]) {
    assert.ok(/tessera/i.test(doc), "Tessera exclusion not mentioned");
    assert.ok(/non-PreStocks/i.test(doc), "non-PreStocks exclusion not mentioned");
  }
});

check("Repository has documented run command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.scripts && pkg.scripts.start, "scripts.start missing");
  assert.ok(pkg.scripts.health, "scripts.health missing");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("npm start") || readme.includes("npm run"), "run command not documented in README");
});

check("Product contract freezes MVP constants", () => {
  const contract = fs.readFileSync(path.join(ROOT, "docs/product-contract.md"), "utf8");
  for (const token of ["35%", "10%", "5 percentage points", "30 seconds", "AI Infrastructure Basket", "observe + propose"]) {
    assert.ok(contract.includes(token), `contract missing: ${token}`);
  }
});

check("Placeholder page loads (exists + contains promise + exclusion)", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  assert.ok(html.includes(PROMISE), "promise missing from placeholder page");
  assert.ok(/tessera/i.test(html), "exclusion missing from placeholder page");
  assert.ok(/BASELINE_PLACEHOLDER/.test(html), "baseline label missing from placeholder page");
});

check("Health-check file set exists", () => {
  for (const f of ["README.md", "docs/product-contract.md", "docs/decision-log.md", "public/index.html", "server.js", "health-check.js"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `missing: ${f}`);
  }
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}.`);
