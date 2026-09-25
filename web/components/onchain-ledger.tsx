"use client";

// On-chain ledger — the strategy's real audit trail, read straight from the
// chain. Every human or agent action leaves a signed transaction that touches
// the strategy account, so getSignaturesForAddress IS the history: timestamped,
// ordered, explorer-linkable, nothing invented in the browser. We classify each
// transaction by our own instruction discriminator so a row can say "Agent
// proposed" / "You approved" instead of a bare hash; anything we can't parse
// degrades to a neutral "On-chain action".
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Check,
  Coins,
  DollarSign,
  ExternalLink,
  GitFork,
  KeyRound,
  Layers,
  LineChart,
  Loader2,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { EXPLORER_TX, type LedgerAction, type LedgerEntry } from "@/lib/onchain";
import { cn } from "@/lib/utils";

// Human label + glyph per on-chain action. `tone` picks the dot colour: accent
// for the headline moments (agent proposing, you approving/executing), muted for
// the routine bookkeeping (price/nav/rules), so the eye lands on what matters.
const ACTION_META: Record<LedgerAction, { label: string; Icon: React.ComponentType<{ size?: number }>; tone: "accent" | "muted" }> = {
  create: { label: "Strategy created", Icon: Sparkles, tone: "accent" },
  fork: { label: "Forked", Icon: GitFork, tone: "accent" },
  propose: { label: "Agent proposed", Icon: Bot, tone: "accent" },
  approve: { label: "You approved", Icon: Check, tone: "accent" },
  execute: { label: "Executed on-chain", Icon: Zap, tone: "accent" },
  subscribe: { label: "Bought in", Icon: ArrowDownToLine, tone: "accent" },
  redeem: { label: "Cashed out", Icon: ArrowUpFromLine, tone: "accent" },
  price: { label: "Price published", Icon: DollarSign, tone: "muted" },
  nav: { label: "NAV recorded", Icon: LineChart, tone: "muted" },
  rules: { label: "Rules updated", Icon: SlidersHorizontal, tone: "muted" },
  assets: { label: "Assets set", Icon: Layers, tone: "muted" },
  grant: { label: "Agent permission set", Icon: KeyRound, tone: "muted" },
  faucet: { label: "Test USDC minted", Icon: Coins, tone: "muted" },
  other: { label: "On-chain action", Icon: Radio, tone: "muted" },
};

// Compact "3m ago" / "2h ago" / "5d ago" from a unix-seconds block time.
function timeAgo(blockTime: number | null): string {
  if (!blockTime) return "pending";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - blockTime));
  if (s < 45) return "just now";
  if (s < 90) return "1m ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

const short = (sig: string) => `${sig.slice(0, 6)}…${sig.slice(-6)}`;

function Row({ entry }: { entry: LedgerEntry }) {
  const meta = ACTION_META[entry.action] ?? ACTION_META.other;
  const { Icon } = meta;
  return (
    <li className="flex items-center gap-3 border-t border-[var(--color-grid)] py-2.5 first:border-t-0 bp-fade">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center border",
          entry.err
            ? "border-[color:var(--color-danger)]/40 text-[var(--color-danger)]"
            : meta.tone === "accent"
              ? "border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/[0.06] text-[var(--color-accent)]"
              : "border-[var(--color-grid)] text-[var(--color-muted)]",
        )}
      >
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-[var(--color-ink)]">{meta.label}</span>
          {entry.err && (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-danger)]">failed</span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-[var(--color-faint)]">{timeAgo(entry.blockTime)}</div>
      </div>
      <a
        href={EXPLORER_TX(entry.signature)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-accent)]"
      >
        {short(entry.signature)} <ExternalLink size={11} />
      </a>
    </li>
  );
}

// `strategy` is the base58 strategy account address. `refreshKey` lets a parent
// force a re-read after it lands a new transaction (approve, buy, fork, …).
export function OnchainLedger({
  strategy,
  limit = 8,
  refreshKey,
  className,
}: {
  strategy?: string | null;
  limit?: number;
  refreshKey?: number | string;
  className?: string;
}) {
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    if (!strategy) {
      setRows(null);
      setStatus("idle");
      return;
    }
    let live = true;
    setStatus("loading");
    setRows(null);
    // The classification (getSignaturesForAddress + a getParsedTransaction per
    // row) runs server-side at /api/ledger — off the render path, on the server
    // RPC, and short-cached — so it doesn't compete with the page's other on-chain
    // reads and burst the rate-limited RPC. One request, already classified.
    (async () => {
      try {
        const res = await fetch(`/api/ledger?strategy=${encodeURIComponent(strategy)}&limit=${limit}`);
        const d = await res.json();
        if (!live) return;
        if (!res.ok || !Array.isArray(d.entries)) {
          setStatus("error");
          return;
        }
        setRows(d.entries as LedgerEntry[]);
        setStatus("ok");
      } catch {
        if (live) setStatus("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [strategy, limit, refreshKey]);

  if (!strategy) return null;

  return (
    <div className={className}>
      {status === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-[var(--color-muted)]">
          <Loader2 size={15} className="animate-spin" /> Reading the on-chain ledger…
        </div>
      ) : status === "error" ? (
        <p className="py-4 text-[13px] text-[var(--color-danger)]">Couldn&apos;t read the ledger from Devnet.</p>
      ) : rows && rows.length > 0 ? (
        <ul>
          {rows.map((e) => (
            <Row key={e.signature} entry={e} />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-[13px] text-[var(--color-muted)]">
          No on-chain activity yet — actions on this strategy will show up here.
        </p>
      )}
    </div>
  );
}
