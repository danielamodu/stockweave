"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { cn } from "@/lib/utils";
import { GridPlus } from "@/components/blueprint";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";
import { MainnetAssets } from "@/components/mainnet-assets";
import { PreStocksLive } from "@/components/prestocks-live";
import { DriftBar } from "@/components/dashboard/ui";
import { segTone } from "@/lib/present";
import { MarketStatus } from "@/components/market-status";
import {
  readOfficialStrategy,
  forkOfficialStrategy,
  EXPLORER,
  EXPLORER_TX,
  type OnchainStrategyState,
} from "@/lib/onchain";

/* ---------- types (loose — mirrors the engine payload) ---------- */
type PriceSnap = {
  symbol?: string;
  feedId?: string | null;
  price: number | null;
  source: string;
  publishTimeMs: number | null;
  ageSeconds: number | null;
  validity: string;
};
type Strategy = {
  dataMode: string;
  demoMode: string | null;
  basket?: { id: string; name: string; theme: string; description: string };
  tokenPrices: PriceSnap[];
  reference: PriceSnap;
  valuation: {
    markNAV: number;
    referenceNAV: number | null;
    premiumDiscount: number | string;
    state: string;
    reasonCodes: string[];
    currentWeights: Record<string, number>;
    targetWeights: Record<string, number>;
    proposalAllowed: boolean;
  };
};

const ASSET_META: Record<string, { name: string; issuer: string; chip: string }> = {
  OPENAI: { name: "OpenAI", issuer: "PreStocks", chip: "OA" },
  ANTHROPIC: { name: "Anthropic", issuer: "PreStocks", chip: "AN" },
  FIGUREAI: { name: "Figure AI", issuer: "PreStocks", chip: "FA" },
  SPACEX: { name: "SpaceX", issuer: "PreStocks", chip: "SX" },
  ANDURIL: { name: "Anduril", issuer: "PreStocks", chip: "AD" },
  NEURALINK: { name: "Neuralink", issuer: "PreStocks", chip: "NL" },
  USDC: { name: "USD Coin", issuer: "Centre", chip: "$" },
};

function metaFor(sym: string) {
  return ASSET_META[sym] || { name: sym, issuer: "PreStocks", chip: sym.slice(0, 2) };
}

const DEMOS = [
  ["fresh", "Fresh"],
  ["stale", "Stale data"],
  ["invalid-feed", "Invalid feed"],
  ["missing", "Missing reference"],
  ["drift", "Drift"],
  ["paused", "Paused"],
];

/* ---------- small blueprint pieces ---------- */
function Label({ children }: { children: React.ReactNode }) {
  return <div className="bp-mono-label mb-3 text-[10px]">{children}</div>;
}

function Panel({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative border border-[var(--color-grid)] p-5", className)}>
      <GridPlus omit={["top", "left"]} className="left-0 top-0" />
      <GridPlus omit={["top", "right"]} className="left-full top-0" />
      <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
      <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}

function StatePill({ state }: { state: string }) {
  const normal = state === "NORMAL";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 border px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        normal
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-danger)] text-[var(--color-danger)]",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "currentColor" }}
      />
      {state}
    </span>
  );
}

function fmtTime(ms: number | null) {
  return ms === null ? "n/a" : new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
}

/* ---------- valuation readout row ---------- */
function ReadoutRow({ label, snap }: { label: string; snap: PriceSnap }) {
  return (
    <li className="border-t border-[var(--color-grid)] py-2 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[var(--color-ink)]">{label}</span>
        <span className="text-[var(--color-accent)]">{snap.price === null ? "UNKNOWN" : "$" + snap.price}</span>
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-faint)]">
        src {snap.source} · {snap.ageSeconds === null ? "age n/a" : "age " + snap.ageSeconds + "s"} · {snap.validity}
      </div>
    </li>
  );
}

function StrategyView() {
  const params = useSearchParams();
  const routeParams = useParams();
  const basketId = String(routeParams?.id || "ai-infrastructure");
  const demo = params.get("demo") || "fresh";
  const [data, setData] = useState<Strategy | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [preview, setPreview] = useState(
    "Loaded fixture data. This panel previews loading, empty, and error states.",
  );

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch("/api/strategy?basket=" + encodeURIComponent(basketId) + "&demo=" + encodeURIComponent(demo))
      .then((r) => r.json())
      .then((s: Strategy) => {
        if (!live) return;
        if (!s || !s.valuation) {
          setStatus("error");
          return;
        }
        setData(s);
        setStatus("ok");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [basketId, demo]);

  const v = data?.valuation;
  const basketName = data?.basket?.name || "Strategy";
  const basketDesc =
    data?.basket?.description ||
    "A transparent, forkable tokenized-stock strategy — every asset, rule, and agent permission inspectable before you follow or fork.";
  const weightOrder = v ? Object.keys(v.targetWeights) : [];

  // --- real on-chain state + live fork (Devnet) ---
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [onchain, setOnchain] = useState<OnchainStrategyState | null>(null);
  const [forkPhase, setForkPhase] = useState<"idle" | "forking" | "done" | "error">("idle");
  const [forkResult, setForkResult] = useState<{ signature: string; forkStrategy: string } | null>(null);
  const [forkErr, setForkErr] = useState<string>("");

  useEffect(() => {
    let live = true;
    setOnchain(null);
    readOfficialStrategy(connection, basketId)
      .then((s) => live && setOnchain(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, basketId]);

  const onFork = useCallback(async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setForkPhase("forking");
    setForkErr("");
    try {
      const res = await forkOfficialStrategy({
        connection,
        walletPublicKey: publicKey,
        sendTransaction,
        basketId,
        newId: `${basketId}-fork-${Date.now().toString(36)}`,
      });
      setForkResult(res);
      setForkPhase("done");
    } catch (e: unknown) {
      setForkErr(e instanceof Error ? e.message : String(e));
      setForkPhase("error");
    }
  }, [publicKey, sendTransaction, connection, basketId, setVisible]);

  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 min-h-dvh border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        {/* top bar */}
        <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.08em] text-[var(--color-ink)] no-underline transition-colors hover:text-[var(--color-accent)]"
          >
            <ArrowLeft size={15} /> Stockweave
          </Link>
          <div className="flex items-center gap-4">
            <MarketStatus />
            <span className="bp-mono-label text-[10px]">Strategy · {basketName}</span>
          </div>
        </div>

        <div className="px-4 py-8 sm:px-8 lg:px-10">
          {/* header */}
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex items-center border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                data?.dataMode === "LIVE"
                  ? "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/[0.08] text-[var(--color-accent)]"
                  : "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/[0.08] text-[var(--color-warn)]",
              )}
            >
              Data_mode: {data?.dataMode === "LIVE" ? "Live (Jupiter)" : data ? "Fixture" : "…"}
            </span>
            <span className="inline-flex items-center border border-black/10 bg-black/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#505050]">
              No wallet required
            </span>
          </div>
          <h1 className="mt-5 font-sans text-[clamp(1.8rem,3.4vw,2.6rem)] font-medium uppercase leading-[1.06] tracking-[-0.03em]">
            {basketName} Basket
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
            {basketDesc} Every asset, rule, and agent permission is inspectable before you follow or fork.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <span className="bp-mono-label text-[10px]">Current state</span>
            {v ? <StatePill state={v.state} /> : <span className="font-mono text-[11px] text-[var(--color-faint)]">loading…</span>}
            {v && v.reasonCodes.length > 0 && (
              <span className="font-mono text-[11px] text-[var(--color-muted)]">{v.reasonCodes.join(" · ")}</span>
            )}
          </div>

          {/* assets */}
          <section className="mt-10">
            <Label>Assets &amp; weights</Label>
            <div className="relative border border-[var(--color-grid)]">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-[var(--color-grid)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                    <th className="px-4 py-3 text-left font-medium">Asset</th>
                    <th className="px-4 py-3 text-left font-medium">Issuer</th>
                    <th className="px-4 py-3 text-right font-medium">Target</th>
                    <th className="px-4 py-3 text-right font-medium">Current</th>
                    <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {weightOrder.map((sym, idx) => {
                    const meta = metaFor(sym);
                    const target = v ? (v.targetWeights[sym] ?? 0) / 100 : null;
                    const current = v ? (v.currentWeights[sym] ?? 0) / 100 : null;
                    return (
                      <tr key={sym} className="border-b border-[var(--color-grid)] last:border-b-0">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2.5 font-medium">
                            <AssetTile symbol={sym} size={28} glyph={14} className={sym === "USDC" ? "bp-hatch" : undefined} />
                            {meta.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">{meta.issuer}</td>
                        <td className="px-4 py-3 text-right font-mono">{target === null ? "—" : target + "%"}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--color-accent)]">
                          {current === null ? "—" : current + "%"}
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <div className="max-w-[150px]">
                            <DriftBar
                              current={current ?? 0}
                              target={target ?? 0}
                              tone={segTone(sym, idx)}
                              cash={sym === "USDC"}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
              <span className="relative inline-block h-3 w-6 bg-black/[0.07]">
                <span className="absolute inset-y-0 left-0 w-2/3 bg-[var(--color-accent)]" />
                <span className="absolute -top-0.5 -bottom-0.5 w-px bg-[var(--color-ink)]" style={{ left: "60%" }} />
              </span>
              Fill = current weight · tick = on-chain target
            </div>
          </section>

          {/* real tokenized-stock grounding — live mainnet mint facts */}
          <MainnetAssets symbols={weightOrder} />
          {/* live PreStocks API — mint verification + official mark price / valuation */}
          <PreStocksLive symbols={weightOrder} />

          {/* rules + agent */}
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel label="Rule set">
              <ul className="space-y-2 text-[14px] text-[var(--color-muted)]">
                <li><span className="text-[var(--color-ink)]">Maximum single asset</span> — 35%</li>
                <li><span className="text-[var(--color-ink)]">Minimum USDC reserve</span> — 10%</li>
                <li><span className="text-[var(--color-ink)]">Rebalance trigger</span> — 5 pp of drift</li>
                <li><span className="text-[var(--color-ink)]">Pyth maximum age</span> — 30 seconds</li>
                <li><span className="text-[var(--color-ink)]">Approval</span> — required for every action</li>
              </ul>
            </Panel>
            <Panel label="Agent permissions" className="scroll-mt-24" >
              <div id="agent" className="space-y-0">
                {[
                  ["READ", true],
                  ["PROPOSE", true],
                  ["EXECUTE", false],
                ].map(([k, on]) => (
                  <div key={k as string} className="flex items-center justify-between border-t border-[var(--color-grid)] py-2.5 first:border-t-0">
                    <span className="font-mono text-[12px] tracking-[0.06em] text-[var(--color-ink)]">{k as string}</span>
                    <span
                      className={cn(
                        "font-mono text-[11px] uppercase",
                        on ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]",
                      )}
                    >
                      {on ? "enabled" : "disabled"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
                The Clawpump agent (limit: observe + propose) can explain this strategy but cannot
                move funds. Execution arrives in a later phase, user-approved only.
              </p>
            </Panel>
          </section>

          {/* valuation */}
          <section className="mt-6">
            <Label>Valuation — Pyth-aware</Label>
            <p className="mb-4 max-w-[80ch] text-[13px] text-[var(--color-muted)]">
              Token prices come from the price adapter with source and timestamp. Reference prices
              come from Pyth where a verified feed exists — currently <code className="font-mono text-[var(--color-ink)]">UNKNOWN</code>,
              never estimated. Demo simulations are labelled and never presented as live market data.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel label="Token prices">
                {data ? (
                  <ul className="font-mono text-[12px] text-[var(--color-muted)]">
                    {data.tokenPrices.map((t) => (
                      <ReadoutRow key={t.symbol} label={t.symbol!} snap={t} />
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                )}
              </Panel>
              <Panel label="Reference prices (Pyth)">
                {data ? (
                  <>
                    <ul className="font-mono text-[12px] text-[var(--color-muted)]">
                      <ReadoutRow label={data.reference.feedId || "no verified feed"} snap={data.reference} />
                    </ul>
                    {data.demoMode && (
                      <p className="mt-3 border-l-2 border-[var(--color-warn)] pl-3 text-[12px] text-[var(--color-warn)]">
                        <strong>{data.demoMode}:</strong> simulated Pyth condition, not live market data.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                )}
              </Panel>
            </div>

            {/* NAV line */}
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border border-[var(--color-grid)] px-5 py-4 font-mono text-[13px]">
              {status === "error" ? (
                <span className="text-[var(--color-danger)]">
                  Could not load valuation data. Check your connection and retry.
                </span>
              ) : v ? (
                <>
                  <span><span className="bp-mono-label text-[10px]">Mark NAV</span> <b className="text-[var(--color-ink)]">${v.markNAV}</b></span>
                  <span><span className="bp-mono-label text-[10px]">Reference NAV</span> {v.referenceNAV === null ? "UNKNOWN" : "$" + v.referenceNAV}</span>
                  <span><span className="bp-mono-label text-[10px]">Premium/discount</span> {String(v.premiumDiscount)}</span>
                  <span><span className="bp-mono-label text-[10px]">Proposals</span> {v.proposalAllowed ? "allowed" : "blocked"}</span>
                </>
              ) : (
                <Skeleton className="h-4 w-72" />
              )}
            </div>

            {/* demo simulations */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="bp-mono-label mr-1 text-[10px]">Simulations</span>
              {DEMOS.map(([key, label]) => (
                <Link
                  key={key}
                  href={"/strategy/" + basketId + "?demo=" + key}
                  className={cn(
                    "border px-3 py-1 font-mono text-[11px] no-underline transition-colors",
                    demo === key
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-grid)] text-[var(--color-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]",
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          </section>

          {/* on-chain state + real fork */}
          <section className="mt-10">
            <Label>On-chain — Devnet</Label>
            <div className="relative border border-[var(--color-grid)] p-5">
              {onchain?.exists ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono text-[12px] text-[var(--color-muted)]">Strategy account (live)</span>
                    <a
                      href={EXPLORER(onchain.strategy)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--color-accent)] no-underline hover:underline"
                    >
                      {onchain.strategy.slice(0, 4)}…{onchain.strategy.slice(-4)} <ExternalLink size={12} />
                    </a>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
                    Read straight from the deployed program — these are enforced on-chain, not by this page:
                  </p>
                  <ul className="mt-2 grid gap-1.5 font-mono text-[12px] text-[var(--color-ink)] sm:grid-cols-2">
                    {onchain.rules && (
                      <>
                        <li>max single asset — {onchain.rules.maxSingleAssetWeightBps / 100}%</li>
                        <li>min reserve — {onchain.rules.reserveWeightBps / 100}%</li>
                        <li>rebalance drift — {onchain.rules.rebalanceDriftBps / 100} pp</li>
                        <li>max price age — {onchain.rules.maxPriceAgeSeconds}s</li>
                      </>
                    )}
                    {onchain.agentAllowedActions !== undefined && (
                      <li className="sm:col-span-2 mt-1 border-t border-[var(--color-grid)] pt-2">
                        agent — READ {onchain.agentAllowedActions & 1 ? "✓" : "✗"} · PROPOSE{" "}
                        {onchain.agentAllowedActions & 2 ? "✓" : "✗"} · EXECUTE{" "}
                        {onchain.agentAllowedActions & 4 ? "✓" : "✗ (disabled)"}
                      </li>
                    )}
                  </ul>
                </>
              ) : onchain ? (
                <p className="text-[13px] text-[var(--color-muted)]">
                  This strategy isn&apos;t seeded on this cluster yet.
                </p>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onFork}
                disabled={forkPhase === "forking" || !onchain?.exists}
                className={cn(
                  "inline-flex items-center gap-2 border px-5 py-2.5 text-[13px] font-medium no-underline transition-colors",
                  forkPhase === "forking" || !onchain?.exists
                    ? "cursor-not-allowed border-[var(--color-grid)] bg-[var(--color-soft)] text-[var(--color-muted)]"
                    : "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
                )}
              >
                {forkPhase === "forking" ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Forking on-chain…
                  </>
                ) : (
                  <>Fork this strategy on-chain{!publicKey && " (connect wallet)"}</>
                )}
              </button>
              <Link
                href={"/make?basket=" + basketId}
                className="text-[13px] text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                Customize the mix instead
              </Link>
            </div>

            {forkPhase === "done" && forkResult && (
              <div className="mt-4 border border-[var(--color-accent)] bg-[color:var(--color-accent)]/[0.06] p-4 text-[13px]">
                <div className="font-medium text-[var(--color-accent)]">Your fork is live on-chain.</div>
                <div className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
                  <a
                    href={EXPLORER(forkResult.forkStrategy)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[var(--color-accent)] no-underline hover:underline"
                  >
                    fork account: {forkResult.forkStrategy.slice(0, 6)}…{forkResult.forkStrategy.slice(-6)}{" "}
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href={EXPLORER_TX(forkResult.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[var(--color-accent)] no-underline hover:underline"
                  >
                    transaction: {forkResult.signature.slice(0, 6)}…{forkResult.signature.slice(-6)}{" "}
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            )}
            {forkPhase === "error" && (
              <p className="mt-3 text-[13px] text-[var(--color-danger)]">
                Fork failed: {forkErr}. Make sure your wallet is on Devnet with a little test SOL.
              </p>
            )}

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
              Forking creates your own independent strategy account owned by your wallet — the original creator has no
              control over it, and the rule template is copied into your own account. Needs a little Devnet SOL for rent.
            </p>
          </section>

          {/* page-state preview */}
          <section className="mt-10">
            <Label>Page states</Label>
            <div className="flex flex-wrap gap-2">
              {[
                ["Loading strategy data…", "Preview loading"],
                ["No strategy found for this identifier.", "Preview empty"],
                ["Could not load strategy data. Check your connection and retry.", "Preview error"],
                ["Loaded fixture data. This panel previews loading, empty, and error states.", "Reset"],
              ].map(([msg, btn]) => (
                <button
                  key={btn}
                  type="button"
                  onClick={() => setPreview(msg)}
                  className="border border-[var(--color-grid)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                >
                  {btn}
                </button>
              ))}
            </div>
            <div className="mt-3 border border-dashed border-[var(--color-grid-strong)] px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]" role="status">
              {preview}
            </div>
          </section>

          {/* disclosures */}
          <section className="mt-10 mb-4">
            <div className="border border-[var(--color-grid)] border-l-[3px] border-l-[var(--color-warn)] p-5 text-[13px] leading-relaxed text-[var(--color-muted)]">
              <strong className="text-[var(--color-ink)]">Risk and asset disclosures.</strong>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>Fixture data only (<code className="font-mono text-[var(--color-ink)]">DATA_MODE: FIXTURE</code>) — no live prices, no Pyth feed yet.</li>
                <li>
                  PreStocks tokens are SPV-backed economic exposure to pre-IPO companies,{" "}
                  <strong className="text-[var(--color-ink)]">not equity ownership</strong>: no shares, no voting rights,
                  no dividends, no guaranteed claim on basket assets, no regulated-ETF status, no profit guarantee.
                </li>
                <li>PreStocks route only. Tessera, xStocks, and other non-PreStocks pre-IPO assets are excluded from this submission.</li>
                <li>Known risks: issuer SPV-validity statements (May 2026), IPO-conversion uncertainty (e.g. SpaceX S-1), thin liquidity and exit risk, token/reference price divergence.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function StrategyPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[var(--color-page)]" />}>
      <StrategyView />
    </Suspense>
  );
}
