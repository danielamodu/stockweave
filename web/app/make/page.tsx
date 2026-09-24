"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Loader2 } from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSession, type Mix } from "@/lib/session";
import { ASSET_LABEL, segTone } from "@/lib/present";
import { AssetTile } from "@/components/asset-logo";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import {
  createBasketOnchain,
  AGENT_PUBKEY,
  DEFAULT_NEW_RULES,
  EXPLORER,
  EXPLORER_TX,
  type NewBasketAsset,
} from "@/lib/onchain";
import { useWalletSender } from "@/lib/use-wallet-sender";

const MAX_SINGLE = 35; // no more than 35% in one company (matches on-chain cap)
const MIN_CASH = 10; // keep at least 10% in cash (matches on-chain reserve floor)

type Basket = {
  id: string;
  name: string;
  constituents: { symbol: string; targetBps: number }[];
};
type Phase = "idle" | "creating" | "done" | "error";

function MakeYourOwnView() {
  const router = useRouter();
  const params = useSearchParams();
  const basketId = params.get("basket") || "ai-infrastructure";
  const { wallet, ready, customMix, followedBasketId, setCustomMix } = useSession();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  // Sign in the wallet, broadcast through our own Devnet connection — see hook.
  const sendTransaction = useWalletSender();
  const { setVisible } = useWalletModal();

  const [basket, setBasket] = useState<Basket | null>(null);
  const [labs, setLabs] = useState<Record<string, number>>({});
  const [mints, setMints] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{ signature: string; strategy: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (ready && !wallet) router.replace("/connect");
  }, [ready, wallet, router]);

  // load the basket being forked
  useEffect(() => {
    let live = true;
    fetch("/api/baskets")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const b: Basket | undefined = (d.baskets || []).find((x: Basket) => x.id === basketId);
        if (b) setBasket(b);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [basketId]);

  // load the approved-asset registry → symbol→mint map (never fabricate a mint)
  useEffect(() => {
    let live = true;
    fetch("/api/assets")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const m: Record<string, string> = {};
        for (const a of d.assets || []) m[a.symbol] = a.mint;
        setMints(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // non-cash constituents drive the sliders
  const stocks = useMemo(() => (basket ? basket.constituents.filter((c) => c.symbol !== "USDC") : []), [basket]);

  // seed slider values: existing fork of THIS basket wins, else basket targets
  useEffect(() => {
    if (!basket) return;
    const seeded: Record<string, number> = {};
    const useCustom = customMix && followedBasketId === basketId;
    for (const c of stocks) {
      seeded[c.symbol] = useCustom && customMix[c.symbol] != null ? customMix[c.symbol] : Math.round(c.targetBps / 100);
    }
    setLabs(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket]);

  const assigned = stocks.reduce((sum, c) => sum + (labs[c.symbol] ?? 0), 0);
  const cash = 100 - assigned;
  const cashOk = cash >= MIN_CASH;
  const mintsReady = stocks.length > 0 && stocks.every((c) => Boolean(mints[c.symbol]));

  // Build + send a REAL Devnet create transaction (wallet-signed), then mirror
  // the mix locally and remember the on-chain account for the dashboard.
  const create = useCallback(async () => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    const assets: NewBasketAsset[] = [];
    for (const c of stocks) {
      const pct = labs[c.symbol] ?? 0;
      if (pct <= 0) continue;
      const mint = mints[c.symbol];
      if (!mint) {
        setErr(`No verified mint for ${c.symbol}.`);
        setPhase("error");
        return;
      }
      assets.push({ mint, targetBps: pct * 100 });
    }
    if (assets.length === 0) {
      setErr("Give at least one company a weight above 0%.");
      setPhase("error");
      return;
    }
    setPhase("creating");
    setErr("");
    try {
      const newId = `${basketId}-own-${Date.now().toString(36)}`.slice(0, 64);
      const res = await createBasketOnchain({
        connection,
        walletPublicKey: publicKey,
        sendTransaction,
        newId,
        assets,
        rules: { ...DEFAULT_NEW_RULES, reserveWeightBps: cash * 100 },
        agent: AGENT_PUBKEY ?? undefined,
      });
      const mix: Mix = { USDC: cash };
      for (const c of stocks) mix[c.symbol] = labs[c.symbol] ?? 0;
      setCustomMix(basketId, mix, { onchainId: newId, onchainStrategy: res.strategy });
      setResult(res);
      setPhase("done");
      toast("Your basket is live on-chain");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [publicKey, setVisible, stocks, labs, mints, basketId, connection, sendTransaction, cash, setCustomMix]);

  if (!ready || !wallet) return <div className="min-h-dvh bg-[var(--color-page)]" />;
  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 min-h-dvh border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.08em] no-underline text-[var(--color-ink)] transition-colors hover:text-[var(--color-accent)]">
            <ArrowLeft size={15} /> Back
          </Link>
          {basket && <span className="bp-mono-label text-[10px]">Forking · {basket.name}</span>}
        </div>

        <div className="mx-auto max-w-[620px] px-4 py-10 sm:px-6">
          <div className="bp-mono-label mb-2 text-[10px]">Make your own version</div>
          <h1 className="text-[clamp(1.7rem,3.4vw,2.2rem)] font-medium uppercase leading-[1.06] tracking-[-0.03em]">
            Set your own mix
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
            {basket ? (
              <>Start from {basket.name} and choose how much goes into each company. The rest stays in cash. When you create it, your wallet signs a real Devnet transaction that mints your own strategy account on-chain.</>
            ) : (
              <>Choose how much goes into each company. The rest stays in cash.</>
            )}
          </p>

          {/* live preview bar */}
          <div className="mt-8 flex h-3 w-full overflow-hidden border border-[var(--color-grid)]">
            {stocks.map((c, i) => (
              <span key={c.symbol} className="h-full" style={{ width: (labs[c.symbol] ?? 0) + "%", background: segTone(c.symbol, i) }} />
            ))}
            <span className="bp-hatch h-full border-l border-[var(--color-grid)]" style={{ width: Math.max(cash, 0) + "%" }} />
          </div>

          {/* sliders */}
          <div className="mt-6 space-y-5">
            {stocks.length === 0 ? (
              <div className="text-[13px] text-[var(--color-muted)]">Loading basket…</div>
            ) : (
              stocks.map((c, i) => (
                <div key={c.symbol}>
                  <div className="flex items-center justify-between text-[14px]">
                    <span className="inline-flex items-center gap-2.5 font-medium">
                      <AssetTile symbol={c.symbol} size={28} glyph={14} />
                      {ASSET_LABEL[c.symbol] ?? c.symbol}
                    </span>
                    <span className="font-mono tabular-nums">{labs[c.symbol] ?? 0}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_SINGLE}
                    step={1}
                    value={labs[c.symbol] ?? 0}
                    onChange={(e) => setLabs((l) => ({ ...l, [c.symbol]: Number(e.target.value) }))}
                    className="mt-2 w-full accent-[var(--color-accent)]"
                    aria-label={(ASSET_LABEL[c.symbol] ?? c.symbol) + " percentage"}
                  />
                </div>
              ))
            )}
            {/* cash (auto) */}
            <div className="border-t border-[var(--color-grid)] pt-4">
              <div className="flex items-center justify-between text-[14px]">
                <span className="inline-flex items-center gap-2 font-medium">
                  <span className="bp-hatch inline-block h-2.5 w-2.5 border border-[var(--color-grid)]" />
                  Cash
                </span>
                <span className={cn("font-mono", cashOk ? "text-[var(--color-ink)]" : "text-[var(--color-danger)]")}>{cash}%</span>
              </div>
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">Whatever you don&apos;t assign stays here.</p>
            </div>
          </div>
          {/* guardrails */}
          <div className="mt-6 space-y-1.5 font-mono text-[12px]">
            <div className={cn("flex items-center gap-2", cashOk ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]")}>
              <Check size={13} /> Keep at least {MIN_CASH}% in cash
            </div>
            <div className="flex items-center gap-2 text-[var(--color-accent)]">
              <Check size={13} /> No more than {MAX_SINGLE}% in any one company
            </div>
          </div>

          {/* create → real Devnet transaction, with success + error states */}
          {phase === "done" && result ? (
            <div className="mt-8 border border-[var(--color-accent)] bg-[color:var(--color-accent)]/[0.06] p-5">
              <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--color-accent)]">
                <Check size={16} /> Your basket is live on-chain.
              </div>
              <div className="mt-3 flex flex-col gap-1 font-mono text-[12px]">
                <a href={EXPLORER(result.strategy)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] no-underline hover:underline">
                  strategy account: {result.strategy.slice(0, 6)}…{result.strategy.slice(-6)} <ExternalLink size={12} />
                </a>
                <a href={EXPLORER_TX(result.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] no-underline hover:underline">
                  transaction: {result.signature.slice(0, 6)}…{result.signature.slice(-6)} <ExternalLink size={12} />
                </a>
              </div>
              <Link href="/dashboard" className="mt-5 inline-flex h-11 items-center gap-2 bg-[var(--color-accent)] px-6 text-[14px] font-medium text-white no-underline transition-colors hover:bg-[var(--color-accent-hover)]">
                Open dashboard
              </Link>
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={create}
                disabled={phase === "creating" || !cashOk || !mintsReady}
                className={cn(
                  "inline-flex h-11 items-center gap-2 px-6 text-[14px] font-medium text-white transition-colors duration-150",
                  phase !== "creating" && cashOk && mintsReady ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]" : "cursor-not-allowed bg-[var(--color-faint)]",
                )}
              >
                {phase === "creating" ? (
                  <><Loader2 size={15} className="animate-spin" /> Creating on-chain…</>
                ) : !publicKey ? (
                  <>Create my version (connect wallet)</>
                ) : (
                  <>Create my version</>
                )}
              </button>
              {!cashOk && <span className="text-[13px] text-[var(--color-danger)]">Leave at least {MIN_CASH}% in cash to continue.</span>}
              {phase === "error" && <span className="text-[13px] text-[var(--color-danger)]">Couldn&apos;t create: {err}</span>}
            </div>
          )}
          <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-muted)]">
            Creating mints a strategy account owned by your wallet — its rules and weights live on Devnet, readable by anyone. Needs a little Devnet SOL for rent.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function MakeYourOwn() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[var(--color-page)]" />}>
      <MakeYourOwnView />
    </Suspense>
  );
}
