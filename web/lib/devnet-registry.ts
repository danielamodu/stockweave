// Devnet mirror-mint registry reader. The demo mirrors the (mainnet-only)
// PreStocks assets as Devnet SPL "mirror" mints the deployed program issues, so a
// Devnet wallet genuinely holds the basket on-chain. Addresses come from
// tests/seed-devnet-mints.js (committed into devnet-mints.json after seeding).
// Until seeded the file is empty and the buy UI stays hidden — never fabricated.
import reg from "./devnet-mints.json";

export type DevnetAsset = { mint: string; decimals: number; mainnetMint?: string };
type Registry = {
  programId: string;
  vault: string;
  usdc: { mint: string; decimals: number };
  assets: Record<string, DevnetAsset>;
};

const R = reg as Registry;

// True once the mirror mints exist on Devnet (vault + USDC + at least one asset).
export function devnetSeeded(): boolean {
  return Boolean(R.vault && R.usdc?.mint && R.assets && Object.keys(R.assets).length > 0);
}

// The Devnet test-USDC mirror (cash leg), or null before seeding.
export function devnetUsdc(): { mint: string; decimals: number } | null {
  return R.usdc?.mint ? R.usdc : null;
}

// The Devnet mirror mint for one symbol, or null if not seeded.
export function devnetAsset(symbol: string): DevnetAsset | null {
  return R.assets?.[symbol] ?? null;
}

// symbol → Devnet mirror mint, including USDC. Empty before seeding.
export function devnetMintBySymbol(): Record<string, string> {
  const m: Record<string, string> = {};
  if (R.usdc?.mint) m["USDC"] = R.usdc.mint;
  for (const [s, a] of Object.entries(R.assets ?? {})) if (a?.mint) m[s] = a.mint;
  return m;
}

// Devnet mirror mint → symbol (the inverse). On-chain strategies register mirror
// mints, so this maps what's actually stored back to a display/registry symbol.
export function symbolByDevnetMint(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [symbol, mint] of Object.entries(devnetMintBySymbol())) m[mint] = symbol;
  return m;
}

export function devnetVault(): string | null {
  return R.vault || null;
}
