// Phase 2 data-adapter server — zero dependencies.
// Serves static pages from public/ plus JSON adapter endpoints:
//   GET /api/assets, GET /api/strategy[?demo=fresh|stale|invalid-feed|missing]
const http = require("http");
const fs = require("fs");
const path = require("path");
const { listApprovedAssets } = require("./lib/asset-registry");
const { getTokenPriceBySymbol, getReferencePrice } = require("./lib/price-provider");
const { DEMO_FEED_ID } = require("./lib/pyth");
const agent = require("./lib/agent");
const {
  TARGET_WEIGHTS_BPS,
  HOLDINGS_UNITS,
  calculateCurrentWeights,
  calculateMarkNAV,
  calculateReferenceNAV,
  calculateDislocation,
  calculateWeightDrift,
  classifyStrategyState,
} = require("./lib/rules");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function sendJson(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

// Builds the strategy snapshot via the deterministic rules engine. `demo`
// selects a labelled simulation: fresh (default) | stale (45s-old Pyth update)
// | invalid-feed | missing | drift (OPENAI run-up) | paused.
function buildStrategySnapshot(demo) {
  const now = Date.now();
  const priceOverride = demo === "drift" ? { OPENAI: 140.0 } : {};
  const symbols = ["OPENAI", "ANTHROPIC", "XAI", "USDC"];
  const tokenPrices = symbols.map((s) =>
    getTokenPriceBySymbol(s, { nowMs: now, priceOverride: priceOverride[s] ?? null })
  );
  let reference;
  let demoMode = null;
  let paused = false;
  if (demo === "stale") {
    reference = getReferencePrice(DEMO_FEED_ID, {
      nowMs: now,
      publishTimeMs: now - 45000,
    });
    demoMode = "DEMO_SIMULATION";
  } else if (demo === "invalid-feed") {
    reference = getReferencePrice("NOT_A_FEED", { nowMs: now });
    demoMode = "DEMO_SIMULATION";
  } else if (demo === "drift" || demo === "paused") {
    reference = getReferencePrice(null, { nowMs: now });
    demoMode = "DEMO_SIMULATION";
    paused = demo === "paused";
  } else {
    reference = getReferencePrice(null, { nowMs: now });
  }
  const pricesBySymbol = {};
  const valuesBySymbol = {};
  for (const t of tokenPrices) {
    pricesBySymbol[t.symbol] = t.price;
    valuesBySymbol[t.symbol] = t.price * HOLDINGS_UNITS[t.symbol];
  }
  const markNAV = calculateMarkNAV(pricesBySymbol, HOLDINGS_UNITS);
  const referenceNAV = calculateReferenceNAV();
  const currentWeights = calculateCurrentWeights(valuesBySymbol, markNAV);
  const classification = classifyStrategyState({
    currentWeightsBps: currentWeights,
    targetWeightsBps: TARGET_WEIGHTS_BPS,
    tokenPrices,
    reference,
    paused,
    markNAV,
    referenceNAV,
  });
  const drift = calculateWeightDrift(currentWeights, TARGET_WEIGHTS_BPS);
  const valuation = {
    markNAV,
    referenceNAV,
    premiumDiscount: calculateDislocation(markNAV, referenceNAV),
    dataFreshness: classification.dataQuality === "REFERENCE_UNKNOWN" ? "REFERENCE_UNKNOWN" : classification.dataQuality,
    dataConfidence: "FIXTURE",
    state: classification.state,
    reasonCodes: classification.reasonCodes,
    currentWeights,
    targetWeights: TARGET_WEIGHTS_BPS,
    maxDriftBps: drift.maxDriftBps,
    proposalAllowed: classification.proposalAllowed,
    executionAllowed: false,
    requiresApproval: true,
  };
  return {
    dataMode: "FIXTURE",
    demoMode,
    tokenPrices,
    reference,
    valuation,
  };
}

// Phase 6 — run the constrained Clawpump agent over the current snapshot.
// `revoked=1` demonstrates that revocation immediately blocks proposals.
function buildAgentDecision(demo, revoked) {
  const snap = buildStrategySnapshot(demo);
  const v = snap.valuation;
  const permission = {
    agentId: "clawpump-demo-1",
    allowedActions: 0b011, // READ + PROPOSE; EXECUTE opt-in only (D-601)
    maxNotionalPerAction: 50,
    maxDailyNotional: 200,
    expiry: Math.floor(Date.now() / 1000) + 86400,
    revoked: Boolean(revoked),
  };
  const decision = agent.decide({
    strategyState: v.state,
    reasonCodes: v.reasonCodes,
    currentWeightsBps: v.currentWeights,
    targetWeightsBps: v.targetWeights,
    dataQuality: v.dataFreshness,
    proposalAllowed: v.proposalAllowed,
    navUsd: v.markNAV,
    rules: { maxTradeNotional: 50, maxDailyNotional: 200 },
    permissions: permission,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return {
    dataMode: "FIXTURE",
    demoMode: snap.demoMode,
    agentId: permission.agentId,
    permission,
    // The underlying numbers travel WITH the agent prose — the explanation is
    // never the evidence (see architecture §4).
    inputs: {
      state: v.state,
      reasonCodes: v.reasonCodes,
      currentWeights: v.currentWeights,
      targetWeights: v.targetWeights,
      dataFreshness: v.dataFreshness,
      markNAV: v.markNAV,
    },
    decision,
  };
}

const server = http.createServer((req, res) => {
  const [urlPath, queryString] = req.url.split("?");
  const query = new URLSearchParams(queryString || "");
  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", service: "stockweave", phase: 6 }));
    return;
  }
  if (urlPath === "/api/assets") {
    sendJson(res, { dataMode: "FIXTURE", assets: listApprovedAssets() });
    return;
  }
  if (urlPath === "/api/strategy") {
    sendJson(res, buildStrategySnapshot(query.get("demo") || "fresh"));
    return;
  }
  if (urlPath === "/api/agent") {
    sendJson(res, buildAgentDecision(query.get("demo") || "fresh", query.get("revoked")));
    return;
  }
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  let filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  try {
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch (e) {
    if (!/\.[a-z0-9]+$/i.test(filePath)) {
      filePath = filePath + ".html";
    }
  }
  serveFile(res, filePath);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`StockWeave Phase 6 listening on http://localhost:${PORT}`);
  });
}

module.exports = server;
