// Constrained backend agent — the ONLY server-side signer in the app.
// It reads the REAL on-chain rules + registered assets for a strategy, derives an
// honest drift from live Jupiter 24h returns, attaches a fresh SOL/USD reference
// price (Pyth Hermes), and signs a real `propose_rebalance` with its own funded
// Devnet keypair. It can NEVER move funds: the connected wallet (the strategy's
// creator) approves + executes. Every risk guard is re-checked on-chain.
//
// Provisioning (server env, never shipped to the browser):
//   AGENT_SECRET_KEY      JSON byte array of the agent keypair (e.g. `[12,34,...]`)
//   NEXT_PUBLIC_AGENT_PUBKEY  the matching public key (also read by the client)
//   AGENT_RPC / HELIUS_RPC    optional Devnet RPC (defaults to clusterApiUrl devnet)
// The agent's pubkey must hold a little Devnet SOL (proposal rent + fees) and be
// granted READ+PROPOSE on the strategy (seed script for official baskets; the
// make-your-own flow grants it automatically when configured).
//
// NOTE: this endpoint is unauthenticated (demo). Proposing is non-custodial and
// fully guarded on-chain, so the only abuse is spending the agent's own Devnet
// SOL on proposal rent. Add auth/rate-limiting before any non-demo deployment.
import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from "@solana/web3.js";
import {
  AGENT_PUBKEY,
  REFERENCE_FEED_HEX,
  buildProposeRebalanceIx,
  listStrategyAssets,
  proposalAddress,
  readStrategyById,
} from "@/lib/onchain";
import assetRegistry from "@/lib/core/asset-registry";
import livePrices from "@/lib/core/live-prices";
import { symbolByDevnetMint } from "@/lib/devnet-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { listApprovedAssets } = assetRegistry as any;
const { fetchLivePricesBySymbol } = livePrices as any;

const ASSET_LABEL: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  FIGUREAI: "Figure AI",
  SPACEX: "SpaceX",
  ANDURIL: "Anduril",
  NEURALINK: "Neuralink",
};

// Resolve a USABLE Devnet RPC. A non-empty but malformed env value (a bare host,
// an api-key, or leftover junk) must not win the `||` chain and crash
// `new Connection` — sanitize it, tolerate a missing protocol, else fall back.
function resolveRpc(): string {
  for (const raw of [process.env.AGENT_RPC, process.env.HELIUS_RPC, process.env.NEXT_PUBLIC_SOLANA_RPC]) {
    const c = (raw ?? "").trim();
    if (!c) continue;
    if (/^https?:\/\//i.test(c)) return c;
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?].*)?$/i.test(c)) return `https://${c}`; // protocol-less host
  }
  return clusterApiUrl("devnet");
}
const RPC = resolveRpc();
const HERMES = "https://hermes.pyth.network/v2/updates/price/latest";
const NAV_MODEL_USD = 10000; // model portfolio size, matches the engine snapshot

function loadAgentKeypair(): Keypair | null {
  const raw = process.env.AGENT_SECRET_KEY;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

// Fresh SOL/USD from Pyth Hermes. Returns the native i64 price + unix publish time.
async function fetchReferenceOracle(): Promise<{ price: bigint; publishTime: number }> {
  const res = await fetch(`${HERMES}?ids[]=${REFERENCE_FEED_HEX}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HERMES_HTTP_${res.status}`);
  const json: any = await res.json();
  const p = json?.parsed?.[0]?.price;
  if (!p || p.price == null || p.publish_time == null) throw new Error("HERMES_NO_PRICE");
  return { price: BigInt(p.price), publishTime: Number(p.publish_time) };
}

// Thin wrapper so ANY uncaught throw (RPC read failure, oracle fetch, etc.)
// surfaces as a structured JSON error instead of an opaque empty-body 500.
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e: any) {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: e?.message ?? String(e), where: e?.stack?.split("\n")?.[1]?.trim() },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest) {
  const agent = loadAgentKeypair();
  if (!agent) {
    return NextResponse.json(
      {
        error: "AGENT_NOT_CONFIGURED",
        message: "Set AGENT_SECRET_KEY (and NEXT_PUBLIC_AGENT_PUBKEY) on the server to enable the constrained agent.",
      },
      { status: 503 },
    );
  }
  if (AGENT_PUBKEY && !agent.publicKey.equals(AGENT_PUBKEY)) {
    return NextResponse.json(
      { error: "AGENT_KEY_MISMATCH", message: "AGENT_SECRET_KEY does not match NEXT_PUBLIC_AGENT_PUBKEY." },
      { status: 500 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { creator: creatorStr, strategyId } = body ?? {};
  if (!creatorStr || !strategyId) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "creator and strategyId are required." }, { status: 400 });
  }
  let creator: PublicKey;
  try {
    creator = new PublicKey(creatorStr);
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST", message: "creator is not a valid public key." }, { status: 400 });
  }
  const connection = new Connection(RPC, "confirmed");

  // Read REAL on-chain state: rules + the agent's own grant.
  const state = await readStrategyById(connection, creator, strategyId, agent.publicKey);
  if (!state.exists || !state.rules) {
    return NextResponse.json(
      { error: "STRATEGY_NOT_FOUND", message: "No on-chain strategy/rules for that creator + id." },
      { status: 404 },
    );
  }
  if (state.status !== 0) {
    return NextResponse.json({ error: "STRATEGY_INACTIVE", message: "Strategy is paused or archived." }, { status: 409 });
  }
  if (((state.agentAllowedActions ?? 0) & 0b010) === 0) {
    return NextResponse.json(
      {
        error: "PROPOSE_NOT_ALLOWED",
        message: "The agent has no PROPOSE grant on this strategy. Grant it via the seed script (official) or by creating the basket with the agent configured.",
      },
      { status: 409 },
    );
  }
  const rules = state.rules;
  const strategy = new PublicKey(state.strategy);

  // On-chain asset targets → symbols. Strategies register DEVNET MIRROR mints, so
  // map those back first; also accept the mainnet mints from the approved registry.
  const onchainAssets = (await listStrategyAssets(connection, strategy)).filter((a) => a.enabled);
  const symByMint: Record<string, string> = { ...symbolByDevnetMint() };
  for (const a of listApprovedAssets() as any[]) symByMint[a.mint] = a.symbol;
  const assets = onchainAssets
    .map((a) => ({ mint: a.mint, symbol: symByMint[a.mint], targetBps: a.targetWeightBps }))
    .filter((a) => a.symbol && a.symbol !== "USDC");
  if (assets.length === 0) {
    return NextResponse.json(
      { error: "NO_ASSETS", message: "Strategy has no registered (non-cash) assets to rebalance." },
      { status: 409 },
    );
  }

  // Honest drift: value a mix held through the last 24h at REAL Jupiter returns.
  const symbols = assets.map((a) => a.symbol);
  let live: Record<string, any> = {};
  try {
    live = await fetchLivePricesBySymbol(symbols, {});
  } catch {
    live = {};
  }
  const readAt = Math.floor(Date.now() / 1000); // when the agent read live prices
  const reserveBps = rules.reserveWeightBps;
  let totalValueBps = reserveBps; // cash held flat at $1
  const valueBps: Record<string, number> = {};
  let pricedCount = 0;
  for (const a of assets) {
    const ch = live[a.symbol]?.priceChange24h;
    const priced = typeof ch === "number";
    if (priced) pricedCount++;
    const growth = 1 + (priced ? ch : 0) / 100;
    valueBps[a.symbol] = a.targetBps * growth;
    totalValueBps += valueBps[a.symbol];
  }
  // The most-overweight asset (largest positive drift from target) is the pick.
  let pick = assets[0];
  let pickDrift = -Infinity;
  for (const a of assets) {
    const drift = (10000 * valueBps[a.symbol]) / totalValueBps - a.targetBps;
    if (drift > pickDrift) {
      pickDrift = drift;
      pick = a;
    }
  }
  // Per-asset evidence the brief cites: the real 24h move, the resulting live
  // weight, and the drift from the on-chain target. Sorted by drift so the driver
  // reads first; an asset with no live price is flagged, never defaulted to 0%.
  const evidence = assets
    .map((a) => {
      const ch = live[a.symbol]?.priceChange24h;
      const priced = typeof ch === "number";
      const currentBps = (10000 * valueBps[a.symbol]) / totalValueBps;
      return {
        symbol: a.symbol,
        label: ASSET_LABEL[a.symbol] ?? a.symbol,
        targetBps: a.targetBps,
        change24h: priced ? ch : null,
        currentBps: Math.round(currentBps),
        driftBps: Math.round(currentBps - a.targetBps),
        priced,
        picked: a.symbol === pick.symbol,
      };
    })
    .sort((x, y) => y.driftBps - x.driftBps);

  // The strategy's own configured rebalance band is the agent's discretion line.
  if (pickDrift < rules.rebalanceDriftBps) {
    return NextResponse.json({
      ok: true,
      proposal: null,
      reason: "WITHIN_DRIFT_BAND",
      maxDriftBps: Math.round(pickDrift),
      evidence,
      pricedCount,
      assetCount: assets.length,
      priceSource: "JUPITER",
      readAt,
    });
  }

  // Fresh reference oracle (SOL/USD) — the program rejects a stale/wrong feed.
  let oracle: { price: bigint; publishTime: number };
  try {
    oracle = await fetchReferenceOracle();
  } catch {
    return NextResponse.json(
      { error: "ORACLE_UNAVAILABLE", message: "Could not fetch a fresh SOL/USD reference price." },
      { status: 502 },
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const publishTime = Math.min(oracle.publishTime, nowSec);
  if (nowSec - publishTime > rules.maxPriceAgeSeconds) {
    return NextResponse.json(
      { error: "ORACLE_STALE", message: "Reference price is older than the strategy's max age." },
      { status: 502 },
    );
  }

  // Trim the most-overweight asset back to its target; proceeds lift cash (reserve
  // can only rise, so the reserve floor holds). Notional is bounded by the rules.
  const notional = Math.max(1, Math.min(Math.round((pickDrift / 10000) * NAV_MODEL_USD), rules.maxTradeNotional));
  const proposalId = Date.now();
  const approvalNonce = Math.floor(Math.random() * 2 ** 48);
  const expiresAt = nowSec + 3600;

  const ix = buildProposeRebalanceIx(strategy, agent.publicKey, {
    proposalId,
    mint: new PublicKey(pick.mint),
    newTargetWeightBps: pick.targetBps,
    projectedReserveBps: reserveBps,
    notional,
    reasonCode: 1,
    oracleFeedIdHex: REFERENCE_FEED_HEX,
    oraclePrice: oracle.price,
    oraclePublishTime: publishTime,
    approvalNonce,
    expiresAt,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = agent.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(agent);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (e: any) {
    return NextResponse.json({ error: "PROPOSE_FAILED", message: e?.message ?? String(e) }, { status: 502 });
  }

  const label = ASSET_LABEL[pick.symbol] ?? pick.symbol;
  const targetPct = (pick.targetBps / 100).toFixed(0);
  const text = `${label} has drifted about ${(pickDrift / 100).toFixed(1)}% above its ${targetPct}% target over the last 24h of live prices. The agent proposes trimming $${notional} back into cash — it can't execute, so this waits for your approval.`;
  return NextResponse.json({
    ok: true,
    signature,
    strategy: state.strategy,
    proposalId,
    proposalAccount: proposalAddress(strategy, proposalId).toBase58(),
    approvalNonce,
    mint: pick.mint,
    symbol: pick.symbol,
    newTargetWeightBps: pick.targetBps,
    projectedReserveBps: reserveBps,
    notional,
    maxDriftBps: Math.round(pickDrift),
    text,
    evidence,
    pricedCount,
    assetCount: assets.length,
    priceSource: "JUPITER",
    readAt,
    referencePublishTime: publishTime,
  });
}

