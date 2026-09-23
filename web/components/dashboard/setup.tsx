"use client";

// First-run setup for a freshly picked basket. On Devnet the wallet starts with
// nothing, so before a basket goes "live" we walk the user through the two REAL
// on-chain steps: mint test USDC (faucet), then deposit it into the mix. Both are
// wallet-signed and non-custodial. The moment the wallet holds a non-cash asset
// the parent route swaps this out for the full overview (see dashboard/page.tsx).
import { Check, Coins, ShoppingCart } from "lucide-react";
import { useDashboard } from "@/components/dashboard/context";
import { Card, Label, MixBar, fmtUsd } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

function StepMark({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <div
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center border font-mono text-[13px] tabular-nums",
        done
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
          : active
            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
            : "border-[var(--color-grid)] text-[var(--color-faint)]",
      )}
    >
      {done ? <Check size={16} /> : n}
    </div>
  );
}

export function SetupFlow() {
  const d = useDashboard();
  const hasUsdc = (d.usdcBalance ?? 0) > 0;
  const hasMix = Boolean(d.displayWeights && d.order.length > 0);

  return (
    <div className="bp-enter mx-auto max-w-[720px]">
      <div className="bp-mono-label text-[10px]">Set up · 2 steps</div>
      <h1 className="mt-1 text-[clamp(1.6rem,3.2vw,2.1rem)] font-medium uppercase leading-[1.06] tracking-[-0.03em]">
        Fund {d.followedName}
      </h1>
      <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
        This basket runs on Solana Devnet. Grab some test USDC, then deposit it into the mix —
        both are real transactions you sign. You hold every token; nothing is custodied.
      </p>

      {hasMix && (
        <div className="mt-6">
          <Card>
            <Label right={d.cashPct != null ? <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">{d.cashPct}% cash</span> : undefined}>
              What you&apos;re funding
            </Label>
            <MixBar order={d.order} weights={d.displayWeights!} />
          </Card>
        </div>
      )}

      <ol className="mt-4 space-y-4">
        <li>
          <Card className={cn(!hasUsdc && "border-[var(--color-accent)]")}>
            <div className="flex items-start gap-4">
              <StepMark n={1} done={hasUsdc} active={!hasUsdc} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  Get test USDC
                  {hasUsdc && (
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-accent)]">· {fmtUsd(d.usdcBalance ?? 0)} ready</span>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
                  Devnet play money to fund the basket. The program mints it straight to your wallet — no faucet site, no real value.
                </p>
                <button
                  onClick={d.getTestUsdc}
                  disabled={d.fauceting}
                  className="mt-3 inline-flex h-10 items-center gap-2 border border-[var(--color-grid)] px-4 text-[13px] font-medium transition-colors hover:border-[var(--color-grid-strong)] disabled:opacity-50"
                >
                  <Coins size={15} className="text-[var(--color-accent)]" />
                  {d.fauceting ? "Minting…" : hasUsdc ? "Get 1,000 more" : "Request 1,000 test USDC"}
                </button>
              </div>
            </div>
          </Card>
        </li>

        <li>
          <Card className={cn(hasUsdc ? "border-[var(--color-accent)]" : "opacity-60")}>
            <div className="flex items-start gap-4">
              <StepMark n={2} done={false} active={hasUsdc} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">Deposit into the mix</div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
                  Splits your test USDC across each company by target weight at live prices and keeps the reserve in cash.
                  The tokens land in your wallet, and the basket goes live.
                </p>
                <button
                  onClick={d.buyBasket}
                  disabled={!hasUsdc || d.buying || !hasMix}
                  className="mt-3 inline-flex h-10 items-center gap-2 bg-[var(--color-accent)] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShoppingCart size={15} />
                  {d.buying ? "Depositing on-chain…" : "Deposit & activate"}
                </button>
                {!hasUsdc && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">Get test USDC first</p>
                )}
              </div>
            </div>
          </Card>
        </li>
      </ol>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
        Devnet · test network · no real funds
      </p>
    </div>
  );
}
