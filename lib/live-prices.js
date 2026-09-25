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
const MAX_ATTEMPTS = 3; // one real try + up to two quick retries on a blip
const RETRY_BACKOFF_MS = [250, 600]; // waits between successive attempts, ms

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One Jupiter fetch → map symbol -> snapshot (same shape as the fixture
// snapshots, source "JUPITER", plus liquidityUsd and priceChange24h). A symbol
// Jupiter has no price for at this instant is simply absent from the map. Throws
// on network/parse failure so the retry wrapper can try again.
async function fetchPricesOnce(symbols, nowMs, timeoutMs) {
  const mintToSymbol = {};
  for (const a of listApprovedAssets()) {
    if (symbols.includes(a.symbol) && a.mint) mintToSymbol[a.mint] = a.symbol;
  }
  const mints = Object.keys(mintToSymbol);
  if (mints.length === 0) return {};

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

// Fetch live USD prices for the given symbols. Returns a map symbol -> snapshot
// (source "JUPITER"). Jupiter occasionally drops a request (network blip, 5xx)
// or omits a thin-liquidity token for a moment, which used to bounce the whole
// demo to FIXTURE. So we retry a few times with a short backoff, returning as
// soon as every needed symbol has a quote; if attempts run out we hand back the
// best-effort partial (or re-throw when we got nothing) and let the caller
// decide LIVE vs FIXTURE — exactly as before.
async function fetchLivePricesBySymbol(symbols, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, opts.attempts ?? MAX_ATTEMPTS);
  // Symbols we need a real market quote for (USDC is pinned locally, not fetched).
  const needed = symbols.filter((s) => s !== "USDC");

  let best = {};
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const got = await fetchPricesOnce(symbols, nowMs, timeoutMs);
      // Complete once every needed symbol has a live quote — return immediately.
      if (needed.every((s) => got[s])) return got;
      // Otherwise keep the most complete partial in case every attempt falls short.
      if (Object.keys(got).length > Object.keys(best).length) best = got;
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) await sleep(RETRY_BACKOFF_MS[i] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  }
  // Out of attempts: return the best partial we saw; if we only ever errored,
  // re-throw so the caller falls back to FIXTURE just like it did before.
  if (Object.keys(best).length === 0 && lastErr) throw lastErr;
  return best;
}

module.exports = { fetchLivePricesBySymbol, LOW_LIQUIDITY_USD };
