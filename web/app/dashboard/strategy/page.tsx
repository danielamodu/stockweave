"use client";

// Strategy inspector, framed by the dashboard shell (persistent sidebar + top
// bar) instead of its own full-bleed page. Same component as the public
// /strategy/[id] route, rendered in embedded mode so a user reached from the
// sidebar stays inside the app — and "back" lands on the dashboard, not the
// marketing site. The public route stays for shareable, wallet-free links.
import { Suspense } from "react";
import { useDashboard } from "@/components/dashboard/context";
import { StrategyView } from "@/app/strategy/[id]/page";
import { Skeleton } from "@/components/skeleton";

export default function DashboardStrategyPage() {
  const { followedBasketId } = useDashboard();
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <StrategyView basketId={followedBasketId ?? "ai-infrastructure"} embedded />
    </Suspense>
  );
}
