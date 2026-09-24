// Same-origin Devnet RPC proxy. The browser talks to `/api/rpc` on our own
// origin; this route forwards the JSON-RPC body to a real Devnet RPC read from a
// SERVER-ONLY env var, so the RPC key never ships in the client bundle (unlike
// NEXT_PUBLIC_*). The upstream is fixed server-side — the client can't point it
// anywhere — so this is not an open proxy. HTTP only; wallet-signed confirmation
// uses HTTP polling (getSignatureStatuses), so no WebSocket is needed.
//
// Provisioning (server env, never shipped to the browser):
//   SOLANA_RPC / HELIUS_RPC / AGENT_RPC   a Devnet RPC URL (defaults to public devnet)
import { NextRequest, NextResponse } from "next/server";
import { clusterApiUrl } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a USABLE upstream Devnet RPC. A non-empty but malformed value (a bare
// host or leftover junk) must not win and break fetch — sanitize it, tolerate a
// missing protocol, else fall back to the public endpoint. Also report WHICH env
// var won so the GET health check can say whether SOLANA_RPC actually took effect.
function resolveUpstream(): { url: string; source: string } {
  const candidates: [string, string | undefined][] = [
    ["SOLANA_RPC", process.env.SOLANA_RPC],
    ["HELIUS_RPC", process.env.HELIUS_RPC],
    ["AGENT_RPC", process.env.AGENT_RPC],
    ["NEXT_PUBLIC_SOLANA_RPC", process.env.NEXT_PUBLIC_SOLANA_RPC],
  ];
  for (const [name, raw] of candidates) {
    const c = (raw ?? "").trim();
    if (!c) continue;
    if (/^https?:\/\//i.test(c)) return { url: c, source: name };
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?].*)?$/i.test(c)) return { url: `https://${c}`, source: `${name} (added https)` };
  }
  return { url: clusterApiUrl("devnet"), source: "FALLBACK: public devnet (no SOLANA_RPC set)" };
}
const { url: UPSTREAM, source: UPSTREAM_SOURCE } = resolveUpstream();

// Diagnostic: GET /api/rpc reports which RPC the proxy resolved (HOST ONLY — never
// the key) and whether that RPC is healthy from the server's runtime. Lets us tell
// "SOLANA_RPC never took effect" apart from "the RPC itself is unhealthy" without
// guessing. Safe to remove after the demo.
export async function GET() {
  let host = "unknown";
  try {
    host = new URL(UPSTREAM).host;
  } catch {
    /* leave "unknown" */
  }
  const started = Date.now();
  let health: unknown = null;
  let blockHeight: unknown = null;
  let ok = false;
  let err: string | null = null;
  // Two SINGLE requests, never a JSON-RPC batch: some providers (e.g. the Helius
  // free tier) 403 batched calls, which made a perfectly healthy RPC look dead
  // here. The real app only ever issues single Devnet calls, so mirror that.
  const call = async (method: string, params?: unknown[]) => {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
      cache: "no-store",
    });
    const j: any = await res.json().catch(() => null);
    return { okHttp: res.ok, result: j?.result ?? null, error: j?.error ?? null };
  };
  try {
    const [h, b] = await Promise.all([call("getHealth"), call("getBlockHeight", [{ commitment: "confirmed" }])]);
    health = h.result ?? h.error ?? null;
    blockHeight = b.result ?? null;
    ok = h.okHttp && b.okHttp && health === "ok" && typeof blockHeight === "number";
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  return NextResponse.json({ ok, upstreamHost: host, source: UPSTREAM_SOURCE, health, blockHeight, ms: Date.now() - started, err });
}

export async function POST(req: NextRequest) {
  const body = await req.text(); // forward the JSON-RPC payload verbatim (single or batch)
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: any) {
    // Shape it like a JSON-RPC error so the web3.js client surfaces something useful.
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: `RPC proxy failed: ${e?.message ?? String(e)}` }, id: null },
      { status: 502 },
    );
  }
}
