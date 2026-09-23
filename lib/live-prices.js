// Live token prices from Jupiter (Solana-native price API). Real market prices
// derived from on-chain liquidity — proof these PreStocks tokens actually trade
// on Solana. Async + best-effort: callers fall back to FIXTURE prices if the
// fetch fails, so the demo never hard-breaks on a network hiccup.
//
// USDC is pinned to $1.00 (reserve unit of account). Low-liquidity assets are
// flagged LOW_LIQUIDITY rather than trusted blindly — honest about data quality.
const { listApprovedAssets } = require("./asset-registry");

const JUP_URL = "https://lite-api.jup.ag/price/v3";
const LOW_LIQUIDITY_USD = 1000; // below this the price is thin/noisy — flag it
const DEFAULT_TIMEOUT_MS = 6000;

// Fetch live USD prices for the given symbols. Returns a map symbol -> snapshot
// (same shape as the fixture snapshots, source "JUPITER", plus liquidityUsd and
// priceChange24h). Throws on network/parse failure so the caller can fall back.
async function fetchLivePricesBySymbol(symbols, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const mintToSymbol = {};
  for (const a of listApprovedAssets()) {
    if (symbols.includes(a.symbol) && a.mint) mintToSymbol[a.mint] = a.symbol;
  }
  const mints = Object.keys(mintToSymbol);
  if (mints.length === 0) return {};

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let json;
  try {
    const res = await fetch(`${JUP_URL}?ids=${mints.join(",")}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`JUP_HTTP_${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const bySymbol = {};
  for (const mint of mints) {
    const sym = mintToSymbol[mint];
    const p = json[mint];
    if (!p || p.usdPrice == null) continue;
    const liquidityUsd = Number(p.liquidity ?? 0);
    const lowLiq = liquidityUsd < LOW_LIQUIDITY_USD;
    bySymbol[sym] = {
      source: "JUPITER",
      symbol: sym,
      mint,
      price: Number(p.usdPrice),
      // Confidence proxy: thin books are less trustworthy than deep ones.
      confidence: lowLiq ? 0.5 : 0.02,
      liquidityUsd,
      priceChange24h: p.priceChange24h != null ? Number(p.priceChange24h) : null,
      publishTimeMs: nowMs,
      receivedTimeMs: nowMs,
      ageSeconds: 0,
      validity: lowLiq ? "LOW_LIQUIDITY" : "FRESH",
    };
  }

  // USDC is the reserve unit of account — always exactly $1, never market-quoted.
  if (symbols.includes("USDC")) {
    const usdc = listApprovedAssets().find((a) => a.symbol === "USDC");
    bySymbol.USDC = {
      source: "JUPITER",
      symbol: "USDC",
      mint: usdc ? usdc.mint : null,
      price: 1.0,
      confidence: 0.001,
      liquidityUsd: null,
      priceChange24h: 0,
      publishTimeMs: nowMs,
      receivedTimeMs: nowMs,
      ageSeconds: 0,
      validity: "FRESH",
    };
  }
  return bySymbol;
}

module.exports = { fetchLivePricesBySymbol, LOW_LIQUIDITY_USD };
