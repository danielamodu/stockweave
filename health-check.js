// Phase 4 health check — verifies baseline files exist. No Solana tooling required.
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
  "tests/phase01.js",
  "tests/phase02.js",
  "tests/phase03.js",
  "tests/phase04.js",
  "programs/stockweave/src/lib.rs",
  "programs/stockweave/Cargo.toml",
  "Cargo.toml",
  "Anchor.toml",
  "tests/stockweave.ts",
  "docs/solana-playground-phase04.md",
  "lib/asset-registry.js",
  "lib/pyth.js",
  "lib/onchain-mirror.js",
  "lib/price-provider.js",
  "lib/rules.js",
  "lib/valuator.js",
  "public/strategy/ai-infrastructure/index.html",
];

const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));

const result = {
  status: missing.length === 0 ? "ok" : "fail",
  service: "stockweave",
  phase: 4,
  missing,
  timestamp: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
