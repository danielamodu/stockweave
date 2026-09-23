import { NextRequest, NextResponse } from "next/server";
import { buildStrategySnapshot } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const demo = req.nextUrl.searchParams.get("demo") || "fresh";
  const basket = req.nextUrl.searchParams.get("basket") || undefined;
  try {
    return NextResponse.json(await buildStrategySnapshot(demo, basket));
  } catch (e: any) {
    const status = e?.code === "UNKNOWN_BASKET" ? 400 : 500;
    return NextResponse.json({ error: e?.code || "INTERNAL_ERROR", message: e?.message }, { status });
  }
}
