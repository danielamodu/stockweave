// Live PreStocks grounding. StockWeave is built ON PreStocks tokenized pre-IPO
// stocks, so this panel calls the issuer's own catalogue API (/api/prestocks) and,
// per basket asset, proves our on-chain mint matches PreStocks' published
// contract_address and shows their official mark price + implied valuation. It's
// the live "we integrate PreStocks" check — verified against the source, not
// hardcoded. Honest states: loading, per-asset "not listed", API-unreachable degrade.
"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";

type Listing = {
  symbol: string;
  name: string;
  mint: string;
  markPrice: number | null;
  impliedValuation: number | null;
  supply: number | null;
  productUrl: string | null;
};
type Fact = {
  symbol: string;
  name: string;
  issuer: string;
  mint: string;
  mintVerified: boolean;
  listing: Listing | null;
};
type Facts = {
  endpoint: string;
  degraded: boolean;
  verifiedCount: number;
  total: number;
  assets: Fact[];
};

const EXPLORER = (a: string) => `https://explorer.solana.com/address/${a}`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function fmtPrice(n: number | null) {
  if (n == null) return "—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtValuation(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  return "$" + n.toLocaleString();
}

export function PreStocksLive({ symbols }: { symbols: string[] }) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch("/api/prestocks")
      .then((r) => r.json())
      .then((f: Facts) => {
        if (live) {
          setFacts(f);
          setStatus("ok");
        }
      })
      .catch(() => {
        if (live) setStatus("error");
      });
    return () => {
      live = false;
    };
  }, []);

  // The basket's tokenized stocks (skip the USDC cash leg), kept in basket order.
  const wanted = symbols.filter((s) => s !== "USDC");
  const bySym = new Map((facts?.assets ?? []).map((a) => [a.symbol, a]));
  const rows = wanted.map((s) => bySym.get(s)).filter((a): a is Fact => Boolean(a));
  const verifiedHere = rows.filter((a) => a.mintVerified).length;
  const degraded = Boolean(facts?.degraded);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="bp-mono-label text-[10px]">Verified live · PreStocks API</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
          {status === "loading"
            ? "checking prestocks…"
            : status === "error" || degraded
              ? "api unreachable"
              : `${verifiedHere}/${rows.length} mints verified`}
        </span>
      </div>

      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-[var(--color-muted)]">
        Checked live against PreStocks&apos; own catalogue API. Each asset&apos;s on-chain mint is matched to the
        issuer&apos;s published contract address, and its official mark price and implied valuation are read straight
        from <code className="font-mono text-[var(--color-ink)]">prestocks.com/api/prestocks</code> — not hardcoded here.
      </p>

      <div className="border border-[var(--color-grid)]">
        {status === "loading" ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : status === "error" ? (
          <p className="p-5 text-[13px] text-[var(--color-muted)]">
            Couldn&apos;t reach the PreStocks API. The mints in the mix are still the verified on-chain assets.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-[13px] text-[var(--color-muted)]">No PreStocks assets to show for this mix.</p>
        ) : (
          <ul>
            {rows.map((a) => {
              const L = a.listing;
              return (
                <li
                  key={a.symbol}
                  className="flex flex-col gap-3 border-b border-[var(--color-grid)] p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <AssetTile symbol={a.symbol} size={36} glyph={16} />
                    <div>
                      <div className="flex items-center gap-1.5 font-medium leading-tight">
                        {L?.name || a.name}
                        {a.mintVerified && (
                          <span
                            title="On-chain mint matches PreStocks' published contract address"
                            className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-accent)]"
                          >
                            <Check size={12} /> verified
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <a
                          href={a.mintVerified && L?.productUrl ? L.productUrl : EXPLORER(a.mint)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline"
                        >
                          {a.mintVerified ? "prestocks.com" : short(a.mint)} <ExternalLink size={11} />
                        </a>
                        {a.mintVerified && <span className="font-mono text-[10px] text-[var(--color-faint)]">{short(a.mint)}</span>}
                      </div>
                    </div>
                  </div>
                  {a.mintVerified && L ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[12px] sm:justify-end">
                      <span title="PreStocks official mark price">
                        <span className="bp-mono-label text-[10px]">Mark</span>{" "}
                        <b className="text-[var(--color-ink)]">{fmtPrice(L.markPrice)}</b>
                      </span>
                      <span title="PreStocks implied valuation of the underlying company">
                        <span className="bp-mono-label text-[10px]">Impl. val</span> {fmtValuation(L.impliedValuation)}
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--color-faint)]">not in PreStocks catalogue</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {degraded && (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-faint)]">
          Couldn&apos;t reach the PreStocks API for live marks; the addresses above are the verified on-chain assets.
        </p>
      )}
    </section>
  );
}
