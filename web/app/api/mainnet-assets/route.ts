// Live mainnet facts for the real PreStocks tokens each basket represents. The
// mint addresses are the verified allowlist; supply/decimals/standard/controls are
// read live from Solana mainnet (see lib/mainnet.ts). Server-side so the mainnet
// RPC (optional MAINNET_RPC override) never touches the browser.
import { NextResponse } from "next/server";
import { mainnetAssetFacts } from "@/lib/mainnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const facts = await mainnetAssetFacts();
  return NextResponse.json(facts);
}
