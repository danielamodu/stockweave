"use client";

// Holdings — the full, expanded per-asset table. Overview links here for the
// complete breakdown (price, 24h, position value, target weight).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/components/dashboard/context";
import { Card, Holdings, Label, MixBar, StatCell, StatRow, fmtUsd, ChangeBadge } from "@/components/dashboard/ui";
import { Skeleton } from "@/components/skeleton";
import { MainnetAssets } from "@/components/mainnet-assets";

export default function HoldingsPage() {
  const d = useDashboard();
  const router = useRouter();

  // This page only makes sense once you're following something.
  useEffect(() => {
    if (d.ready && d.wallet && !d.following) router.replace("/dashboard");
  }, [d.ready, d.wallet, d.following, router]);

  if (!d.following) return <div className="min-h-[40vh]" />;

  const hasMix = Boolean(d.displayWeights && d.order.length > 0);

  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="bp-mono-label text-[10px]">{d.followedName}</div>
      <h1 className="mt-1 text-[clamp(1.5rem,3vw,2rem)] font-medium uppercase leading-none tracking-[-0.02em]">
        Holdings
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
        Every position in your mix, marked against {d.isLive ? "live Jupiter prices" : "demo prices"}. Weights are the
        targets you follow; cash is the reserve that never leaves.
      </p>

      <div className="mt-6">
        <StatRow>
          <StatCell
            label="Your value"
            value={fmtUsd(d.total)}
            sub={d.holdingsLoading ? "reading wallet…" : d.hasHoldings ? "marked live" : "no holdings yet — rules-only"}
          />
          <StatCell label="Today" value={<ChangeBadge value={d.change24h} size={16} className="text-[1.3rem]" />} sub="24h · weighted" />
          <StatCell label="Companies" value={d.holdingCount} sub="+ cash" />
          <StatCell label="Cash buffer" value={d.cashPct == null ? "—" : d.cashPct + "%"} sub="reserve" />
        </StatRow>
      </div>

      {hasMix && (
        <div className="mt-6">
          <MixBar order={d.order} weights={d.displayWeights!} />
        </div>
      )}

      <Card className="mt-6">
        <Label right={<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">{d.isLive ? "Live · Jupiter" : "Demo prices"}</span>}>
          Positions
        </Label>
        {hasMix ? (
          <Holdings order={d.order} weights={d.displayWeights!} prices={d.prices} live={d.isLive} total={d.total} values={d.holdingsBySymbol} />
        ) : (
          <div className="space-y-3 py-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
      </Card>

      {/* real tokenized-stock grounding — the live mainnet mints behind this mix */}
      {hasMix && <MainnetAssets symbols={d.order} />}
    </div>
  );
}
