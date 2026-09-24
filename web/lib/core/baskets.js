// Basket catalogue — the strategy templates StockWeave offers.
// Server-side source of truth. Every constituent symbol MUST exist in the
// approved asset registry, and every basket MUST satisfy the same guardrails
// the rules engine enforces (max single-asset weight, minimum cash reserve,
// weights summing to 100%). Fixture holdings are sized so the demo starts on
// target; prices come from the FIXTURE map in price-provider.
const { RULES } = require("./rules");
const { listApprovedAssets } = require("./asset-registry");

const BASKETS = [
  {
    id: "ai-infrastructure",
    name: "AI Infrastructure",
    theme: "Frontier AI: model labs and robotics",
    description:
      "The companies building modern AI — the leading model labs plus embodied-AI robotics — held at equal weight with a 10% cash buffer, and flagged for a tune-up whenever one position runs ahead.",
    constituents: [
      { symbol: "OPENAI", targetBps: 3000, holdingsUnits: 3 },
      { symbol: "ANTHROPIC", targetBps: 3000, holdingsUnits: 6 },
      { symbol: "FIGUREAI", targetBps: 3000, holdingsUnits: 12 },
      { symbol: "USDC", targetBps: 1000, holdingsUnits: 100 },
    ],
  },
  {
    id: "space-deep-tech",
    name: "Space & Deep-Tech",
    theme: "Hard tech: space, defense, neurotech",
    description:
      "The hard-tech frontier — orbital launch, autonomous defense, and neural interfaces — led by SpaceX and held with a 20% cash buffer for a higher-variance mix.",
    constituents: [
      { symbol: "SPACEX", targetBps: 3500, holdingsUnits: 7 },
      { symbol: "ANDURIL", targetBps: 2500, holdingsUnits: 10 },
      { symbol: "NEURALINK", targetBps: 2000, holdingsUnits: 10 },
      { symbol: "USDC", targetBps: 2000, holdingsUnits: 200 },
    ],
  },
];

// Validate every basket against the registry and the guardrails at load time,
// so a malformed catalogue fails fast instead of producing a bad demo.
(function validateCatalogue() {
  const approved = new Set(listApprovedAssets().map((a) => a.symbol));
  const seenIds = new Set();
  for (const b of BASKETS) {
    if (seenIds.has(b.id)) throw new Error(`DUPLICATE_BASKET_ID: ${b.id}`);
    seenIds.add(b.id);
    let sumBps = 0;
    let usdcBps = 0;
    for (const c of b.constituents) {
      if (!approved.has(c.symbol)) throw new Error(`BASKET_UNAPPROVED_ASSET: ${b.id}/${c.symbol}`);
      if (c.targetBps > RULES.maxSingleAssetWeightBps) {
        throw new Error(`BASKET_OVERWEIGHT: ${b.id}/${c.symbol} ${c.targetBps} > ${RULES.maxSingleAssetWeightBps}`);
      }
      sumBps += c.targetBps;
      if (c.symbol === "USDC") usdcBps += c.targetBps;
    }
    if (sumBps !== 10000) throw new Error(`BASKET_WEIGHTS_NOT_100: ${b.id} sum=${sumBps}`);
    if (usdcBps < RULES.minUsdcReserveBps) {
      throw new Error(`BASKET_RESERVE_TOO_LOW: ${b.id} usdc=${usdcBps} < ${RULES.minUsdcReserveBps}`);
    }
  }
})();

function listBaskets() {
  return BASKETS.map((b) => ({ ...b, constituents: b.constituents.map((c) => ({ ...c })) }));
}

function getBasket(id) {
  const b = BASKETS.find((x) => x.id === id);
  if (!b) {
    const err = new Error(`UNKNOWN_BASKET: ${id}`);
    err.code = "UNKNOWN_BASKET";
    throw err;
  }
  return { ...b, constituents: b.constituents.map((c) => ({ ...c })) };
}

// Engine-shaped maps for a basket, so classifyStrategyState / valuator can be
// driven per-basket instead of from the single global default.
function targetWeightsBps(id) {
  return getBasket(id).constituents.reduce((m, c) => ((m[c.symbol] = c.targetBps), m), {});
}

function holdingsUnits(id) {
  return getBasket(id).constituents.reduce((m, c) => ((m[c.symbol] = c.holdingsUnits), m), {});
}

module.exports = { BASKETS, listBaskets, getBasket, targetWeightsBps, holdingsUnits };
