import { NextResponse } from "next/server";
import { baskets } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(baskets());
}
