"use client";

// Shared presentational pieces for the dashboard shell and its pages.
// Pure/presentational — no session, router or data fetching lives here so the
// Overview / Holdings / Assistant routes can all reuse the same vocabulary.
import Link from "next/link";
import { ArrowUp, ArrowDown } from "lucide-react";
import { ASSET_LABEL, pct, segTone } from "@/lib/present";
import { GridPlus } from "@/components/blueprint";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";
import { cn } from "@/lib/utils";

export type PriceSnap = {
  symbol?: string;
  price: number | null;
  priceChange24h?: number | null;
  validity?: string;
  source?: string;
};
export type Strategy = {
  demoMode: string | null;
  basket?: { id: string; name: string; theme: string; description: string };
  dataMode?: string;
  tokenPrices?: PriceSnap[];
  valuation: {
    markNAV: number;
    state: string;
    change24hPct?: number | null;
    currentWeights: Record<string, number>;
    targetWeights: Record<string, number>;
  };
};
export type Agent = {
  agentId?: string;
  permission?: { allowedActions: number; maxNotionalPerAction: number; maxDailyNotional: number; revoked: boolean };
  decision: { action?: string; trades?: { symbol: string; notionalUsd: number }[] };
};
export type Basket = {
  id: string;
  name: string;
  theme: string;
  description: string;
  constituents: { symbol: string; targetBps: number; mint?: string | null }[];
};

export const BASELINE = 10000; // on-target starting value (model portfolio)

export function fmtUsd(n: number, max = 2) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: max, maximumFractionDigits: max });
}

// Bordered blueprint card with the four corner plus-marks.
export function Card({
  children,
  className,
  style,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <div id={id} style={style} className={cn("relative border border-[var(--color-grid)] p-5 sm:p-6", className)}>
      <GridPlus omit={["top", "left"]} className="left-0 top-0" />
      <GridPlus omit={["top", "right"]} className="left-full top-0" />
      <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
      <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
      {children}
    </div>
  );
}

export function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="bp-mono-label text-[10px]">{children}</div>
      {right}
    </div>
  );
}

// Green up / red down — used only for market change (see globals --color-up/down).
export function ChangeBadge({ value, className, size = 11 }: { value?: number | null; className?: string; size?: number }) {
  if (value == null) return <span className={cn("font-mono text-[var(--color-faint)]", className)}>—</span>;
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono tabular-nums",
        up ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
        className,
      )}
    >
      {up ? <ArrowUp size={size} strokeWidth={2.5} /> : <ArrowDown size={size} strokeWidth={2.5} />}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}
// __UI_APPEND__

// Allocation ring. Segments are drawn clockwise from 12 o'clock; the track
// behind them is a hairline circle so cash (drawn muted) still reads as "held".
export function Donut({
  segments,
  size = 132,
  stroke = 13,
}: {
  segments: { key: string; pct: number; color: string }[];
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-grid)" strokeWidth={stroke} />
      {segments.map((s) => {
        const len = (Math.max(s.pct, 0) / 100) * c;
        const node = (
          <circle
            key={s.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-acc}
          />
        );
        acc += len;
        return node;
      })}
    </svg>
  );
}

// KPI band — one bordered grid; cells share hairlines via collapsing borders.
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid grid-cols-2 border-l border-t border-[var(--color-grid)] sm:grid-cols-4">
      <GridPlus omit={["top", "left"]} className="left-0 top-0" />
      <GridPlus omit={["top", "right"]} className="left-full top-0" />
      <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
      <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
      {children}
    </div>
  );
}

export function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="border-b border-r border-[var(--color-grid)] p-4 sm:p-5">
      <div className="bp-mono-label text-[9px]">{label}</div>
      <div className="mt-2 font-mono text-[1.45rem] leading-none tabular-nums sm:text-[1.7rem]">{value}</div>
      {sub != null && <div className="mt-2 min-h-[1em] text-[11px] text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}
// __UI_APPEND2__

// One live-recorded NAV snapshot (nav_u in USDC micro-units, read off-chain).
export type NavPointUi = { ts: number; navU: number };
export type NavSeriesUi = { count: number; points: NavPointUi[] };

// Forward-tracked, on-chain proof-of-return. NAV is rebased to the first recorded
// snapshot (a since-launch index), so the panel is honest about being live-tracked
// from launch — NOT a backtest. Empty and single-point states say exactly that.
export function PerformancePanel({ series, loading }: { series: NavSeriesUi | null; loading: boolean }) {
  const pts = series?.points ?? [];
  const n = pts.length;
  const base = n > 0 ? pts[0].navU : 0;
  const last = n > 0 ? pts[n - 1].navU : 0;
  const sinceLaunch = base > 0 ? (last / base - 1) * 100 : null;
  const since =
    n > 0 ? new Date(pts[0].ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const subtitle = n === 0 ? "Recorded forward from launch" : `${n} snapshot${n === 1 ? "" : "s"} · since ${since}`;

  return (
    <Card>
      <Label
        right={
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
            On-chain · live-recorded
          </span>
        }
      >
        Performance
      </Label>
      {loading && series === null ? (
        <Skeleton className="h-[92px] w-full" />
      ) : n >= 2 ? (
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div
                className={cn(
                  "font-mono text-[1.7rem] leading-none tabular-nums",
                  sinceLaunch! >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
                )}
              >
                {sinceLaunch! >= 0 ? "+" : ""}
                {sinceLaunch!.toFixed(2)}%
              </div>
              <div className="mt-2 bp-mono-label text-[9px]">Since launch</div>
            </div>
            <div className="text-right font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
              <div className="tabular-nums">{fmtUsd(last / base, 4)}</div>
              <div className="text-[var(--color-faint)]">per $1.00 at launch</div>
            </div>
          </div>
          <NavSparkline points={pts} up={sinceLaunch! >= 0} />
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">{subtitle}</div>
        </div>
      ) : (
        // 0 or 1 real points: never draw a fake curve — state the honest status.
        <div className="py-2">
          <div className="font-mono text-[1.7rem] leading-none tabular-nums text-[var(--color-muted)]">
            {n === 1 ? "0.00%" : "—"}
          </div>
          <div className="mt-2 bp-mono-label text-[9px]">Since launch</div>
          <p className="mt-3 max-w-[46ch] text-[12px] leading-relaxed text-[var(--color-muted)]">
            {n === 1
              ? `Tracking started ${since}. The return line fills in as more on-chain snapshots are recorded — no history is back-filled.`
              : "NAV is recorded on-chain going forward from launch. Pre-IPO assets have no honest price history to back-test, so the track record starts empty and accumulates real snapshots."}
          </p>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">{subtitle}</div>
        </div>
      )}
    </Card>
  );
}

// Minimal blueprint sparkline: a rebased NAV line with a dashed launch baseline.
// viewBox is unitless + preserveAspectRatio none so it stretches to the card; the
// stroke stays hairline-crisp via vector-effect.
function NavSparkline({ points, up }: { points: NavPointUi[]; up: boolean }) {
  const W = 100;
  const H = 34;
  const vals = points.map((p) => p.navU);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - min) / span) * (H - 4) - 2; // 2px padding top/bottom
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(p.navU).toFixed(2)}`).join(" ");
  const baseY = y(points[0].navU);
  const stroke = up ? "var(--color-up)" : "var(--color-down)";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-4 h-16 w-full border border-[var(--color-grid)] bg-[var(--color-soft)]/40"
      role="img"
      aria-label="NAV since launch"
    >
      <line
        x1="0"
        y1={baseY}
        x2={W}
        y2={baseY}
        stroke="var(--color-grid-strong)"
        strokeWidth="0.5"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// weights are in basis points (bps); order is the symbol sequence to render.
export function MixBar({ order, weights }: { order: string[]; weights: Record<string, number> }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden border border-[var(--color-grid)]">
        {order.map((s, i) => {
          const w = pct(weights[s] ?? 0);
          if (s === "USDC") {
            return <span key={s} className="bp-hatch h-full border-l border-[var(--color-grid)]" style={{ width: w + "%" }} />;
          }
          return <span key={s} className="h-full" style={{ width: w + "%", background: segTone(s, i) }} />;
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
        {order.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
            <span
              className={cn("inline-block h-2 w-2", s === "USDC" && "bp-hatch border border-[var(--color-grid)]")}
              style={s === "USDC" ? undefined : { background: segTone(s, i) }}
            />
            {ASSET_LABEL[s] ?? s} {pct(weights[s] ?? 0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// Turn a basket's constituents into a bps weight map + render order.
export function basketMix(b: Basket) {
  const order = b.constituents.map((c) => c.symbol);
  const weights: Record<string, number> = {};
  for (const c of b.constituents) weights[c.symbol] = c.targetBps;
  return { order, weights };
}
// __UI_APPEND3__

// One holdings row: logo · price · 24h · position value · weight bar.
export function HoldingRow({
  sym,
  weightPct,
  snap,
  live,
  total,
  value: valueProp,
  i,
}: {
  sym: string;
  weightPct: number;
  snap?: PriceSnap;
  live: boolean;
  total: number;
  value?: number;
  i: number;
}) {
  const isCash = sym === "USDC";
  const thin = snap?.validity === "LOW_LIQUIDITY";
  // Real position value when the wallet's holdings are known; otherwise fall
  // back to the target-weight slice of the total.
  const value = valueProp ?? total * (weightPct / 100);
  return (
    <li className="bp-row flex items-center gap-3 border-b border-[var(--color-grid)] px-2 py-3 last:border-b-0 sm:px-3">
      <AssetTile symbol={sym} size={36} glyph={16} className={isCash ? "bp-hatch" : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-medium leading-tight">
          {ASSET_LABEL[sym] ?? sym}
          {thin && (
            <span className="border border-[var(--color-warn)]/40 px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--color-warn)]">
              thin
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
          {isCash ? "Reserve" : sym}
        </div>
      </div>
      <div className="hidden w-[88px] text-right font-mono text-[13px] tabular-nums sm:block">
        {isCash ? "$1.00" : snap?.price != null ? fmtUsd(snap.price) : "—"}
      </div>
      <div className="w-[74px] text-right text-[11px]">
        {isCash ? (
          <span className="font-mono text-[var(--color-faint)]">stable</span>
        ) : (
          <ChangeBadge value={live ? snap?.priceChange24h : null} className="justify-end text-[11px]" />
        )}
      </div>
      <div className="w-[92px] text-right font-mono text-[13px] tabular-nums">{fmtUsd(value, 0)}</div>
      <div className="hidden w-[130px] sm:block">
        <div className="flex items-baseline justify-between font-mono text-[11px]">
          <span className="text-[var(--color-faint)]">wt</span>
          <span className="tabular-nums">{weightPct}%</span>
        </div>
        <span className="mt-1.5 block h-1.5 w-full bg-black/[0.07]">
          <span
            className={cn("bp-grow block h-full", isCash && "bp-hatch border-r border-[var(--color-grid)]")}
            style={{ width: weightPct + "%", background: isCash ? undefined : segTone(sym, i), animationDelay: i * 60 + "ms" }}
          />
        </span>
      </div>
    </li>
  );
}
// __UI_APPEND4__

// Per-asset live breakdown, table-style with a header row.
export function Holdings({
  order,
  weights,
  prices,
  live,
  total,
  values,
}: {
  order: string[];
  weights: Record<string, number>;
  prices: Record<string, PriceSnap>;
  live: boolean;
  total: number;
  values?: Record<string, number> | null;
}) {
  return (
    <div>
      <div className="hidden items-center gap-3 border-b border-[var(--color-grid)] px-2 pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-faint)] sm:flex sm:px-3">
        <span className="flex-1">Asset</span>
        <span className="w-[88px] text-right">Price</span>
        <span className="w-[74px] text-right">24h</span>
        <span className="w-[92px] text-right">Value</span>
        <span className="w-[130px] text-right">Weight</span>
      </div>
      <ul>
        {order.map((sym, i) => (
          <HoldingRow
            key={sym}
            sym={sym}
            weightPct={pct(weights[sym] ?? 0)}
            snap={prices[sym]}
            live={live}
            total={total}
            value={values ? values[sym] ?? 0 : undefined}
            i={i}
          />
        ))}
      </ul>
    </div>
  );
}
// __UI_APPEND5__

// A basket tile on the browse screen — ring + logos + mix + follow.
export function BasketCard({ b, idx, onFollow }: { b: Basket; idx: number; onFollow: (b: Basket) => void }) {
  const mix = basketMix(b);
  const stocks = b.constituents.filter((c) => c.symbol !== "USDC");
  const cash = pct(b.constituents.find((c) => c.symbol === "USDC")?.targetBps ?? 0);
  const maxCap = stocks.length ? Math.max(...stocks.map((c) => pct(c.targetBps))) : 0;
  const segs = mix.order.map((s, i) => ({
    key: s,
    pct: pct(mix.weights[s] ?? 0),
    color: s === "USDC" ? "var(--color-grid-strong)" : segTone(s, i),
  }));
  return (
    <Card className="bp-enter flex flex-col" style={{ animationDelay: idx * 70 + "ms" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[17px] font-medium uppercase tracking-[-0.01em]">{b.name}</div>
          <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">{b.theme}</div>
        </div>
        <Link
          href={"/strategy/" + b.id}
          className="shrink-0 text-[12px] text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
        >
          Details
        </Link>
      </div>
      <div className="mt-5 flex items-center gap-5">
        <div className="relative grid shrink-0 place-items-center" style={{ width: 96, height: 96 }}>
          <Donut segments={segs} size={96} stroke={11} />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-mono text-[15px] leading-none tabular-nums">
                {stocks.length}
                <span className="text-[var(--color-faint)]">+1</span>
              </div>
              <div className="bp-mono-label mt-0.5 text-[7px]">Assets</div>
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-2.5">
          <div className="flex -space-x-2">
            {stocks.slice(0, 4).map((c) => (
              <AssetTile key={c.symbol} symbol={c.symbol} size={30} glyph={14} className="ring-1 ring-white" />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--color-muted)]">
            <span>{cash}% cash</span>
            <span>capped {maxCap}%</span>
          </div>
        </div>
      </div>
      <div className="mt-5">
        <MixBar order={mix.order} weights={mix.weights} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--color-grid)] pt-4">
        <button
          onClick={() => onFollow(b)}
          className="inline-flex h-10 items-center gap-2 bg-[var(--color-accent)] px-5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
        >
          Follow this strategy
        </button>
        <span className="text-[12px] text-[var(--color-muted)]">Approve every change · yours to fork</span>
      </div>
    </Card>
  );
}
// __UI_APPEND6__

// Browse screen (not following yet) — pick a basket.
export function BrowseView({ baskets, onFollow }: { baskets: Basket[]; onFollow: (b: Basket) => void }) {
  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="bp-mono-label text-[10px]">Strategies to follow</div>
      <h1 className="mt-1 text-[clamp(1.8rem,3.6vw,2.4rem)] font-medium uppercase leading-[1.06] tracking-[-0.03em]">
        Pick a basket
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
        Each basket is a simple, transparent mix of tokenized pre-IPO stocks with a slice kept in cash.
        An assistant watches it and suggests tune-ups; you approve every one.
      </p>

      <div className="mt-8 bp-mono-label text-[10px]">How it works</div>
      <ol className="mt-3 grid border border-[var(--color-grid)] sm:grid-cols-3">
        {[
          { n: "01", t: "Pick a basket", d: "A transparent mix of tokenized pre-IPO stocks with a slice kept in cash." },
          { n: "02", t: "Fund & deposit", d: "Grab test USDC on Devnet, then deposit into the mix at live prices — you hold every token." },
          { n: "03", t: "Approve tune-ups", d: "An assistant proposes rebalances; you sign off on each. It can read and propose, never move funds." },
        ].map((s, i) => (
          <li key={s.n} className={cn("p-5", i > 0 && "border-t border-[var(--color-grid)] sm:border-l sm:border-t-0")}>
            <div className="font-mono text-[11px] tabular-nums text-[var(--color-accent)]">{s.n}</div>
            <div className="mt-2 text-[14px] font-medium">{s.t}</div>
            <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">{s.d}</div>
          </li>
        ))}
      </ol>

      {baskets.length === 0 ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {baskets.map((b, idx) => (
            <BasketCard key={b.id} b={b} idx={idx} onFollow={onFollow} />
          ))}
        </div>
      )}
      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
        Demo · test network · no real funds
      </p>
    </div>
  );
}







