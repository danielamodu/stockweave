// Phase 0 health check — verifies baseline files exist. No Solana tooling required.
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const required = [
  "README.md",
  "package.json",
  "server.js",
  "public/index.html",
  "docs/product-contract.md",
  "docs/decision-log.md",
  "tests/run.js",
];

const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));

const result = {
  status: missing.length === 0 ? "ok" : "fail",
  service: "stockweave",
  phase: 0,
  missing,
  timestamp: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
