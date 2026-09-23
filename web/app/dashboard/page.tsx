"use client";

// Overview — the big picture: what your mix is worth, how it's split, and the
// one thing (if any) waiting on your OK. Detail lives on the Holdings and
// Assistant pages; this page links out to them.
import Link from "next/link";
import { ArrowRight, Check, Coins, Plus, Settings, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { useDashboard } from "@/components/dashboard/context";
import {
  BrowseView,
  Card,
  ChangeBadge,
  Donut,
  Label,
  StatCell,
  StatRow,
  fmtUsd,
} from "@/components/dashboard/ui";
import { ASSET_LABEL, pct, segTone } from "@/lib/present";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const d = useDashboard();

  if (!d.following) return <BrowseView baskets={d.baskets} onFollow={d.onFollow} />;

  const hasMix = Boolean(d.displayWeights && d.order.length > 0);
  // __OVERVIEW_APPEND__

  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[clamp(1.5rem,3vw,2rem)] font-medium uppercase leading-none tracking-[-0.02em]">
            {d.followedName}
            {d.isFork && <span className="text-[var(--color-muted)]"> · your version</span>}
          </h1>
          <div className="mt-1.5 text-[13px] text-[var(--color-muted)]">{d.isFork ? "Your own mix" : d.followedTheme}</div>
        </div>
        {d.status && (
          <span
            className={cn(
              "inline-flex items-center gap-2 border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em]",
              d.status.tone === "ok" && "border-[var(--color-accent)] text-[var(--color-accent)]",
              d.status.tone === "attention" && "border-[var(--color-warn)] text-[var(--color-warn)]",
              d.status.tone === "muted" && "border-[var(--color-grid-strong)] text-[var(--color-muted)]",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            {d.status.label}
          </span>
        )}
      </div>

      <div className="mt-5">
        <StatRow>
          <StatCell
            label="Your value"
            value={fmtUsd(d.total)}
            sub={d.holdingsLoading ? "reading wallet…" : d.hasHoldings ? "marked live" : "no holdings yet — rules-only"}
          />
          <StatCell label="Today" value={<ChangeBadge value={d.change24h} size={16} className="text-[1.3rem]" />} sub="24h · weighted" />
          <StatCell label="Holdings" value={d.holdingCount} sub="companies" />
          <StatCell label="Cash buffer" value={d.cashPct == null ? "—" : d.cashPct + "%"} sub="reserve" />
        </StatRow>
      </div>
      {/* __OVERVIEW_GRID__ */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <Label
              right={
                <Link
                  href="/dashboard/holdings"
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-accent)]"
                >
                  All holdings <ArrowRight size={12} />
                </Link>
              }
            >
              Allocation
            </Label>
            {hasMix ? (
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
                <div className="relative grid shrink-0 place-items-center" style={{ width: 132, height: 132 }}>
                  <Donut segments={d.donutSegs} size={132} stroke={14} />
                  <div className="absolute inset-0 grid place-items-center text-center">
                    <div>
                      <div className="font-mono text-[1.5rem] leading-none tabular-nums">
                        {d.holdingCount}
                        <span className="text-[var(--color-faint)]">+1</span>
                      </div>
                      <div className="bp-mono-label mt-1 text-[8px]">Assets</div>
                    </div>
                  </div>
                </div>
                <ul className="w-full flex-1 space-y-2.5">
                  {d.order.map((s, i) => (
                    <li key={s} className="flex items-center gap-3 text-[13px]">
                      <span
                        className={cn("inline-block h-2.5 w-2.5 shrink-0", s === "USDC" && "bp-hatch border border-[var(--color-grid)]")}
                        style={s === "USDC" ? undefined : { background: segTone(s, i) }}
                      />
                      <span className="flex-1 font-medium">{ASSET_LABEL[s] ?? s}</span>
                      <span className="font-mono tabular-nums text-[var(--color-muted)]">{pct(d.displayWeights![s] ?? 0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <Skeleton className="h-[132px] w-[132px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            )}
          </Card>
          {/* __OVERVIEW_LEFT2__ */}
          <Card>
            <Label right={<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">{d.isLive ? "Live · Jupiter" : "Demo"}</span>}>
              Top holdings
            </Label>
            {hasMix ? (
              <ul className="space-y-1">
                {d.order
                  .filter((s) => s !== "USDC")
                  .sort((a, b) => (d.displayWeights![b] ?? 0) - (d.displayWeights![a] ?? 0))
                  .slice(0, 3)
                  .map((s, i) => (
                    <li key={s} className="bp-row flex items-center gap-3 px-2 py-2.5">
                      <AssetTile symbol={s} size={30} glyph={14} />
                      <span className="flex-1 text-[13px] font-medium">{ASSET_LABEL[s] ?? s}</span>
                      <ChangeBadge value={d.isLive ? d.prices[s]?.priceChange24h : null} className="w-[68px] justify-end text-[11px]" />
                      <span className="w-[48px] text-right font-mono text-[13px] tabular-nums">{pct(d.displayWeights![s] ?? 0)}%</span>
                    </li>
                  ))}
                <li className="pt-2">
                  <Link
                    href="/dashboard/holdings"
                    className="inline-flex items-center gap-1 text-[12px] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-accent)]"
                  >
                    View all {d.holdingCount + 1} holdings <ArrowRight size={13} />
                  </Link>
                </li>
              </ul>
            ) : (
              <div className="space-y-2 py-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            )}
          </Card>
        </div>
        {/* __OVERVIEW_RAIL__ */}
        <div className="space-y-5">
          <Card>
            <Label
              right={
                d.suggestion || d.approved ? (
                  <Link
                    href="/dashboard/assistant"
                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-accent)]"
                  >
                    Assistant <ArrowRight size={12} />
                  </Link>
                ) : undefined
              }
            >
              Needs your OK
            </Label>
            <div key={d.approved ? "done" : d.suggestion ? "todo" : "clear"} className="bp-fade" aria-live="polite">
              {d.approved ? (
                <div className="flex items-center gap-2 text-[14px] text-[var(--color-accent)]">
                  <Check size={16} /> Done — your assistant made the change.
                </div>
              ) : d.suggestion ? (
                <>
                  <p className="text-[14px] leading-relaxed">{d.suggestion.text}</p>
                  <div className="mt-4 flex gap-2.5">
                    <button
                      onClick={d.onApprove}
                      className="inline-flex h-10 items-center gap-2 bg-[var(--color-accent)] px-5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
                    >
                      Approve
                    </button>
                    <button
                      onClick={d.onSkip}
                      className="inline-flex h-10 items-center bg-[var(--color-soft)] px-5 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-soft-hover)]"
                    >
                      Skip
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[14px] text-[var(--color-muted)]">Nothing needs your attention right now.</p>
              )}
            </div>
          </Card>
          {d.isLive && d.movers.length > 0 && (
            <Card>
              <Label>Today&apos;s movers</Label>
              <ul className="space-y-3">
                {d.movers.slice(0, 3).map((m) => (
                  <li key={m.symbol} className="flex items-center gap-3">
                    <AssetTile symbol={m.symbol!} size={30} glyph={14} />
                    <span className="flex-1 text-[13px] font-medium">{ASSET_LABEL[m.symbol!] ?? m.symbol}</span>
                    <ChangeBadge value={m.priceChange24h} className="text-[12px]" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {/* __OVERVIEW_RAIL2__ */}
          <Card>
            <Label>Quick actions</Label>
            <div className="space-y-2">
              {d.devnetReady ? (
                <>
                  <button
                    onClick={d.getTestUsdc}
                    disabled={d.fauceting}
                    className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-grid)] px-3 py-2.5 text-left text-[13px] font-medium transition-colors hover:border-[var(--color-grid-strong)] disabled:opacity-50"
                  >
                    <Coins size={15} className="text-[var(--color-accent)]" />
                    {d.fauceting ? "Minting test USDC…" : "Get test USDC"}
                    {d.usdcBalance != null && d.usdcBalance > 0 && (
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--color-muted)]">{fmtUsd(d.usdcBalance)}</span>
                    )}
                  </button>
                  <button
                    onClick={d.buyBasket}
                    disabled={d.buying || !hasMix || !d.usdcBalance}
                    className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2.5 text-left text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShoppingCart size={15} /> {d.buying ? "Buying on-chain…" : "Buy this mix"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => toast("Add funds is disabled in the demo")}
                  className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-grid)] px-3 py-2.5 text-left text-[13px] font-medium transition-colors hover:border-[var(--color-grid-strong)]"
                >
                  <Plus size={15} className="text-[var(--color-accent)]" /> Add funds
                </button>
              )}
              <Link
                href={d.makeHref}
                className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-grid)] px-3 py-2.5 text-left text-[13px] font-medium no-underline text-[var(--color-ink)] transition-colors hover:border-[var(--color-grid-strong)]"
              >
                <SlidersHorizontal size={15} className="text-[var(--color-accent)]" /> Make your own version
              </Link>
              <Link
                href="/dashboard/assistant"
                className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-grid)] px-3 py-2.5 text-left text-[13px] font-medium no-underline text-[var(--color-ink)] transition-colors hover:border-[var(--color-grid-strong)]"
              >
                <Settings size={15} className="text-[var(--color-accent)]" /> Assistant settings
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

