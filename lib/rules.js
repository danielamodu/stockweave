// Phase 3 — Deterministic rules engine and state machine.
// Pure functions only: no network, no LLM, no clocks inside the math.
// Identical inputs always produce identical outputs. All weights in basis
// points (10,000 = 100%). Demo rules frozen from the product contract.
const { MAX_AGE_SECONDS } = require("./pyth");

const RULES = {
  maxSingleAssetWeightBps: 3500, // 35%
  minUsdcReserveBps: 1000, // 10%
  rebalanceDriftBps: 500, // 5 percentage points
  maxActionNotional: 50, // $50 demo notional
  maxDailyNotional: 200, // $200 demo notional
  maxPriceAgeSeconds: MAX_AGE_SECONDS, // 30 seconds
  dislocationThresholdBps: 500, // 5% mark vs reference spread
};

const TARGET_WEIGHTS_BPS = { OPENAI: 3000, ANTHROPIC: 3000, FIGUREAI: 3000, USDC: 1000 };

// Fixture holdings sized so fixture prices land exactly on target weights:
// 3x$100 + 6x$50 + 12x$25 + 100x$1 = 1000 → 30/30/30/10.
const HOLDINGS_UNITS = { OPENAI: 3, ANTHROPIC: 6, FIGUREAI: 12, USDC: 100 };

function calculateCurrentWeights(valuesBySymbol, totalNAV) {
  const weights = {};
  for (const sym of Object.keys(valuesBySymbol)) {
    weights[sym] = totalNAV === 0 ? 0 : Math.round((valuesBySymbol[sym] / totalNAV) * 10000);
  }
  return weights;
}

function calculateWeightDrift(currentBps, targetBps) {
  const perAsset = {};
  let maxDriftBps = 0;
  for (const sym of Object.keys(targetBps)) {
    const drift = Math.abs((currentBps[sym] || 0) - targetBps[sym]);
    perAsset[sym] = drift;
    if (drift > maxDriftBps) maxDriftBps = drift;
  }
  return { perAsset, maxDriftBps };
}

function calculateMarkNAV(pricesBySymbol, holdingsUnits) {
  let nav = 0;
  for (const sym of Object.keys(holdingsUnits)) {
    if (pricesBySymbol[sym] === undefined || pricesBySymbol[sym] === null) {
      const err = new Error(`MISSING_PRICE: ${sym}`);
      err.code = "MISSING_PRICE";
      throw err;
    }
    nav += pricesBySymbol[sym] * holdingsUnits[sym];
  }
  return nav;
}

function calculateReferenceNAV() {
  return null; // no verified reference market in Phase 3 — never estimated
}

function calculateDislocation(markNAV, referenceNAV) {
  if (markNAV === null || referenceNAV === null || referenceNAV === 0) return "UNKNOWN";
  return Math.round(((markNAV - referenceNAV) / referenceNAV) * 10000);
}

function validateReserve(usdcWeightBps, minBps = RULES.minUsdcReserveBps) {
  if (usdcWeightBps < minBps) {
    return { ok: false, code: "RESERVE_BREACH", usdcWeightBps, minBps };
  }
  return { ok: true, code: null, usdcWeightBps, minBps };
}

function validateMaxWeights(weightsBps, maxBps = RULES.maxSingleAssetWeightBps) {
  const breaches = Object.keys(weightsBps).filter((s) => weightsBps[s] > maxBps);
  if (breaches.length > 0) {
    return { ok: false, code: "ASSET_OVERWEIGHT", breaches, maxBps };
  }
  return { ok: true, code: null, breaches: [], maxBps };
}

function validatePriceQuality(tokenPrices, reference) {
  const staleToken = (tokenPrices || []).some((t) => t.validity === "STALE_DATA");
  const refValidity = reference ? reference.validity : "UNKNOWN";
  if (staleToken) return { ok: false, validity: "STALE_DATA" };
  if (refValidity === "STALE_DATA" || refValidity === "INVALID_FEED" || refValidity === "LOW_CONFIDENCE") {
    return { ok: false, validity: refValidity };
  }
  return { ok: true, validity: refValidity === "UNKNOWN" ? "REFERENCE_UNKNOWN" : refValidity };
}

function validateNotionalLimits(notional, dailyUsed = 0, perActionMax = RULES.maxActionNotional, dailyMax = RULES.maxDailyNotional) {
  if (notional > perActionMax) {
    return { ok: false, code: "EXCESSIVE_NOTIONAL", notional, perActionMax, dailyUsed, dailyMax };
  }
  if (dailyUsed + notional > dailyMax) {
    return { ok: false, code: "DAILY_LIMIT_EXCEEDED", notional, perActionMax, dailyUsed, dailyMax };
  }
  return { ok: true, code: null, notional, perActionMax, dailyUsed, dailyMax };
}

function classifyStrategyState(input) {
  const {
    currentWeightsBps,
    targetWeightsBps = TARGET_WEIGHTS_BPS,
    tokenPrices = [],
    reference = null,
    paused = false,
    proposalNotional = null,
    dailyUsed = 0,
  } = input;
  const reasonCodes = [];

  if (paused) {
    return {
      state: "PAUSED",
      reasonCodes: ["STRATEGY_PAUSED"],
      currentWeights: currentWeightsBps,
      targetWeights: targetWeightsBps,
      dataQuality: "UNKNOWN",
      proposalAllowed: false,
      executionAllowed: false,
      requiresApproval: true,
    };
  }

  const quality = validatePriceQuality(tokenPrices, reference);
  if (!quality.ok) {
    return {
      state: "STALE_DATA",
      reasonCodes: [quality.validity],
      currentWeights: currentWeightsBps,
      targetWeights: targetWeightsBps,
      dataQuality: quality.validity,
      proposalAllowed: false,
      executionAllowed: false,
      requiresApproval: true,
    };
  }

  const dislocation = calculateDislocation(input.markNAV ?? null, input.referenceNAV ?? null);
  if (dislocation !== "UNKNOWN" && Math.abs(dislocation) > RULES.dislocationThresholdBps) {
    return {
      state: "DISLOCATED",
      reasonCodes: ["REFERENCE_DISLOCATED"],
      currentWeights: currentWeightsBps,
      targetWeights: targetWeightsBps,
      dataQuality: quality.validity,
      proposalAllowed: false,
      executionAllowed: false,
      requiresApproval: true,
    };
  }

  const maxCheck = validateMaxWeights(currentWeightsBps);
  if (!maxCheck.ok) reasonCodes.push(maxCheck.code);
  const reserveCheck = validateReserve(currentWeightsBps.USDC || 0);
  if (!reserveCheck.ok) reasonCodes.push(reserveCheck.code);
  const drift = calculateWeightDrift(currentWeightsBps, targetWeightsBps);
  if (drift.maxDriftBps > RULES.rebalanceDriftBps && reasonCodes.length === 0) {
    reasonCodes.push("DRIFT_THRESHOLD");
  }

  let proposalAllowed = true;
  if (proposalNotional !== null) {
    const notion = validateNotionalLimits(proposalNotional, dailyUsed);
    if (!notion.ok) {
      proposalAllowed = false;
      reasonCodes.push(notion.code);
    }
  }

  return {
    state: reasonCodes.length > 0 ? "DRIFTED" : "NORMAL",
    reasonCodes,
    currentWeights: currentWeightsBps,
    targetWeights: targetWeightsBps,
    dataQuality: quality.validity,
    proposalAllowed,
    executionAllowed: false,
    requiresApproval: true,
  };
}

module.exports = {
  RULES,
  TARGET_WEIGHTS_BPS,
  HOLDINGS_UNITS,
  calculateCurrentWeights,
  calculateWeightDrift,
  calculateMarkNAV,
  calculateReferenceNAV,
  calculateDislocation,
  validateReserve,
  validateMaxWeights,
  validatePriceQuality,
  validateNotionalLimits,
  classifyStrategyState,
};
