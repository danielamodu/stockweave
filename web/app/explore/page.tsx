"use client";

// The Weave — a public, no-wallet map of EVERY strategy the program has ever
// created and how they branch from the two official baskets. Read live from the
// deployed program on Devnet (getProgramAccounts, filtered to Strategy accounts),
// so it can't be faked: what you see is what's on-chain.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, GitFork, Loader2, RotateCw } from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { GridPlus } from "@/components/blueprint";
import { MarketStatus } from "@/components/market-status";
import { Skeleton } from "@/components/skeleton";
import {
  listAllStrategies,
  buildLineage,
  EXPLORER,
  PROGRAM_ID,
  type NetworkStrategy,
  type StrategyNode,
} from "@/lib/onchain";

// Friendly names for the official baskets (their on-chain id === the basket id).
const OFFICIAL_NAMES: Record<string, string> = {
  "ai-infrastructure": "AI Infrastructure",
  "space-deep-tech": "Space & Deep-Tech",
};
const PROGRAM = PROGRAM_ID.toBase58();
const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const nodeName = (n: NetworkStrategy) =>
  n.isOfficial ? OFFICIAL_NAMES[n.strategyId] ?? n.strategyId : n.strategyId;

function Badge({ tone, children }: { tone: "accent" | "muted" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
        tone === "accent" &&
          "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/[0.08] text-[var(--color-accent)]",
        tone === "muted" && "border-[var(--color-grid)] text-[var(--color-muted)]",
        tone === "warn" &&
          "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/[0.08] text-[var(--color-warn)]",
      )}
    >
      {children}
    </span>
  );
}

// One strategy in the lineage. Official baskets read as a titled card you can
// Inspect in-app; forks are their own on-chain accounts, linked to Explorer.
function NodeCard({ node }: { node: StrategyNode }) {
  const official = node.isOfficial;
  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-x-3 gap-y-2 border p-3.5",
        official
          ? "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/[0.04]"
          : "border-[var(--color-grid)] bg-[var(--color-page)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2.5 w-2.5 flex-none rounded-full",
          official ? "bg-[var(--color-accent)]" : "bg-[color:var(--color-ink)]/35",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("truncate", official ? "text-[15px] font-medium" : "font-mono text-[13px]")}>
            {nodeName(node)}
          </span>
          {official ? (
            <Badge tone="accent">Official</Badge>
          ) : node.isFork ? (
            <Badge tone="muted">Fork</Badge>
          ) : (
            <Badge tone="muted">Community</Badge>
          )}
          {node.status !== 0 && <Badge tone="warn">Paused</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--color-muted)]">
          <span>by {short(node.creator)}</span>
          {node.forkCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--color-ink)]">
              <GitFork size={11} /> {node.forkCount} fork{node.forkCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {official && (
          <Link
            href={`/strategy/${node.strategyId}`}
            className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent)] no-underline hover:underline"
          >
            Inspect
          </Link>
        )}
        <a
          href={EXPLORER(node.address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-ink)]"
        >
          {short(node.address)} <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

// A node and its fork subtree. The vertical thread is the left border on the
// children list; each child hangs off it with a short horizontal connector — a
// git-graph-style lineage that reads "this forked from that" at a glance.
function Node({ node, isRoot = false }: { node: StrategyNode; isRoot?: boolean }) {
  return (
    <li className="relative">
      {!isRoot && (
        <span aria-hidden className="absolute -left-4 top-6 h-px w-4 bg-[var(--color-grid-strong)]" />
      )}
      <NodeCard node={node} />
      {node.children.length > 0 && (
        <ul className="relative ml-4 mt-3 space-y-3 border-l border-[var(--color-grid-strong)] pl-4">
          {node.children.map((c) => (
            <Node key={c.address} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="font-mono text-[1.75rem] leading-none tracking-tight text-[var(--color-ink)]">{value}</div>
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</div>
    </div>
  );
}

export default function ExplorePage() {
  const { connection } = useConnection();
  const [rows, setRows] = useState<NetworkStrategy[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    setRows(null);
    // The Devnet RPC (via our proxy) can 502 on a cold first hit under load, so
    // retry a couple of times with backoff before surfacing the error — the page
    // should load itself, not make the visitor tap "Retry".
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await listAllStrategies(connection);
          if (!live) return;
          setRows(r);
          setStatus("ok");
          return;
        } catch {
          if (!live) return;
          if (attempt < 2) await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
        }
      }
      if (live) setStatus("error");
    })();
    return () => {
      live = false;
    };
  }, [connection, nonce]);

  const lineage = useMemo(() => (rows ? buildLineage(rows) : []), [rows]);
  const stats = useMemo(
    () =>
      rows
        ? { total: rows.length, forks: rows.filter((r) => r.isFork).length, creators: new Set(rows.map((r) => r.creator)).size }
        : null,
    [rows],
  );

  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 min-h-dvh border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.08em] text-[var(--color-ink)] no-underline transition-colors hover:text-[var(--color-accent)]"
          >
            <ArrowLeft size={15} /> Stockweave
          </Link>
          <div className="flex items-center gap-4">
            <MarketStatus />
            <span className="bp-mono-label text-[10px]">The Weave</span>
          </div>
        </div>
        <div className="px-4 py-10 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center border border-black/10 bg-black/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#505050]">
              No wallet required
            </span>
            <span className="inline-flex items-center gap-1.5 border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent)]">
              <span className="bp-pulse h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> Live from Devnet
            </span>
          </div>
          <h1 className="mt-5 font-sans text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium uppercase leading-[1.05] tracking-[-0.03em]">
            The Weave
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
            Every strategy on StockWeave — the official baskets and every fork anyone has made of them — read
            straight from the program on-chain. Follow the threads to see how one basket branches into many.
            Nothing here is a mock-up: each node is a real strategy account you can open in Explorer.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-12 gap-y-4 border-y border-[var(--color-grid)] py-5">
            {stats ? (
              <>
                <Stat value={stats.total} label="Strategies on-chain" />
                <Stat value={stats.forks} label="Forks" />
                <Stat value={stats.creators} label="Creators" />
              </>
            ) : (
              <Skeleton className="h-10 w-72" />
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" /> Official basket
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-ink)]/35" /> Community &amp; forks
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-px w-5 bg-[var(--color-grid-strong)]" /> forked from
            </span>
          </div>
          <div className="relative mt-8 border border-[var(--color-grid)] p-5 sm:p-7">
            <GridPlus omit={["top", "left"]} className="left-0 top-0" />
            <GridPlus omit={["top", "right"]} className="left-full top-0" />
            <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
            <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
            {status === "error" ? (
              <div className="py-10 text-center">
                <p className="text-[14px] text-[var(--color-danger)]">Couldn&apos;t read the network from Devnet.</p>
                <button
                  onClick={() => setNonce((n) => n + 1)}
                  className="mt-4 inline-flex items-center gap-2 border border-[var(--color-grid)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                >
                  <RotateCw size={13} /> Retry
                </button>
              </div>
            ) : status === "loading" ? (
              <div className="flex items-center gap-3 py-10 text-[13px] text-[var(--color-muted)]">
                <Loader2 size={16} className="animate-spin" /> Reading strategies from the program…
              </div>
            ) : lineage.length === 0 ? (
              <p className="py-10 text-center text-[14px] text-[var(--color-muted)]">
                No strategies on this cluster yet.
              </p>
            ) : (
              <ul className="space-y-6">
                {lineage.map((root) => (
                  <Node key={root.address} node={root} isRoot />
                ))}
              </ul>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[60ch] font-mono text-[11px] leading-relaxed text-[var(--color-faint)]">
              Source: getProgramAccounts on{" "}
              <a
                href={EXPLORER(PROGRAM)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                {short(PROGRAM)}
              </a>{" "}
              (Devnet), filtered to Strategy accounts. Fork lineage is derived from each account&apos;s on-chain parent.
            </p>
            <div className="flex flex-none flex-wrap gap-2.5">
              <Link
                href="/strategy/ai-infrastructure"
                className="inline-flex h-10 items-center bg-[var(--color-soft)] px-4 text-[13px] font-medium text-[var(--color-ink)] no-underline transition-colors hover:bg-[var(--color-soft-hover)]"
              >
                Inspect a basket
              </Link>
              <Link
                href="/make"
                className="inline-flex h-10 items-center bg-[var(--color-accent)] px-4 text-[13px] font-medium text-white no-underline transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                Make your own
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
