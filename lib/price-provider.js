// Phase 2 — Price provider behind stable internal interfaces.
// Token prices are FIXTURE-sourced (no sponsor API connected yet) and labelled as such.
// Reference prices are UNKNOWN: no verified public Pyth feed exists for these
// pre-IPO mints, so the adapter returns UNKNOWN instead of a fabricated estimate.
const { getAsset, listApprovedAssets } = require("./asset-registry");
const { assessPriceQuality, MAX_AGE_SECONDS } = require("./pyth");

const FIXTURE_PRICES = {
  OPENAI: { price: 100.0, confidence: 0.5 },
  ANTHROPIC: { price: 50.0, confidence: 0.25 },
  XAI: { price: 25.0, confidence: 0.2 },
  USDC: { price: 1.0, confidence: 0.001 },
};

function getTokenPrice(mint, opts = {}) {
  const asset = getAsset(mint); // throws UNAPPROVED_MINT for unknown mints
  const fixture = FIXTURE_PRICES[asset.symbol];
  if (!fixture) {
    const err = new Error(`NO_FIXTURE_PRICE: ${asset.symbol}`);
    err.code = "NO_FIXTURE_PRICE";
    throw err;
  }
  const receivedTimeMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const publishTimeMs =
    opts.publishTimeMs != null ? opts.publishTimeMs : receivedTimeMs - 4000;
  const ageSeconds = (receivedTimeMs - publishTimeMs) / 1000;
  const validity = ageSeconds > MAX_AGE_SECONDS ? "STALE_DATA" : "FRESH";
  return {
    source: "FIXTURE",
    mint,
    symbol: asset.symbol,
    price: fixture.price,
    confidence: fixture.confidence,
    publishTimeMs,
    receivedTimeMs,
    ageSeconds,
    validity,
  };
}

function getReferencePrice(feedId, opts = {}) {
  const receivedTimeMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const publishTimeMs = opts.publishTimeMs != null ? opts.publishTimeMs : receivedTimeMs;
  if (feedId === null || feedId === undefined) {
    return {
      source: "PYTH",
      feedId: null,
      price: null,
      confidence: null,
      publishTimeMs: null,
      receivedTimeMs,
      ageSeconds: null,
      validity: "UNKNOWN",
    };
  }
  const quality = assessPriceQuality({ feedId, publishTimeMs, receivedTimeMs });
  return {
    source: "PYTH",
    feedId,
    price: null, // no verified reference market; never invent one
    confidence: null,
    publishTimeMs,
    receivedTimeMs,
    ageSeconds: quality.ageSeconds,
    validity: quality.validity,
  };
}

// Symbol-based pricing for allowlisted assets whose mint is still VERIFYING
// (XAI). The snapshot keeps mint:null and source FIXTURE so nothing on-chain
// can consume it as verified. opts.priceOverride supports labelled simulations.
function getTokenPriceBySymbol(symbol, opts = {}) {
  const asset = listApprovedAssets().find((a) => a.symbol === symbol);
  if (!asset || !asset.allowed) {
    const err = new Error(`UNAPPROVED_SYMBOL: ${symbol}`);
    err.code = "UNAPPROVED_SYMBOL";
    throw err;
  }
  const fixture = FIXTURE_PRICES[symbol];
  if (!fixture) {
    const err = new Error(`NO_FIXTURE_PRICE: ${symbol}`);
    err.code = "NO_FIXTURE_PRICE";
    throw err;
  }
  const receivedTimeMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const publishTimeMs =
    opts.publishTimeMs != null ? opts.publishTimeMs : receivedTimeMs - 4000;
  const ageSeconds = (receivedTimeMs - publishTimeMs) / 1000;
  const validity = ageSeconds > MAX_AGE_SECONDS ? "STALE_DATA" : "FRESH";
  return {
    source: "FIXTURE",
    mint: asset.mint,
    symbol,
    price: opts.priceOverride != null ? opts.priceOverride : fixture.price,
    confidence: fixture.confidence,
    publishTimeMs,
    receivedTimeMs,
    ageSeconds,
    validity,
  };
}

module.exports = { getTokenPrice, getTokenPriceBySymbol, getReferencePrice };
