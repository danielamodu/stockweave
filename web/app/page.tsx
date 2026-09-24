// @preview-module stockweave-hero
"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GridPlus, Hatch, Cta, CornerPluses } from "@/components/blueprint";
import { BrandMark } from "@/components/brand-mark";

const MIX = [
  { k: "OpenAI", w: 30, tone: "var(--color-accent)" },
  { k: "Anthropic", w: 30, tone: "#4d4dff" },
  { k: "Figure AI", w: 30, tone: "#8f8fff" },
  { k: "Cash", w: 10, tone: "hatch" },
] as const;

/* ---- horizontal-rule junction pluses (left edge · center 46% · right edge) ---- */
function HRulePlus({ first = false, last = false }: { first?: boolean; last?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      <GridPlus omit={["left"]} className="left-0 top-0" />
      <GridPlus omit={["right"]} className="left-full top-0" />
      <span className="hidden lg:block">
        <GridPlus
          omit={first ? ["top"] : last ? ["bottom"] : []}
          className="top-0"
          style={{ left: "46%" }}
        />
      </span>
    </div>
  );
}

const SPLIT = "lg:grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]";

export default function Home() {
  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        {/* ===================== FOLD ===================== */}
        <div className="flex min-h-dvh flex-col">
        {/* ---------------- NAV ---------------- */}
        <header className="relative">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-4 sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[13px] font-normal uppercase tracking-[0.08em] no-underline text-[var(--color-ink)]"
            >
              <BrandMark size={20} priority />
              Stockweave
            </Link>
            <nav className="hidden border border-[var(--color-grid)] px-5 py-[15px] sm:block">
              <ul className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-[0.17em] text-[var(--color-muted)]">
                <li><Link href="/strategy/ai-infrastructure" className="no-underline transition-colors hover:text-[var(--color-ink)]">Strategy</Link></li>
                <li><Link href="/strategy/ai-infrastructure#rules" className="no-underline transition-colors hover:text-[var(--color-ink)]">Rules</Link></li>
                <li><Link href="/strategy/ai-infrastructure#agent" className="no-underline transition-colors hover:text-[var(--color-ink)]">Agent</Link></li>
              </ul>
            </nav>
            <div className="flex justify-end">
              <Link
                href="/dashboard"
                className="group relative inline-flex h-9 items-center gap-1.5 bg-[var(--color-accent)] px-4 text-[12px] font-medium text-white no-underline transition-colors duration-150 hover:bg-[var(--color-accent-hover)] sm:h-11 sm:text-[13px]"
              >
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  Get started <ArrowUpRight size={15} strokeWidth={2} />
                </span>
                <CornerPluses tone="#000000" />
              </Link>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 border-b border-[var(--color-grid)]" />
          <HRulePlus first />
        </header>

        {/* ---------------- HATCH + STATS ---------------- */}
        <section className={cn("relative", SPLIT)}>
          <Hatch className="hidden lg:block lg:border-r lg:border-[var(--color-grid)]" />
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 px-6 py-6">
            {[
              { v: "3 + 1", l: "Assets in basket" },
              { v: "35%", l: "Max single asset" },
              { v: "30s", l: "Pyth max age" },
            ].map((s) => (
              <div key={s.l} className="text-center">
                <div className="font-mono text-[1.5rem] leading-none tracking-tight text-[var(--color-ink)]">{s.v}</div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 border-b border-[var(--color-grid)]" />
          <HRulePlus />
        </section>

        {/* ---------------- HERO ---------------- */}
        <section className={cn("relative flex-1", SPLIT)}>
          {/* copy */}
          <div className="bp-enter flex min-h-0 flex-col justify-center overflow-hidden px-6 py-12 lg:border-r lg:border-[var(--color-grid)] lg:py-24 sm:py-28 lg:pl-10 lg:pr-12">
            <div className="mb-6 inline-flex w-fit items-center border border-black/10 bg-black/[0.06] px-3 py-1.5 text-[11px] text-[#505050]">
              Inspect before you trust — no opaque manager
            </div>
            <h1 className="font-sans text-[clamp(2rem,4.4vw,3.25rem)] font-medium uppercase leading-[1.06] tracking-[-0.035em] text-[var(--color-ink)]">
              Inspect, simulate,<br />fork &amp; follow a<br />tokenized-stock strategy
            </h1>
            <p className="mt-6 max-w-[46ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
              See exactly what a strategy holds, what rules bind it, and what its agent is allowed
              to do — before you follow or fork. Every weight, cap and permission is on-chain and
              checkable.
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Cta href="/strategy/ai-infrastructure" variant="soft">See the strategy</Cta>
              <Cta href="/dashboard" variant="blue" arrow>Get started</Cta>
            </div>
          </div>
          {/* dither illustration */}
          <div className="bp-enter relative min-h-[280px] lg:min-h-0" style={{ animationDelay: "140ms" }}>
            <DitherCanvas />
          </div>
          <div className="absolute inset-x-0 bottom-0 border-b border-[var(--color-grid)]" />
          <HRulePlus />
        </section>

        {/* ---------------- LOGOS + HATCH ---------------- */}
        <section className={cn("relative", SPLIT)}>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4 px-6 py-6">
            {["Solana", "Pyth", "PreStocks", "Anchor"].map((n) => (
              <span
                key={n}
                className="font-mono text-[15px] font-medium uppercase tracking-[0.08em] text-[var(--color-ink)] opacity-20"
              >
                {n}
              </span>
            ))}
          </div>
          <Hatch className="hidden lg:block lg:border-l lg:border-[var(--color-grid)]" />
        </section>
        </div>{/* ===================== /FOLD ===================== */}

        {/* ===================== SECTIONS ===================== */}
        <HowItWorks />
        <WhyDifferent />
        <StrategyPreview />
        <AssistantSection />
        <Faq />
        <CtaBand />
      </div>

      <SiteFooter />
    </main>
  );
}

/* ---- shared section bits ---- */
function EdgePlusTop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20">
      <GridPlus omit={["left"]} className="left-0 top-0" />
      <GridPlus omit={["right"]} className="left-full top-0" />
    </div>
  );
}

function SectionHead({ index, kicker, title }: { index: string; kicker: string; title: string }) {
  return (
    <div className="mb-14 max-w-[60ch]">
      <div className="bp-mono-label text-[10px]">{index} — {kicker}</div>
      <h2 className="mt-3 text-[clamp(1.5rem,3vw,2rem)] font-medium uppercase leading-[1.08] tracking-[-0.03em]">
        {title}
      </h2>
    </div>
  );
}

function StaticMix() {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden border border-[var(--color-grid)]">
        {MIX.map((m) =>
          m.tone === "hatch" ? (
            <span key={m.k} className="bp-hatch h-full border-l border-[var(--color-grid)]" style={{ width: m.w + "%" }} />
          ) : (
            <span key={m.k} className="h-full" style={{ width: m.w + "%", background: m.tone }} />
          ),
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
        {MIX.map((m) => (
          <span key={m.k} className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
            <span
              className={cn("inline-block h-2 w-2", m.tone === "hatch" && "bp-hatch border border-[var(--color-grid)]")}
              style={m.tone === "hatch" ? undefined : { background: m.tone }}
            />
            {m.k} {m.w}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- How it works ---- */
function HowItWorks() {
  const steps = [
    ["01", "Inspect", "See what a strategy holds, the rules that bind it, and what its assistant can do. No wallet needed."],
    ["02", "Follow", "Connect and follow in one tap. Your keys, your funds — nothing moves without you."],
    ["03", "Approve", "The assistant watches and suggests tune-ups in plain words. You approve each one, or skip it."],
    ["04", "Make your own", "Change the mix and fork it into your own version — same transparent guarantees."],
  ];
  const borders = [
    "",
    "border-t sm:border-t-0 sm:border-l",
    "border-t sm:border-l-0 lg:border-t-0 lg:border-l",
    "border-t sm:border-l lg:border-t-0",
  ];
  return (
    <section id="how" className="relative scroll-mt-16 border-t border-[var(--color-grid)] px-4 py-24 sm:py-28 sm:px-8 lg:px-10">
      <EdgePlusTop />
      <SectionHead index="How it works" kicker="Four steps, one path" title="From curious to in control" />
      <div className="grid grid-cols-1 border border-[var(--color-grid)] sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([n, t, d], i) => (
          <div key={n} className={cn("border-[var(--color-grid)] p-6", borders[i])}>
            <div className="font-mono text-[13px] text-[var(--color-accent)]">{n}</div>
            <h3 className="mt-4 text-[15px] font-semibold">{t}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- Why it's different ---- */
function WhyDifferent() {
  const items = [
    ["Inspectable", "Every rule, weight and cap is on-chain — read it yourself, not a PDF prospectus."],
    ["Assistant on a leash", "It can explain and suggest, but never spend. You approve every move, and can revoke it anytime."],
    ["Forkable", "Disagree with a weight? Fork the whole strategy into your own, keeping the same guarantees."],
  ];
  return (
    <section id="why" className="relative scroll-mt-16 border-t border-[var(--color-grid)] px-4 py-24 sm:py-28 sm:px-8 lg:px-10">
      <EdgePlusTop />
      <SectionHead index="Why it's different" kicker="No opaque manager" title="Trust the code, not a person" />
      <div className="grid gap-4 md:grid-cols-3">
        {items.map(([t, d], i) => (
          <div key={t} className="relative border border-[var(--color-grid)] p-6">
            <GridPlus omit={["top", "left"]} className="left-0 top-0" />
            <GridPlus omit={["top", "right"]} className="left-full top-0" />
            <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
            <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
            <div className="bp-mono-label text-[10px]">{`0${i + 1}`}</div>
            <h3 className="mt-3 text-[16px] font-semibold">{t}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- The strategy ---- */
function StrategyPreview() {
  return (
    <section className="relative border-t border-[var(--color-grid)]">
      <EdgePlusTop />
      <div className="grid lg:grid-cols-2">
        <div className="px-4 py-24 sm:py-28 sm:px-8 lg:border-r lg:border-[var(--color-grid)] lg:px-10">
          <SectionHead index="The strategy" kicker="AI Infrastructure" title="One basket, fully in the open" />
          <p className="max-w-[46ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
            Follow the companies building AI — OpenAI, Anthropic and Figure AI — as one simple mix, with a slice
            kept in cash. Caps and reserves keep it sensible; the assistant keeps it on target.
          </p>
          <div className="mt-8">
            <Cta href="/strategy/ai-infrastructure" variant="blue" arrow>See the strategy</Cta>
          </div>
        </div>
        <div className="flex items-center px-4 py-24 sm:py-28 sm:px-8 lg:px-10">
          <div className="w-full">
            <div className="bp-mono-label mb-4 text-[10px]">What it holds</div>
            <StaticMix />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- The assistant ---- */
function AssistantSection() {
  return (
    <section className="relative border-t border-[var(--color-grid)]">
      <EdgePlusTop />
      <div className="grid lg:grid-cols-2">
        <div className="order-2 flex items-center px-4 py-24 sm:py-28 sm:px-8 lg:order-1 lg:border-r lg:border-[var(--color-grid)] lg:px-10">
          {/* mock suggestion card */}
          <div className="relative w-full border border-[var(--color-grid)] p-6">
            <GridPlus omit={["top", "left"]} className="left-0 top-0" />
            <GridPlus omit={["top", "right"]} className="left-full top-0" />
            <GridPlus omit={["bottom", "left"]} className="left-0 top-full" />
            <GridPlus omit={["bottom", "right"]} className="left-full top-full" />
            <div className="bp-mono-label text-[10px]">Needs your OK</div>
            <p className="mt-3 text-[14px] leading-relaxed">
              OpenAI grew past its target. Move $50 into cash to bring the mix back in line.
            </p>
            <div className="mt-4 flex gap-2.5">
              <span className="inline-flex h-10 items-center bg-[var(--color-accent)] px-5 text-[13px] font-medium text-white">Approve</span>
              <span className="inline-flex h-10 items-center bg-[var(--color-soft)] px-5 text-[13px] font-medium text-[var(--color-ink)]">Skip</span>
            </div>
          </div>
        </div>
        <div className="order-1 px-4 py-24 sm:py-28 sm:px-8 lg:order-2 lg:px-10">
          <SectionHead index="The assistant" kicker="Observe & propose" title="Suggestions, never surprises" />
          <ul className="space-y-4 text-[14px] text-[var(--color-muted)]">
            {[
              ["Plain-language suggestions", "It explains what drifted and what it proposes — in words, not jargon."],
              ["You approve every action", "It can read and propose, but it can't move funds. Ever."],
              ["Capped and revocable", "Hard limits per action and per day, and you can revoke it in one tap."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 inline-grid h-4 w-4 flex-none place-items-center text-[var(--color-accent)]"><Check size={14} strokeWidth={2.5} /></span>
                <span><span className="font-medium text-[var(--color-ink)]">{t}.</span> {d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---- FAQ ---- */
function Faq() {
  const qs = [
    ["Is this real money?", "No — it runs on a test network (Devnet) with demo balances. Nothing here is real funds."],
    ["Do you hold my funds?", "No. You connect your own wallet and keep your keys. StockWeave can't move anything without your signature."],
    ["What can the assistant actually do?", "It reads the strategy and suggests tune-ups. It can't spend, change rules, or add assets — and you can revoke it anytime."],
    ["What are PreStocks?", "Tokens that give SPV-backed economic exposure to pre-IPO companies. They are not shares — no voting, dividends, or guaranteed claim. We keep that disclosure front and centre."],
    ["Can I change the strategy?", "Yes. Fork it into your own version, set your own mix within the guardrails, and follow that instead."],
  ];
  return (
    <section id="faq" className="relative scroll-mt-16 border-t border-[var(--color-grid)] px-4 py-24 sm:py-28 sm:px-8 lg:px-10">
      <EdgePlusTop />
      <SectionHead index="FAQ" kicker="Straight answers" title="Questions, answered plainly" />
      <div className="border border-[var(--color-grid)]">
        {qs.map(([q, a], i) => (
          <details key={i} className={cn("group", i > 0 && "border-t border-[var(--color-grid)]")}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown size={16} className="flex-none text-[var(--color-muted)] transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="px-5 pb-5 text-[14px] leading-relaxed text-[var(--color-muted)]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ---- Closing CTA ---- */
function CtaBand() {
  return (
    <section className="relative border-t border-[var(--color-grid)]">
      <EdgePlusTop />
      <div className="relative overflow-hidden px-4 py-32 text-center sm:px-8">
        <Hatch className="pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative">
          <h2 className="mx-auto max-w-[16ch] text-[clamp(1.8rem,4vw,3rem)] font-medium uppercase leading-[1.05] tracking-[-0.035em]">
            Look under the hood
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[14px] text-[var(--color-muted)]">
            Inspect the strategy in full, or connect and follow it. You stay in control the whole way.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Cta href="/strategy/ai-infrastructure" variant="soft">See the strategy</Cta>
            <Cta href="/dashboard" variant="blue" arrow>Get started</Cta>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Solid footer ---- */
function SiteFooter() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Strategy", "/strategy/ai-infrastructure"], ["Dashboard", "/dashboard"], ["Make your own", "/make"]]],
    ["Learn", [["How it works", "/#how"], ["Why it's different", "/#why"], ["FAQ", "/#faq"]]],
    ["Start", [["Connect wallet", "/connect"], ["Get started", "/dashboard"]]],
  ];
  return (
    <footer className="bg-[var(--color-ink)] text-white">
      <div className="mx-auto max-w-[1200px] px-6 py-24 sm:py-28">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold uppercase tracking-[0.06em]">
              <BrandMark size={24} />
              Stockweave
            </div>
            <p className="mt-4 max-w-[34ch] text-[13px] leading-relaxed text-white/55">
              A public, forkable strategy layer for tokenized stocks on Solana. Inspect it, simulate it,
              fork it, follow it — no opaque manager.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-white/40">
              {["Solana", "Pyth", "PreStocks", "Anchor"].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </div>
          {cols.map(([title, links]) => (
            <div key={title}>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{title}</div>
              <ul className="mt-4 space-y-2.5">
                {links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-[13px] text-white/70 no-underline transition-colors hover:text-white">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-[12px] text-white/45 md:flex-row md:items-center md:justify-between">
          <span>© 2026 StockWeave · Demo · Devnet · no real funds</span>
          <span className="max-w-[62ch] md:text-right">
            Not investment advice. PreStocks are SPV-backed economic exposure, not equity — no shares,
            voting, dividends, or guaranteed claim.
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   Right-column dither illustration.
   Procedural isometric "data terrain" rendered to an offscreen
   buffer, overlaid with a Bayer-4 ordered dither of small blue
   squares sampled from ink density. Cursor proximity warps the
   sample positions (smooth follow). Kept in this module.
   ============================================================ */
function DitherCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const wrap = canvas.parentElement!;

    // 4x4 Bayer ordered-dither matrix, normalised to (0,1).
    const BAYER = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ].map((row) => row.map((v) => (v + 0.5) / 16));

    const CELL = 3; // px per dither cell (finer = higher-res, denser)
    const DOT = 3; // blue square = cell size, so filled cells are contiguous

    let raf = 0;
    let W = 0;
    let H = 0;
    let buf: ImageData | null = null;
    let bw = 0;
    let bh = 0;

    const mouse = { x: -9999, y: -9999 };
    const smooth = { x: -9999, y: -9999 };

    // Render the base terrain once, at buffer resolution, in grayscale.
    function renderBase() {
      const off = document.createElement("canvas");
      off.width = bw;
      off.height = bh;
      const o = off.getContext("2d")!;
      o.fillStyle = "#ffffff";
      o.fillRect(0, 0, bw, bh);

      // Solid isometric voxel cluster: a chunky core with studs jutting out.
      // Dark side-faces fill densely under the dither; the lighter top face
      // reads as a sparser gradient — a crisp block, not a scattered cloud.
      const U = Math.min(bw, bh) * 0.135; // voxel edge
      const w = U;
      const h = U * 0.5;
      const vh = U;

      // voxel coordinates (ix, iy, iz); a 2×2×2 core plus protruding studs
      const voxels: [number, number, number][] = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
        [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
        [0, 0, 2],           // tall top-corner stud
        [2, 1, 0], [1, 2, 0], // low side pokes
        [2, 0, 1], [0, 2, 1], // mid side pokes
        [-1, 1, 0], [1, -1, 1],
      ];

      type Face = { pts: [number, number][]; shade: number };
      type Cube = { key: number; faces: Face[] };
      const project = (ix: number, iy: number, iz: number, ox: number, oy: number) => {
        const ax = ox + (ix - iy) * w;
        const ay = oy + (ix + iy) * h - iz * vh;
        return { ax, ay };
      };
      const buildCube = (ix: number, iy: number, iz: number, ox: number, oy: number): Cube => {
        const { ax, ay } = project(ix, iy, iz, ox, oy);
        const T: [number, number] = [ax, ay - h];
        const R: [number, number] = [ax + w, ay];
        const B: [number, number] = [ax, ay + h];
        const L: [number, number] = [ax - w, ay];
        const Bd: [number, number] = [ax, ay + h + vh];
        const Rd: [number, number] = [ax + w, ay + vh];
        const Ld: [number, number] = [ax - w, ay + vh];
        return {
          key: ix + iy + iz,
          faces: [
            { shade: 178, pts: [T, R, B, L] },   // top — mid, visible gradient
            { shade: 66, pts: [L, B, Bd, Ld] },  // left — dark, dense
            { shade: 22, pts: [B, R, Rd, Bd] },  // right — solid
          ],
        };
      };

      // pass 1: measure the cluster so we can centre it
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [ix, iy, iz] of voxels) {
        for (const f of buildCube(ix, iy, iz, 0, 0).faces) {
          for (const [px, py] of f.pts) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
      const ox = bw / 2 - (minX + maxX) / 2;
      const oy = bh / 2 - (minY + maxY) / 2;

      // pass 2: painter's order (back-to-front) then draw
      const cubes = voxels.map(([ix, iy, iz]) => buildCube(ix, iy, iz, ox, oy));
      cubes.sort((a, b) => a.key - b.key);
      for (const c of cubes) {
        for (const f of c.faces) {
          o.beginPath();
          o.moveTo(f.pts[0][0], f.pts[0][1]);
          for (let i = 1; i < f.pts.length; i++) o.lineTo(f.pts[i][0], f.pts[i][1]);
          o.closePath();
          const rgb = `rgb(${f.shade},${f.shade},${f.shade})`;
          o.fillStyle = rgb;
          o.strokeStyle = rgb; // seal seams between adjacent voxel faces
          o.lineWidth = 1;
          o.fill();
          o.stroke();
        }
      }
      buf = o.getImageData(0, 0, bw, bh);
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      bw = Math.max(1, Math.floor(W));
      bh = Math.max(1, Math.floor(H));
      renderBase();
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!buf) return;
      // smooth cursor follow
      smooth.x += (mouse.x - smooth.x) * 0.12;
      smooth.y += (mouse.y - smooth.y) * 0.12;

      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = "#0000ff";
      const data = buf.data;
      for (let y = 0; y < H; y += CELL) {
        for (let x = 0; x < W; x += CELL) {
          // cursor warp: nudge sample origin toward/around the pointer
          let sx = x;
          let sy = y;
          const dx = x - smooth.x;
          const dy = y - smooth.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 130 * 130) {
            const f = (1 - Math.sqrt(d2) / 130) * 6;
            sx += (dx / (Math.sqrt(d2) + 0.001)) * f;
            sy += (dy / (Math.sqrt(d2) + 0.001)) * f;
          }
          const bx = Math.min(bw - 1, Math.max(0, Math.floor(sx)));
          const by = Math.min(bh - 1, Math.max(0, Math.floor(sy)));
          const i = (by * bw + bx) * 4;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          if (lum > 0.985) continue; // skip white background — keep it clean
          // gamma-lift the ink so mid/dark faces read as near-solid, while the
          // top face still shows a gradient of dots
          const ink = Math.pow(1 - lum, 0.65);
          const t = BAYER[(y / CELL) & 3][(x / CELL) & 3];
          if (ink > t) ctx!.fillRect(x, y, DOT, DOT);
        }
      }
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    frame();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full cursor-default" />;
}
