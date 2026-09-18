// Phase 2 — Strategy valuator. Deterministic: identical inputs, identical outputs.
// Computes Mark NAV from token prices; Reference NAV is UNKNOWN until a verified
// Pyth reference feed exists. Pyth quality drives state: STALE_DATA blocks proposals.
const HOLDINGS = { OPENAI: 3, ANTHROPIC: 6, XAI: 12, USDC: 10 };

function calculate(snapshot) {
  const { tokenPrices, reference } = snapshot;

  let markNAV = 0;
  for (const t of tokenPrices) {
    const units = HOLDINGS[t.symbol];
    if (units === undefined) {
      const err = new Error(`UNKNOWN_HOLDING: ${t.symbol}`);
      err.code = "UNKNOWN_HOLDING";
      throw err;
    }
    markNAV += units * t.price;
  }

  const referenceNAV = null; // no verified reference market in Phase 2
  const premiumDiscount = "UNKNOWN";

  const tokenStale = tokenPrices.some((t) => t.validity === "STALE_DATA");
  const referenceBad =
    reference && (reference.validity === "STALE_DATA" || reference.validity === "INVALID_FEED");

  let state = "NORMAL";
  let dataFreshness = "FRESH";
  if (tokenStale || referenceBad) {
    state = "STALE_DATA";
    dataFreshness = "STALE_DATA";
  } else if (!reference || reference.validity === "UNKNOWN") {
    dataFreshness = "REFERENCE_UNKNOWN";
  }

  return {
    markNAV,
    referenceNAV,
    premiumDiscount,
    dataFreshness,
    dataConfidence: "FIXTURE",
    state,
    proposalAllowed: state === "NORMAL",
    executionAllowed: false,
    requiresApproval: true,
  };
}

module.exports = { HOLDINGS, calculate };
