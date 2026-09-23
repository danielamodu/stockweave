// Real tokenized-stock grounding for a basket. The demo trades Devnet mirror
// tokens, but the assets a basket represents are the real PreStocks tokens on
// Solana mainnet. This panel reads their live mainnet state (via /api/mainnet-assets)
// — standard, decimals, supply, transfer fee, issuer controls — so the mix is
// provably pointed at the genuine on-chain asset, not just a ticker. Honest
// states: loading, per-asset degrade (address kept), and a whole-read error.
"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AssetTile } from "@/components/asset-logo";
import { Skeleton } from "@/components/skeleton";

type Onchain = {
  program: "Token-2022" | "SPL Token";
  decimals: number;
  supplyRaw: string;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  transferFeeBps: number | null;
  controls: string[];
  metadata: { name: string; symbol: string; uri: string } | null;
};
type Fact = {
  symbol: string;
  name: string;
  issuer: string;
  mint: string;
  registryDecimals: number;
  onchain: Onchain | null;
};
type Facts = { degraded: boolean; error?: string; assets: Fact[] };

const MAINNET_EXPLORER = (addr: string) => `https://explorer.solana.com/address/${addr}`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fmtSupply = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 });

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-[var(--color-grid)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
      {children}
    </span>
  );
}

export function MainnetAssets({ symbols }: { symbols: string[] }) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch("/api/mainnet-assets")
      .then((r) => r.json())
      .then((f: Facts) => {
        if (!live) return;
        setFacts(f);
        setStatus("ok");
      })
      .catch(() => {
        if (live) setStatus("error");
      });
    return () => {
      live = false;
    };
  }, []);

  // Only the tokenized stocks (skip the USDC cash leg), kept in the basket's order.
  const wanted = symbols.filter((s) => s !== "USDC");
  const bySym = new Map((facts?.assets ?? []).map((a) => [a.symbol, a]));
  const rows = wanted.map((s) => bySym.get(s)).filter((a): a is Fact => Boolean(a));
  const degraded = Boolean(facts?.degraded);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="bp-mono-label text-[10px]">Tokenized on Solana · Mainnet</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
          {status === "loading"
            ? "reading mainnet…"
            : status === "error" || degraded
              ? "verified addresses"
              : "live · mainnet"}
        </span>
      </div>

      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-[var(--color-muted)]">
        The real PreStocks tokens on Solana <strong className="text-[var(--color-ink)]">mainnet</strong> that this
        basket represents. Identity, supply, and issuer controls are read live from mainnet; the demo itself trades
        Devnet mirrors of them, so no mainnet funds are ever at risk.
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
            Couldn&apos;t load mainnet asset facts. The mints are still the verified on-chain assets in the mix.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-[13px] text-[var(--color-muted)]">No tokenized assets to show for this mix.</p>
        ) : (
          <ul>
            {rows.map((a) => {
              const oc = a.onchain;
              const name = oc?.metadata?.name || a.name;
              return (
                <li
                  key={a.symbol}
                  className="flex flex-col gap-3 border-b border-[var(--color-grid)] p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <AssetTile symbol={a.symbol} size={36} glyph={16} />
                    <div>
                      <div className="font-medium leading-tight">{name}</div>
                      <a
                        href={MAINNET_EXPLORER(a.mint)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline"
                      >
                        {short(a.mint)} <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                  {oc ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[12px] sm:justify-end">
                      <span title="Tokenized shares outstanding on mainnet">
                        <span className="bp-mono-label text-[10px]">Supply</span>{" "}
                        <b className="text-[var(--color-ink)]">{fmtSupply(oc.supplyUi)}</b>
                      </span>
                      <span>
                        <span className="bp-mono-label text-[10px]">Dec</span> {oc.decimals}
                      </span>
                      {oc.transferFeeBps != null && (
                        <span>
                          <span className="bp-mono-label text-[10px]">Fee</span> {oc.transferFeeBps / 100}%
                        </span>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip>{oc.program}</Chip>
                        {oc.controls.map((c) => (
                          <Chip key={c}>{c}</Chip>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--color-faint)]">mainnet unreachable — address verified</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {degraded && (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-faint)]">
          Couldn&apos;t reach mainnet for live figures; the addresses above are the verified on-chain assets.
        </p>
      )}
    </section>
  );
}
