// Server-only adapter over the frozen deterministic engine.
// The modules under ./core are a MIRROR of the repo-root /lib (source of
// truth, pinned by the phase test-suite). Keep them in sync; never let the UI
// invent numbers the engine did not produce.
import "server-only";

/* eslint-disable @typescript-eslint/no-var-requires */
import rules from "./core/rules";
import pyth from "./core/pyth";
import priceProvider from "./core/price-provider";
import assetRegistry from "./core/asset-registry";
import agentMod from "./core/agent";
import basketsMod from "./core/baskets";
import livePricesMod from "./core/live-prices";

const {
  calculateCurrentWeights,
  calculateMarkNAV,
  calculateReferenceNAV,
  calculateDislocation,
  calculateWeightDrift,
  classifyStrategyState,
} = rules as any;
const { DEMO_FEED_ID } = pyth as any;
const { getTokenPriceBySymbol, getReferencePrice } = priceProvider as any;
const { listApprovedAssets } = assetRegistry as any;
const { listBaskets, getBasket, targetWeightsBps, holdingsUnits } = basketsMod as any;
const { fetchLivePricesBySymbol } = livePricesMod as any;
const agent = agentMod as any;

export type DemoMode = "fresh" | "stale" | "invalid-feed" | "missing" | "drift" | "paused";

export const DEFAULT_BASKET_ID = "ai-infrastructure";

// Ported verbatim from server.js buildStrategySnapshot — the deterministic
// rules engine renders every figure; demo modes are labelled simulations.
export async function buildStrategySnapshot(demo: string, basketId: string = DEFAULT_BASKET_ID) {
  const now = Date.now();
  const basket = getBasket(basketId); // throws UNKNOWN_BASKET for bad ids
  const target = targetWeightsBps(basketId);
  let units = holdingsUnits(basketId);
  const symbols: string[] = basket.constituents.map((c: any) => c.symbol);
  const driftSymbol = symbols.find((s) => s !== "USDC");
  const NOMINAL_NAV = 10000; // model portfolio worth ~$10k at current prices

  // Prefer LIVE prices from Jupiter (real market data from on-chain liquidity).
  // Fall back to FIXTURE if the fetch fails/incompletes, so the demo never
  // hard-breaks on a network hiccup.
  let tokenPrices: any[];
  let priceMode = "LIVE";
  let change24hPct: number | null = null;
  try {
    const live = await fetchLivePricesBySymbol(symbols, { nowMs: now });
    if (!symbols.every((s) => live[s])) throw new Error("incomplete live prices");
    tokenPrices = symbols.map((s) => ({ ...live[s] }));
    const priceBySym: Record<string, number> = {};
    tokenPrices.forEach((t) => (priceBySym[t.symbol] = t.price));
    units = {};
    for (const c of basket.constituents) {
      units[c.symbol] = ((c.targetBps / 10000) * NOMINAL_NAV) / priceBySym[c.symbol];
    }
    change24hPct = basket.constituents.reduce((sum: number, c: any) => {
      const snap = tokenPrices.find((t) => t.symbol === c.symbol);
      const ch = snap && snap.priceChange24h != null ? snap.priceChange24h : 0;
      return sum + (c.targetBps / 10000) * ch;
    }, 0);
    if (demo === "drift" && driftSymbol) {
      const snap = tokenPrices.find((t) => t.symbol === driftSymbol);
      snap.price = Math.round(snap.price * 1.4 * 100) / 100;
      snap.source = "JUPITER+SIM";
    }
  } catch {
    priceMode = "FIXTURE";
    const priceOverride: Record<string, number> = {};
    if (demo === "drift" && driftSymbol) {
      const base = getTokenPriceBySymbol(driftSymbol, { nowMs: now });
      priceOverride[driftSymbol] = Math.round(base.price * 1.4 * 100) / 100;
    }
    tokenPrices = symbols.map((s) =>
      getTokenPriceBySymbol(s, { nowMs: now, priceOverride: priceOverride[s] ?? null }),
    );
  }
  let reference;
  let demoMode: string | null = null;
  let paused = false;
  if (demo === "stale") {
    reference = getReferencePrice(DEMO_FEED_ID, { nowMs: now, publishTimeMs: now - 45000 });
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

  const pricesBySymbol: Record<string, number> = {};
  const valuesBySymbol: Record<string, number> = {};
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
    dataFreshness:
      classification.dataQuality === "REFERENCE_UNKNOWN" ? "REFERENCE_UNKNOWN" : classification.dataQuality,
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

// Ported from server.js buildAgentDecision — constrained agent (untrusted proposer).
export async function buildAgentDecision(demo: string, revoked?: boolean, basketId: string = DEFAULT_BASKET_ID) {
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

export function assets() {
  return { dataMode: "FIXTURE", assets: listApprovedAssets() };
}

export function baskets() {
  // Attach each constituent's real mint (from the approved registry) so the
  // client can read the wallet's actual token balances for the basket.
  const mintBySymbol: Record<string, string> = {};
  for (const a of listApprovedAssets() as any[]) mintBySymbol[a.symbol] = a.mint;
  const list = (listBaskets() as any[]).map((b) => ({
    ...b,
    constituents: b.constituents.map((c: any) => ({ ...c, mint: mintBySymbol[c.symbol] ?? null })),
  }));
  return { dataMode: "FIXTURE", baskets: list };
}
