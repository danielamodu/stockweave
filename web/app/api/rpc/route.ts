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
// missing protocol, else fall back to the public endpoint.
function resolveUpstream(): string {
  for (const raw of [process.env.SOLANA_RPC, process.env.HELIUS_RPC, process.env.AGENT_RPC, process.env.NEXT_PUBLIC_SOLANA_RPC]) {
    const c = (raw ?? "").trim();
    if (!c) continue;
    if (/^https?:\/\//i.test(c)) return c;
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?].*)?$/i.test(c)) return `https://${c}`;
  }
  return clusterApiUrl("devnet");
}
const UPSTREAM = resolveUpstream();

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
