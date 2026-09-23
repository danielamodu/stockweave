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
  calculateCurrentWeights,
  calculateMarkNAV,
  calculateReferenceNAV,
  calculateDislocation,
  calculateWeightDrift,
  classifyStrategyState,
} = require("./lib/rules");
const { listBaskets, getBasket, targetWeightsBps, holdingsUnits } = require("./lib/baskets");
const { fetchLivePricesBySymbol } = require("./lib/live-prices");

const DEFAULT_BASKET_ID = "ai-infrastructure";

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

// Client errors (e.g. an unknown basket id) return 400 with the error code,
// not a 500 — the input was bad, not the server.
function sendError(res, err) {
  const status = err && err.code === "UNKNOWN_BASKET" ? 400 : 500;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: err.code || "INTERNAL_ERROR", message: err.message }));
}

// Builds the strategy snapshot via the deterministic rules engine. `demo`
// selects a labelled simulation: fresh (default) | stale (45s-old Pyth update)
// | invalid-feed | missing | drift (OPENAI run-up) | paused.
async function buildStrategySnapshot(demo, basketId = DEFAULT_BASKET_ID) {
  const now = Date.now();
  const basket = getBasket(basketId); // throws UNKNOWN_BASKET for bad ids
  const target = targetWeightsBps(basketId);
  let units = holdingsUnits(basketId);
  const symbols = basket.constituents.map((c) => c.symbol);
  const driftSymbol = symbols.find((s) => s !== "USDC");
  const NOMINAL_NAV = 10000; // a model portfolio worth ~$10k at current prices

  // Prefer LIVE prices from Jupiter (real market data derived from on-chain
  // liquidity). Fall back to FIXTURE if the fetch fails/incompletes, so the
  // demo never hard-breaks on a network hiccup.
  let tokenPrices;
  let priceMode = "LIVE";
  let change24hPct = null;
  try {
    const live = await fetchLivePricesBySymbol(symbols, { nowMs: now });
    if (!symbols.every((s) => live[s])) throw new Error("incomplete live prices");
    tokenPrices = symbols.map((s) => ({ ...live[s] }));
    // Size holdings so the basket sits ON target at live prices, then let the
    // market (or the drift sim) pull it off. Model portfolio, not custody.
    const priceBySym = {};
    tokenPrices.forEach((t) => (priceBySym[t.symbol] = t.price));
    units = {};
    for (const c of basket.constituents) {
      units[c.symbol] = ((c.targetBps / 10000) * NOMINAL_NAV) / priceBySym[c.symbol];
    }
    // Real weighted 24h change of the basket (display only).
    change24hPct = basket.constituents.reduce((sum, c) => {
      const snap = tokenPrices.find((t) => t.symbol === c.symbol);
      const ch = snap && snap.priceChange24h != null ? snap.priceChange24h : 0;
      return sum + (c.targetBps / 10000) * ch;
    }, 0);
    // "drift" sim: bump the first stock's price to push it overweight so the
    // agent has a real reason to propose a tune-up.
    if (demo === "drift" && driftSymbol) {
      const snap = tokenPrices.find((t) => t.symbol === driftSymbol);
      snap.price = Math.round(snap.price * 1.4 * 100) / 100;
      snap.source = "JUPITER+SIM";
    }
  } catch {
    priceMode = "FIXTURE";
    const priceOverride = {};
    if (demo === "drift" && driftSymbol) {
      const base = getTokenPriceBySymbol(driftSymbol, { nowMs: now });
      priceOverride[driftSymbol] = Math.round(base.price * 1.4 * 100) / 100;
    }
    tokenPrices = symbols.map((s) =>
      getTokenPriceBySymbol(s, { nowMs: now, priceOverride: priceOverride[s] ?? null })
    );
  }
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
    valuesBySymbol[t.symbol] = t.price * units[t.symbol];
  }
  const markNAV = calculateMarkNAV(pricesBySymbol, units);
  const referenceNAV = calculateReferenceNAV();
  const currentWeights = calculateCurrentWeights(valuesBySymbol, markNAV);
  const classification = classifyStrategyState({
    currentWeightsBps: currentWeights,
    targetWeightsBps: target,
    tokenPrices,
    reference,
    paused,
    markNAV,
    referenceNAV,
  });
  const drift = calculateWeightDrift(currentWeights, target);
  const valuation = {
    markNAV,
    referenceNAV,
    premiumDiscount: calculateDislocation(markNAV, referenceNAV),
    dataFreshness: classification.dataQuality === "REFERENCE_UNKNOWN" ? "REFERENCE_UNKNOWN" : classification.dataQuality,
    dataConfidence: priceMode,
    change24hPct,
    state: classification.state,
    reasonCodes: classification.reasonCodes,
    currentWeights,
    targetWeights: target,
    maxDriftBps: drift.maxDriftBps,
    proposalAllowed: classification.proposalAllowed,
    executionAllowed: false,
    requiresApproval: true,
  };
  return {
    dataMode: priceMode,
    demoMode,
    basket: { id: basket.id, name: basket.name, theme: basket.theme, description: basket.description },
    tokenPrices,
    reference,
    valuation,
  };
}

// Phase 6 — run the constrained agent over the current snapshot.
// `revoked=1` demonstrates that revocation immediately blocks proposals.
async function buildAgentDecision(demo, revoked, basketId = DEFAULT_BASKET_ID) {
  const snap = await buildStrategySnapshot(demo, basketId);
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
    dataMode: snap.dataMode,
    demoMode: snap.demoMode,
    basket: snap.basket,
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

const server = http.createServer(async (req, res) => {
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
  if (urlPath === "/api/baskets") {
    sendJson(res, { dataMode: "FIXTURE", baskets: listBaskets() });
    return;
  }
  if (urlPath === "/api/strategy") {
    try {
      sendJson(res, await buildStrategySnapshot(query.get("demo") || "fresh", query.get("basket") || DEFAULT_BASKET_ID));
    } catch (e) {
      sendError(res, e);
    }
    return;
  }
  if (urlPath === "/api/agent") {
    try {
      sendJson(res, await buildAgentDecision(query.get("demo") || "fresh", query.get("revoked"), query.get("basket") || DEFAULT_BASKET_ID));
    } catch (e) {
      sendError(res, e);
    }
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
