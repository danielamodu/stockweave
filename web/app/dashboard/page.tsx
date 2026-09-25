"use client";

// Overview — the big picture: what your mix is worth, how it's split, and the
// one thing (if any) waiting on your OK. Detail lives on the Holdings and
// Assistant pages; this page links out to them.
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, Check, Coins, Plus, Settings, ShoppingCart, SlidersHorizontal, X } from "lucide-react";
import { useDashboard } from "@/components/dashboard/context";
import { SetupFlow } from "@/components/dashboard/setup";
import {
  AnimatedUsd,
  BrowseView,
  Card,
  ChangeBadge,
  Donut,
  Label,
  PerformancePanel,
  StatCell,
  StatRow,
  fmtUsd,
} from "@/components/dashboard/ui";
import { ASSET_LABEL, pct, segTone } from "@/lib/present";
import type { SendPhase } from "@/lib/onchain";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";

// Sign → Broadcast → Confirm progress for an in-flight on-chain action, shown in
// place of a quick-action button's label. Multi-leg buys/sells also show which
// chunk (step/steps) is currently live.
function PhaseSteps({ step }: { step: { phase: SendPhase; step: number; steps: number } }) {
  const order: { key: SendPhase; label: string }[] = [
    { key: "signing", label: "Sign" },
    { key: "broadcasting", label: "Broadcast" },
    { key: "confirming", label: "Confirm" },
  ];
  const at = order.findIndex((s) => s.key === step.phase);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em]">
      {order.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={cn(i === at && "font-semibold", i > at && "opacity-40")}>{i < at ? "✓" : s.label}</span>
          {i < order.length - 1 && <span className="opacity-30">·</span>}
        </span>
      ))}
      {step.steps > 1 && (
        <span className="ml-1 opacity-60">
          {step.step}/{step.steps}
        </span>
      )}
    </span>
  );
}

export default function OverviewPage() {
  const d = useDashboard();
  // Which allocation slice is hovered — shared by the donut and its legend list
  // so hovering either cross-highlights the other.
  const [activeSeg, setActiveSeg] = useState<string | null>(null);
  // Cash-out modal: null = closed, otherwise the chosen fraction (25/50/100%).
  const [cashOut, setCashOut] = useState<number | null>(null);

  if (!d.following) return <BrowseView baskets={d.baskets} onFollow={d.onFollow} />;

  // Freshly picked basket the wallet hasn't funded yet → guided setup (get test
  // USDC, then deposit) before the live dashboard. Only when the Devnet mirror is
  // seeded; otherwise fall through to the read-only overview. While balances are
  // still loading we hold a skeleton so a funded wallet never flashes the setup.
  if (d.devnetReady && !d.hasAssetHoldings) {
    if (d.holdingsBySymbol === null || d.holdingsLoading) {
      return (
        <div className="mx-auto max-w-[720px] space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      );
    }
    return <SetupFlow />;
  }

  const hasMix = Boolean(d.displayWeights && d.order.length > 0);
  // Hovered-slice readout for the donut center: its marked value (USDC pinned).
  const activeVal = activeSeg ? d.holdingsBySymbol?.[activeSeg] ?? null : null;
  // What "Cash out" can redeem = everything the wallet holds except the USDC
  // reserve. The modal's estimate scales this by the chosen fraction.
  const nonCashValue = d.holdingsBySymbol
    ? Object.entries(d.holdingsBySymbol).reduce((s, [sym, v]) => (sym === "USDC" ? s : s + (v ?? 0)), 0)
    : 0;

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
            value={<AnimatedUsd value={d.total} />}
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
                  <Donut segments={d.donutSegs} size={132} stroke={14} activeKey={activeSeg} onHover={setActiveSeg} />
                  <div className="pointer-events-none absolute inset-0 grid place-items-center px-2 text-center">
                    {activeSeg ? (
                      <div key={activeSeg} className="bp-fade">
                        <div className="bp-mono-label text-[8px] text-[var(--color-accent)]">{ASSET_LABEL[activeSeg] ?? activeSeg}</div>
                        <div className="mt-1 font-mono text-[1.15rem] leading-none tabular-nums">{pct(d.displayWeights?.[activeSeg] ?? 0)}%</div>
                        {activeVal != null && (
                          <div className="mt-1 font-mono text-[10px] tabular-nums text-[var(--color-muted)]">{fmtUsd(activeVal)}</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="font-mono text-[1.5rem] leading-none tabular-nums">
                          {d.holdingCount}
                          <span className="text-[var(--color-faint)]">+1</span>
                        </div>
                        <div className="bp-mono-label mt-1 text-[8px]">Assets</div>
                      </div>
                    )}
                  </div>
                </div>
                <ul className="w-full flex-1 space-y-2.5">
                  {d.order.map((s, i) => {
                    const on = activeSeg === s;
                    const dim = activeSeg != null && !on;
                    return (
                      <li
                        key={s}
                        onMouseEnter={() => setActiveSeg(s)}
                        onMouseLeave={() => setActiveSeg(null)}
                        className={cn(
                          "flex cursor-default items-center gap-3 text-[13px] transition-opacity duration-150",
                          dim && "opacity-40",
                        )}
                      >
                        <span
                          className={cn("inline-block h-2.5 w-2.5 shrink-0", s === "USDC" && "bp-hatch border border-[var(--color-grid)]")}
                          style={s === "USDC" ? undefined : { background: segTone(s, i) }}
                        />
                        <span className={cn("flex-1 font-medium", on && "text-[var(--color-accent)]")}>{ASSET_LABEL[s] ?? s}</span>
                        <span className="font-mono tabular-nums text-[var(--color-muted)]">{pct(d.displayWeights![s] ?? 0)}%</span>
                      </li>
                    );
                  })}
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
          <PerformancePanel series={d.nav} loading={d.navLoading} />
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
                    {d.txStep?.action === "faucet" ? (
                      <PhaseSteps step={d.txStep} />
                    ) : (
                      <>
                        {d.fauceting ? "Minting test USDC…" : "Get test USDC"}
                        {d.usdcBalance != null && d.usdcBalance > 0 && (
                          <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--color-muted)]">{fmtUsd(d.usdcBalance)}</span>
                        )}
                      </>
                    )}
                  </button>
                  <button
                    onClick={d.buyBasket}
                    disabled={d.buying || !hasMix || !d.usdcBalance}
                    className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2.5 text-left text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShoppingCart size={15} />{" "}
                    {d.txStep?.action === "buy" ? <PhaseSteps step={d.txStep} /> : d.buying ? "Buying on-chain…" : "Buy this mix"}
                  </button>
                  {d.hasAssetHoldings && (
                    <button
                      onClick={() => setCashOut(100)}
                      disabled={d.selling}
                      className="bp-row flex w-full items-center gap-2.5 border border-[var(--color-grid-strong)] px-3 py-2.5 text-left text-[13px] font-medium transition-colors hover:border-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Banknote size={15} className="text-[var(--color-accent)]" />
                      {d.txStep?.action === "sell" ? <PhaseSteps step={d.txStep} /> : d.selling ? "Cashing out…" : "Cash out"}
                    </button>
                  )}
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

      {cashOut != null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Cash out"
          onClick={() => setCashOut(null)}
        >
          <div
            className="bp-fade w-full max-w-[380px] border border-[var(--color-grid-strong)] bg-[var(--color-page)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="bp-mono-label text-[9px]">Cash out</div>
                <h2 className="mt-1 text-[18px] font-medium">Sell back to test USDC</h2>
              </div>
              <button
                onClick={() => setCashOut(null)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
              Redeems your basket assets on-chain and returns test USDC to your wallet. Settles at the strategy&apos;s
              on-chain published price, so the final amount may differ slightly.
            </p>
            <div className="mt-4 flex gap-2">
              {[25, 50, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => setCashOut(n)}
                  className={cn(
                    "flex-1 border px-3 py-2 font-mono text-[12px] tabular-nums transition-colors",
                    cashOut === n
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-grid)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]",
                  )}
                >
                  {n === 100 ? "All" : n + "%"}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-grid)] pt-4">
              <span className="bp-mono-label text-[9px]">Est. USDC back</span>
              <span className="font-mono text-[1.15rem] tabular-nums">≈ {fmtUsd(nonCashValue * (cashOut / 100))}</span>
            </div>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => {
                  d.sellBasket(cashOut / 100);
                  setCashOut(null);
                }}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 bg-[var(--color-accent)] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                Cash out {cashOut === 100 ? "everything" : cashOut + "%"}
              </button>
              <button
                onClick={() => setCashOut(null)}
                className="inline-flex h-10 items-center bg-[var(--color-soft)] px-5 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-soft-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

