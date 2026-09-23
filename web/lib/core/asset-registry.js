// Phase 2 — Approved asset allowlist. Server-side only; never trust frontend constants.
// PreStocks mints VERIFIED 2026-09-21 against Solana MAINNET (getAccountInfo → Token-2022
// program) and prestocks.com on-chain metadata (name/symbol/URI all match). USDC mint is the
// canonical Solana mainnet mint. `mintDecimals` are the real on-chain values (9 for the
// PreStocks Token-2022 mints, 6 for USDC). Devnet demo references these real mainnet mints;
// it never fabricates one. See decision log D-001/D-002.
const APPROVED_ASSETS = [
  {
    mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    symbol: "OPENAI",
    name: "OpenAI",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    symbol: "ANTHROPIC",
    name: "Anthropic",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx",
    symbol: "XAI",
    name: "xAI",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    symbol: "SPACEX",
    name: "SpaceX",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
    symbol: "ANDURIL",
    name: "Anduril",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
    symbol: "NEURALINK",
    name: "Neuralink",
    issuer: "PreStocks",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 9,
    allowed: true,
    verification: "VERIFIED",
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    issuer: "Centre",
    pythFeedId: null,
    priceDecimals: 6,
    mintDecimals: 6,
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
