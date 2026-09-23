"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { useSession } from "@/lib/session";
import { useWalletCancelled } from "@/lib/wallet-events";

export default function ConnectPage() {
  const router = useRouter();
  const { wallet, ready, isConnecting, connect } = useSession();
  const cancelled = useWalletCancelled();
  const showCancelled = cancelled > 0 && !isConnecting;

  // returning (already-connected) wallets skip straight to the dashboard
  useEffect(() => {
    if (ready && wallet) router.replace("/dashboard");
  }, [ready, wallet, router]);

  const onConnect = () => connect(); // opens the wallet picker; redirect happens once connected

  return (
    <main className="grid min-h-dvh grid-cols-1 grid-rows-[13rem_1fr] text-[var(--color-ink)] lg:grid-cols-2 lg:grid-rows-1">
      {/* ---- left: illustration panel ---- */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/img/connect-bg.webp')" }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-black/25" />
        <div className="relative z-10 flex h-full flex-col justify-between p-6 lg:p-10">
          <div className="flex items-center gap-2 text-white drop-shadow-sm">
            <span className="inline-grid h-6 w-6 place-items-center border border-white/40 font-mono text-[11px] font-bold">SW</span>
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em]">Stockweave</span>
          </div>
          <p className="hidden max-w-[16ch] text-[clamp(1.5rem,2.2vw,2.25rem)] font-medium uppercase leading-[1.08] tracking-[-0.03em] text-white drop-shadow-sm lg:block">
            Inspect, simulate, fork &amp; follow.
          </p>
        </div>
      </div>

      {/* ---- right: form panel ---- */}
      <div className="relative flex flex-col bg-[var(--color-page)]">
        <div className="px-6 pt-6 sm:px-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-ink)]"
          >
            <ArrowLeft size={14} /> Back
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-14 sm:px-10">
          <div className="bp-enter w-full max-w-[380px]">
            <div className="mb-6 inline-grid h-10 w-10 place-items-center border border-[var(--color-grid)] text-[var(--color-accent)]">
              <Wallet size={18} />
            </div>
            <h1 className="text-[26px] font-medium uppercase leading-tight tracking-[-0.03em]">
              Connect your wallet
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
              Connect to follow the strategy and approve changes. You stay in control — nothing moves
              without your OK, and you can disconnect anytime.
            </p>

            <button
              type="button"
              onClick={onConnect}
              disabled={isConnecting}
              aria-busy={isConnecting}
              className="group relative mt-7 inline-flex h-11 w-full items-center justify-center gap-2 bg-[var(--color-accent)] text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)] disabled:cursor-wait disabled:opacity-80"
            >
              {isConnecting ? "Connecting…" : showCancelled ? "Try again" : "Connect wallet"}
            </button>

            {showCancelled && (
              <p
                role="alert"
                className="bp-fade mt-3 border-l-2 border-[var(--color-warn)] bg-[color:var(--color-warn)]/[0.06] px-3 py-2 text-[12px] text-[var(--color-warn)]"
              >
                Connection cancelled — no problem. Tap Try again when you&apos;re ready.
              </p>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}
