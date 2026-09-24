// Live PreStocks grounding for the strategy pages. Reads the issuer's own public
// catalogue API server-side (via lib/prestocks) and returns, per basket asset,
// whether our on-chain mint matches PreStocks' published contract_address plus the
// official mark price / implied valuation / product link. No key required.
import { NextResponse } from "next/server";
import { preStocksFacts } from "@/lib/prestocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const facts = await preStocksFacts();
  return NextResponse.json(facts);
}
