"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Wallet } from "lucide-react";
import { useSession } from "@/lib/session";
import { useWalletCancelled } from "@/lib/wallet-events";
import { BrandMark } from "@/components/brand-mark";
// Static import → Next gets the intrinsic size + auto blur placeholder, and
// serves a resized AVIF/WebP per device instead of the full-res source file.
import connectBg from "../../public/img/connect-bg.webp";

export default function ConnectPage() {
  const router = useRouter();
  const { wallet, ready, isConnecting, hadWallet, connect } = useSession();
  const cancelled = useWalletCancelled();
  const showCancelled = cancelled > 0 && !isConnecting;
  // A returning visitor (wallet-adapter remembers a wallet here) most likely
  // just needs to unlock it — autoConnect already tried and couldn't. Frame the
  // screen as "reconnect / unlock" rather than a cold first-time "connect".
  const returning = hadWallet && !showCancelled;

  // returning (already-connected) wallets skip straight to the dashboard
  useEffect(() => {
    if (ready && wallet) router.replace("/dashboard");
  }, [ready, wallet, router]);

  const onConnect = () => connect(); // opens the wallet picker; redirect happens once connected

  return (
    <main className="grid min-h-dvh grid-cols-1 grid-rows-[13rem_1fr] text-[var(--color-ink)] lg:grid-cols-2 lg:grid-rows-1">
      {/* ---- left: illustration panel ---- */}
      <div className="relative overflow-hidden bg-[var(--color-soft)]">
        <Image
          src={connectBg}
          alt=""
          aria-hidden
          fill
          preload
          placeholder="blur"
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover object-center"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-black/25" />
        <div className="relative z-10 flex h-full flex-col justify-between p-6 lg:p-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-white no-underline drop-shadow-sm"
          >
            <BrandMark size={24} priority />
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em]">Stockweave</span>
          </Link>
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
              {returning ? "Welcome back" : "Connect your wallet"}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
              {returning
                ? "Unlock your wallet to jump back into your strategy. You stay in control — nothing moves without your OK, and you can disconnect anytime."
                : "Connect to follow the strategy and approve changes. You stay in control — nothing moves without your OK, and you can disconnect anytime."}
            </p>

            <button
              type="button"
              onClick={onConnect}
              disabled={isConnecting}
              aria-busy={isConnecting}
              className="group relative mt-7 inline-flex h-11 w-full items-center justify-center gap-2 bg-[var(--color-accent)] text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)] disabled:cursor-wait disabled:opacity-80"
            >
              {isConnecting
                ? returning
                  ? "Reconnecting…"
                  : "Connecting…"
                : showCancelled
                  ? "Try again"
                  : returning
                    ? "Reconnect wallet"
                    : "Connect wallet"}
            </button>

            {returning && !isConnecting && (
              <p className="bp-fade mt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
                Already connected here before — if nothing happens, open your wallet extension and unlock it, then tap Reconnect.
              </p>
            )}

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
