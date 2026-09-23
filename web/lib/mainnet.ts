// Real tokenized-stock grounding. The demo trades Devnet MIRROR tokens, but the
// assets each basket represents are the real PreStocks tokens on Solana MAINNET.
// This module reads those mints' live on-chain state (standard, decimals, supply,
// authorities, Token-2022 issuer controls, metadata) so the UI can prove the
// basket points at the genuine on-chain asset — not just a label. Nothing here is
// fabricated: mint addresses come from the verified allowlist, every other field
// is read live from mainnet. Server-only (opens a mainnet RPC connection).
import "server-only";

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
/* eslint-disable @typescript-eslint/no-var-requires */
import assetRegistry from "./core/asset-registry";
const { listApprovedAssets } = assetRegistry as any;

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Token-2022 extensions worth surfacing to a follower — they describe how much
// control the issuer keeps over a "share." Keyed by the parsed extension name.
const CONTROL_LABELS: Record<string, string> = {
  permanentDelegate: "Clawback",
  pausableConfig: "Pausable",
  transferHook: "Transfer hook",
  confidentialTransferMint: "Confidential",
  defaultAccountState: "Default state",
};

export type MainnetMintOnchain = {
  program: "Token-2022" | "SPL Token";
  decimals: number;
  supplyRaw: string;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  transferFeeBps: number | null;
  controls: string[]; // human labels for notable Token-2022 extensions
  metadata: { name: string; symbol: string; uri: string } | null;
};

export type MainnetAssetFact = {
  symbol: string;
  name: string;
  issuer: string;
  mint: string;
  registryDecimals: number;
  onchain: MainnetMintOnchain | null; // null when the mainnet read failed for this mint
};

export type MainnetFacts = {
  cluster: "mainnet-beta";
  rpcSource: "custom" | "public";
  fetchedAt: number;
  degraded: boolean; // true when the on-chain read failed (addresses still shown)
  error?: string;
  assets: MainnetAssetFact[];
};

function extractOnchain(acc: any): MainnetMintOnchain | null {
  if (!acc || !acc.data || !acc.data.parsed || acc.data.parsed.type !== "mint") return null;
  const info = acc.data.parsed.info;
  const owner = acc.owner?.toBase58?.() ?? String(acc.owner);
  const exts: any[] = Array.isArray(info.extensions) ? info.extensions : [];
  const fee = exts.find((e) => e.extension === "transferFeeConfig");
  const md = exts.find((e) => e.extension === "tokenMetadata");
  const decimals = Number(info.decimals);
  const supplyRaw = String(info.supply);
  return {
    program: owner === TOKEN_2022_PROGRAM ? "Token-2022" : "SPL Token",
    decimals,
    supplyRaw,
    supplyUi: Number(supplyRaw) / 10 ** decimals,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    transferFeeBps: fee ? Number(fee.state?.newerTransferFee?.transferFeeBasisPoints ?? 0) : null,
    controls: exts.map((e) => CONTROL_LABELS[e.extension]).filter((v): v is string => Boolean(v)),
    metadata: md
      ? { name: String(md.state?.name ?? ""), symbol: String(md.state?.symbol ?? ""), uri: String(md.state?.uri ?? "") }
      : null,
  };
}

// A short in-process cache: mint supply/state drift slowly and a judge may reload
// the page repeatedly, so we don't hammer mainnet on every request.
let cache: MainnetFacts | null = null;
const TTL_MS = 60_000;

// One live read of every registry mint's parsed state. Thrown errors bubble to
// the retry/degrade handling in mainnetAssetFacts.
async function readOnce(rpc: string, registry: Omit<MainnetAssetFact, "onchain">[]): Promise<MainnetAssetFact[]> {
  const connection = new Connection(rpc, "confirmed");
  const keys = registry.map((a) => new PublicKey(a.mint));
  const res = await connection.getMultipleParsedAccounts(keys, { commitment: "confirmed" });
  return registry.map((a, i) => ({ ...a, onchain: extractOnchain(res.value[i]) }));
}

export async function mainnetAssetFacts(): Promise<MainnetFacts> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;

  const registry = (listApprovedAssets() as any[]).map((a) => ({
    symbol: a.symbol,
    name: a.name,
    issuer: a.issuer,
    mint: a.mint,
    registryDecimals: a.mintDecimals,
  }));
  const custom = process.env.MAINNET_RPC;
  const rpc = custom || clusterApiUrl("mainnet-beta");
  const base: Omit<MainnetFacts, "assets" | "degraded" | "error"> = {
    cluster: "mainnet-beta",
    rpcSource: custom ? "custom" : "public",
    fetchedAt: Date.now(),
  };

  // The default public endpoint is flaky (intermittent "fetch failed"), so try
  // twice before degrading — one transient miss shouldn't hide the live figures.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const assets = await readOnce(rpc, registry);
      cache = { ...base, degraded: false, assets };
      return cache;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }

  // Honest degrade: keep the verified mint addresses, drop the live figures.
  const assets: MainnetAssetFact[] = registry.map((a) => ({ ...a, onchain: null }));
  const facts: MainnetFacts = { ...base, degraded: true, error: String((lastErr as Error)?.message ?? lastErr), assets };
  if (!cache) cache = facts; // cache the degrade briefly too, so we don't retry-storm
  return facts;
}
