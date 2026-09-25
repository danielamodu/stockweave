// Server-side on-chain ledger. The browser asks for one strategy's signed
// activity; this route reads it from the SAME server-only Devnet RPC the proxy
// uses, classifies each transaction by our program's instruction discriminators
// (reusing readStrategyActivity), and returns compact JSON.
//
// Why server-side: getSignaturesForAddress + a getParsedTransaction per row is a
// burst, and the public Devnet fallback rate-limits bursts hard (HTTP 429) —
// done from the browser it competes with every other on-chain read on the page,
// so classifiable rows kept degrading to a generic label. Here it runs once,
// off the render path, and a short in-memory cache means reloads and repeat
// visitors don't re-burst. Nothing is invented: an unreadable row still degrades
// honestly to "other".
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { readStrategyActivity, type LedgerEntry } from "@/lib/onchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same precedence as the RPC proxy: a server-only Devnet URL wins, else public
// devnet. Kept in sync with app/api/rpc/route.ts (host is never returned here).
function resolveUpstream(): string {
  const candidates = [
    process.env.SOLANA_RPC,
    process.env.HELIUS_RPC,
    process.env.AGENT_RPC,
    process.env.NEXT_PUBLIC_SOLANA_RPC,
  ];
  for (const raw of candidates) {
    const c = (raw ?? "").trim();
    if (!c) continue;
    if (/^https?:\/\//i.test(c)) return c;
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?].*)?$/i.test(c)) return `https://${c}`;
  }
  return clusterApiUrl("devnet");
}

const UPSTREAM = resolveUpstream();
const connection = new Connection(UPSTREAM, "confirmed");

// Short in-memory cache so a reload or a second visitor serves instantly and the
// RPC only gets hit once per strategy per window. Keyed by strategy+limit.
const TTL_MS = 45_000;
const cache = new Map<string, { at: number; entries: LedgerEntry[] }>();

export async function GET(req: NextRequest) {
  const strategy = req.nextUrl.searchParams.get("strategy")?.trim() ?? "";
  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 8));
  let pk: PublicKey;
  try {
    pk = new PublicKey(strategy);
  } catch {
    return NextResponse.json({ error: "invalid strategy address" }, { status: 400 });
  }

  const key = `${pk.toBase58()}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ entries: hit.entries, cached: true });
  }

  try {
    const entries = await readStrategyActivity(connection, pk, limit);
    cache.set(key, { at: Date.now(), entries });
    return NextResponse.json({ entries, cached: false });
  } catch {
    // Serve a slightly stale cache rather than an error if we have one.
    if (hit) return NextResponse.json({ entries: hit.entries, cached: true, stale: true });
    return NextResponse.json({ error: "could not read the ledger" }, { status: 502 });
  }
}
