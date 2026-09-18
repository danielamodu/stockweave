// Phase 2 — Approved asset allowlist. Server-side only; never trust frontend constants.
// PreStocks mints are VERIFYING (see decision log D-001/D-002). USDC mint is the
// canonical Solana mainnet mint, included so reserve accounting has a fixed address.
const APPROVED_ASSETS = [
  {
    mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    symbol: "OPENAI",
    name: "OpenAI",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    allowed: true,
    verification: "VERIFYING",
  },
  {
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    symbol: "ANTHROPIC",
    name: "Anthropic",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    allowed: true,
    verification: "VERIFYING",
  },
  {
    mint: null,
    symbol: "XAI",
    name: "xAI",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    allowed: true,
    verification: "VERIFYING_MINT_UNKNOWN",
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    issuer: "Centre",
    pythFeedId: null,
    priceDecimals: 6,
    allowed: true,
    verification: "VERIFIED",
  },
];

function listApprovedAssets() {
  return APPROVED_ASSETS.map((a) => ({ ...a }));
}

function getAsset(mint) {
  const asset = APPROVED_ASSETS.find((a) => a.mint !== null && a.mint === mint);
  if (!asset) {
    const err = new Error(`UNAPPROVED_MINT: ${mint}`);
    err.code = "UNAPPROVED_MINT";
    throw err;
  }
  return { ...asset };
}

module.exports = { listApprovedAssets, getAsset };
