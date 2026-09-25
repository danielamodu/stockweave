"use client";

// Assistant — the constrained agent. It can READ the strategy and PROPOSE a
// tune-up, but it can never move funds: every change waits for your approval.
// This page makes those limits explicit and surfaces the current proposal.
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ExternalLink } from "lucide-react";
import { useDashboard, type AgentProposal, type AgentReview, type EvidenceRow } from "@/components/dashboard/context";
import { Card, Label, DriftBar } from "@/components/dashboard/ui";
import { OnchainLedger } from "@/components/onchain-ledger";
import { EXPLORER, EXPLORER_TX, type OnchainRules } from "@/lib/onchain";
import { ASSET_LABEL } from "@/lib/present";
import { cn } from "@/lib/utils";

const READ = 0b001;
const PROPOSE = 0b010;
const EXECUTE = 0b100;

// Shared button styles (match the blueprint primary/secondary elsewhere).
const APPROVE_CLS =
  "inline-flex h-11 items-center gap-2 bg-[var(--color-accent)] px-6 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)]";
const SKIP_CLS =
  "inline-flex h-11 items-center bg-[var(--color-soft)] px-6 text-[14px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-soft-hover)]";

function Perm({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-[var(--color-grid)] py-3 last:border-b-0">
      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center border",
          ok ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-grid-strong)] text-[var(--color-faint)]",
        )}
      >
        {ok ? <Check size={13} /> : <X size={13} />}
      </span>
      <div>
        <div className="text-[14px] font-medium">{label}</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">{note}</div>
      </div>
    </li>
  );
}

// bps → whole-percent string (e.g. 3000 → "30%"), or an em dash if unknown.
function bpsPct(bps?: number): string {
  return bps == null ? "—" : `${Math.round(bps / 100)}%`;
}

// One labelled fact in the proposal breakdown.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-grid)] py-2.5 last:border-b-0">
      <dt className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
        {label}
      </dt>
      <dd className="text-right text-[13px] leading-snug">{children}</dd>
    </div>
  );
}

// Compact "moments ago" / "Nm ago" from a unix-seconds timestamp — dates the live
// prices and reference oracle the brief cites, so the evidence isn't timeless.
function agoText(sec?: number): string {
  if (!sec) return "just now";
  const d = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (d < 45) return "moments ago";
  if (d < 90) return "1m ago";
  const m = Math.floor(d / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// One asset's row in the evidence table: real 24h move, live weight → target, and
// the drift between them. The pick (most overweight → the trim) is accented.
function EvidenceRowView({ e }: { e: EvidenceRow }) {
  const up = (e.change24h ?? 0) >= 0;
  return (
    <tr className={cn("border-t border-[var(--color-grid)]", e.picked && "bg-[color:var(--color-accent)]/[0.06]")}>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          {e.picked && <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-accent)]" aria-hidden />}
          <span className={cn("font-medium", e.picked && "text-[var(--color-accent)]")}>{e.label}</span>
          {e.picked && <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-accent)]">trim</span>}
        </span>
      </td>
      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
        {e.priced ? (
          <span className={up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
            {up ? "+" : ""}
            {e.change24h!.toFixed(1)}%
          </span>
        ) : (
          <span className="text-[var(--color-faint)]">n/a</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--color-muted)]">
        {(e.currentBps / 100).toFixed(0)}→{(e.targetBps / 100).toFixed(0)}%
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
        <span className={e.driftBps > 0 ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"}>
          {e.driftBps > 0 ? "+" : ""}
          {(e.driftBps / 100).toFixed(1)}
        </span>
      </td>
    </tr>
  );
}

// The evidence the recommendation is built from: every asset's real 24h move
// (live, Jupiter), its resulting live weight vs its on-chain target, and the
// drift between them — the top row is the proposed trim. Anyone can check the
// call against the same numbers the agent used; the footer dates and sources
// them, and an asset with no live price is flagged rather than shown as 0%.
function EvidenceTable({
  rows,
  readAt,
  referencePublishTime,
  pricedCount,
  assetCount,
}: {
  rows: EvidenceRow[];
  readAt?: number;
  referencePublishTime?: number;
  pricedCount?: number;
  assetCount?: number;
}) {
  if (rows.length === 0) return null;
  const unpriced = (assetCount ?? rows.length) - (pricedCount ?? rows.length);
  return (
    <div className="mt-4 border border-[var(--color-grid)]">
      <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">What the agent read</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">last 24h · live</span>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
            <th className="px-4 py-2 text-left font-normal">Asset</th>
            <th className="px-2 py-2 text-right font-normal">24h</th>
            <th className="px-2 py-2 text-right font-normal">Now→target</th>
            <th className="px-4 py-2 text-right font-normal">Drift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <EvidenceRowView key={e.symbol} e={e} />
          ))}
        </tbody>
      </table>
      <div className="border-t border-[var(--color-grid)] px-4 py-2.5 font-mono text-[10px] leading-relaxed text-[var(--color-faint)]">
        Live 24h returns from Jupiter, read {agoText(readAt)}. Drift is each asset&apos;s live weight minus its on-chain target.
        {referencePublishTime != null && ` Reference SOL/USD via Pyth, published ${agoText(referencePublishTime)}.`}
        {unpriced > 0 && ` ${unpriced} asset${unpriced > 1 ? "s" : ""} had no live price and ${unpriced > 1 ? "were" : "was"} held flat.`}
      </div>
    </div>
  );
}

// The plain-numbers story behind a real on-chain proposal: what drifted, the
// proposed trim, the on-chain guardrails it stays inside, and the hard line —
// the agent can propose but never execute. Every figure is a real value from
// the signed proposal or the strategy's on-chain rules; nothing is invented.
function ProposalBreakdown({ p, rules }: { p: AgentProposal; rules?: OnchainRules | null }) {
  const name = ASSET_LABEL[p.symbol] ?? p.symbol;
  const targetPct = p.newTargetWeightBps / 100;
  const nowPct = Math.min(100, targetPct + p.maxDriftBps / 100);
  return (
    <>
      {/* Drift, drawn. The fill is the asset's live weight; the tick is its
          on-chain target. The gap past the tick is exactly what the agent
          proposes to trim — the whole proposal, legible in one bar. */}
      <div className="mt-4 border border-[var(--color-grid)] p-4">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
          <span>{name} weight</span>
          <span className="tabular-nums">
            now <span className="text-[var(--color-down)]">{nowPct.toFixed(1)}%</span> · target{" "}
            <span className="text-[var(--color-ink)]">{targetPct.toFixed(0)}%</span>
          </span>
        </div>
        <DriftBar current={nowPct} target={targetPct} className="mt-2.5 h-2.5" />
        <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-muted)]">
          <span className="inline-block h-3 w-px translate-y-[2px] bg-[var(--color-ink)]" />
          past the tick is the drift — the agent proposes trimming it back to target
        </div>
      </div>
      <EvidenceTable
        rows={p.evidence ?? []}
        readAt={p.readAt}
        referencePublishTime={p.referencePublishTime}
        pricedCount={p.pricedCount}
        assetCount={p.assetCount}
      />
      <dl className="mt-4 border-t border-[var(--color-grid)]">
        <Fact label="Drifted">
          {name} · +{(p.maxDriftBps / 100).toFixed(1)} pts over its {bpsPct(p.newTargetWeightBps)} target
          <div className="text-[11px] text-[var(--color-muted)]">modelled on the last 24h of live prices</div>
        </Fact>
        <Fact label="Proposed">
          Sell <span className="font-mono tabular-nums">${p.notional}</span> of {name} into cash (USDC reserve)
        </Fact>
        <Fact label="Within limits">
          ≤ ${rules?.maxTradeNotional ?? "—"} per trade · cash floor {bpsPct(rules?.reserveWeightBps)} · single asset ≤{" "}
          {bpsPct(rules?.maxSingleAssetWeightBps)} · oracle &lt; {rules?.maxPriceAgeSeconds ?? "—"}s
        </Fact>
        <Fact label="Approval">
          <span className="text-[var(--color-accent)]">Agent proposed — it cannot execute</span>
          <div className="text-[11px] text-[var(--color-muted)]">only your signature moves funds</div>
        </Fact>
      </dl>
    </>
  );
}

// The agent's within-band readout: it checked, nothing drifted past the band, so
// there's no signed proposal — but the same real evidence still shows, so "review"
// always means something you can inspect. A re-check button re-runs it live.
function AgentReviewView({
  review,
  rules,
  onRecheck,
  rechecking,
}: {
  review: AgentReview;
  rules?: OnchainRules | null;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const band = rules?.rebalanceDriftBps;
  return (
    <>
      <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--color-accent)]">
        <Check size={16} /> Reviewed — your mix is within its drift band.
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-muted)]">
        The most-drifted asset is +{(review.maxDriftBps / 100).toFixed(1)} pts from its target
        {band != null && <> · inside the {(band / 100).toFixed(0)}-pt rebalance band</>}. No trim needed yet — here&apos;s
        exactly what the agent read.
      </p>
      <EvidenceTable
        rows={review.evidence}
        readAt={review.readAt}
        pricedCount={review.pricedCount}
        assetCount={review.assetCount}
      />
      <button
        onClick={onRecheck}
        disabled={rechecking}
        className={cn("mt-5", SKIP_CLS, rechecking && "cursor-not-allowed opacity-70")}
      >
        {rechecking ? "Agent is checking…" : "Check again"}
      </button>
    </>
  );
}

export default function AssistantPage() {
  const d = useDashboard();
  const router = useRouter();

  useEffect(() => {
    if (d.ready && d.wallet && !d.following) router.replace("/dashboard");
  }, [d.ready, d.wallet, d.following, router]);

  if (!d.following) return <div className="min-h-[40vh]" />;

  const perm = d.agent?.permission;
  const oc = d.onchain;
  // Prefer REAL on-chain values — the deployed program enforces these. Fall back
  // to the engine's model figures only until the account has been read.
  const allowed = oc?.agentAllowedActions ?? perm?.allowedActions ?? READ | PROPOSE;
  const perAction = oc?.rules?.maxTradeNotional ?? perm?.maxNotionalPerAction ?? 50;
  const perDay = oc?.rules?.maxDailyNotional ?? perm?.maxDailyNotional ?? 200;

  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="bp-mono-label text-[10px]">{d.followedName}</div>
      <h1 className="mt-1 text-[clamp(1.5rem,3vw,2rem)] font-medium uppercase leading-none tracking-[-0.02em]">
        Assistant
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
        A constrained agent watches your mix and proposes tune-ups. It reads and suggests — it never moves your
        money. You approve every change, and the limits below are enforced on-chain, not just here.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <Label>Current proposal</Label>
            <div
              key={d.approved ? "done" : d.proposal ? "prop" : d.canRunAgent ? (d.review ? "review" : "ask") : d.suggestion ? "todo" : "clear"}
              className="bp-fade"
              aria-live="polite"
            >
              {d.approved ? (
                <div className="flex items-center gap-2 text-[14px] text-[var(--color-accent)]">
                  <Check size={16} /> Done — approved{d.proposal ? " and executed on-chain" : ""}.
                </div>
              ) : d.proposal ? (
                // A REAL agent-signed proposal is live on-chain: the creator approves + executes.
                <>
                  <p className="text-[15px] leading-relaxed">{d.proposal.text}</p>
                  <a
                    href={EXPLORER_TX(d.proposal.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline"
                  >
                    proposed on-chain by the agent <ExternalLink size={11} />
                  </a>
                  <ProposalBreakdown p={d.proposal} rules={oc?.rules} />
                  <div className="mt-5 flex gap-2.5">
                    <button onClick={d.onApprove} disabled={d.approving} className={cn(APPROVE_CLS, d.approving && "cursor-not-allowed opacity-70")}>
                      {d.approving ? "Approving on-chain…" : "Approve + execute"}
                    </button>
                    <button onClick={d.onSkip} disabled={d.approving} className={cn(SKIP_CLS, d.approving && "cursor-not-allowed opacity-70")}>
                      Skip
                    </button>
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
                    Approving signs two wallet transactions — approve, then execute. The agent never executes on its own.
                  </p>
                </>
              ) : d.canRunAgent ? (
                d.review ? (
                  // The agent checked and found the mix within its drift band: no signed
                  // proposal, but its real evidence still shows — a review always means
                  // something you can inspect, not just a toast.
                  <AgentReviewView
                    review={d.review}
                    rules={oc?.rules}
                    onRecheck={d.requestProposal}
                    rechecking={d.requestingProposal}
                  />
                ) : (
                  // The connected wallet owns this basket on-chain → ask the real backend agent to check drift.
                  <>
                    <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
                      Ask the agent to read this basket&apos;s on-chain targets and the last 24h of live prices. If the mix has drifted past its band, it signs a real proposal here for you to approve.
                    </p>
                    <button
                      onClick={d.requestProposal}
                      disabled={d.requestingProposal}
                      className={cn("mt-4", APPROVE_CLS, d.requestingProposal && "cursor-not-allowed opacity-70")}
                    >
                      {d.requestingProposal ? "Agent is checking…" : "Ask the agent to review"}
                    </button>
                  </>
                )
              ) : d.suggestion ? (
                // Read-only basket (official / preview): show the engine's model suggestion; approving is a local acknowledgement.
                <>
                  <p className="text-[15px] leading-relaxed">{d.suggestion.text}</p>
                  <div className="mt-5 flex gap-2.5">
                    <button onClick={d.onApprove} className={APPROVE_CLS}>
                      Approve change
                    </button>
                    <button onClick={d.onSkip} className={SKIP_CLS}>
                      Skip
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[14px] text-[var(--color-muted)]">
                  Nothing to approve right now. When your mix drifts, a proposal appears here.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <Label>Activity</Label>
            {d.activity.length > 0 ? (
              <ul className="space-y-2.5 font-mono text-[12px] text-[var(--color-muted)]">
                {d.activity.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 bp-fade">
                    <span className="mt-[3px] h-1.5 w-1.5 shrink-0 bg-[var(--color-accent)]" />
                    <span className="leading-snug">{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--color-muted)]">No changes yet. Approved tune-ups will show up here.</p>
            )}
          </Card>
          {oc?.exists && (
            <Card>
              <Label
                right={
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
                    Signed on-chain
                  </span>
                }
              >
                On-chain ledger
              </Label>
              <p className="mb-1 text-[13px] leading-relaxed text-[var(--color-muted)]">
                The real, signed history of this strategy — read straight from Devnet, each row openable in Explorer.
                What Activity shows optimistically, this confirms on-chain.
              </p>
              <OnchainLedger strategy={oc.strategy} limit={8} refreshKey={d.activity.length} className="mt-2" />
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <Label
              right={
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
                  {perm?.revoked ? "Revoked" : oc?.exists ? "On-chain" : "Active"}
                </span>
              }
            >
              What it can do
            </Label>
            <ul>
              <Perm ok={Boolean(allowed & READ)} label="Read your strategy" note="See prices, weights and drift." />
              <Perm ok={Boolean(allowed & PROPOSE)} label="Propose a tune-up" note="Suggest a trade for you to approve." />
              <Perm ok={Boolean(allowed & EXECUTE)} label="Move funds on its own" note="Off — execution is never delegated." />
            </ul>
          </Card>
          <Card>
            <Label>Limits</Label>
            <dl className="space-y-3 text-[13px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-muted)]">Per proposal</dt>
                <dd className="font-mono tabular-nums">${perAction}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-muted)]">Per day</dt>
                <dd className="font-mono tabular-nums">${perDay}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-[var(--color-grid)] pt-3">
                <dt className="text-[var(--color-muted)]">Approval</dt>
                <dd className="font-mono text-[var(--color-accent)]">Always required</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-[var(--color-grid)] pt-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
              These caps live in the on-chain permission grant. The agent can be revoked at any time.
              {oc?.exists && (
                <a
                  href={EXPLORER(oc.strategy)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline"
                >
                  {oc.strategy.slice(0, 4)}…{oc.strategy.slice(-4)} <ExternalLink size={11} />
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

