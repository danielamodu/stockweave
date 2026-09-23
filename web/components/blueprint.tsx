// Shared blueprint / wireframe primitives for StockWeave.
// Thin plus marks on grid intersections (with cropped outward wings),
// diagonal hatch fills, and square CTAs with hover corner-pluses.
"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

type Wing = "top" | "right" | "bottom" | "left";

/** A thin plus mark centered on its coordinate. Omit outward wings that
 *  have no border to align with. Position the parent; this centers itself. */
export function GridPlus({
  omit = [],
  tone = "var(--color-plus)",
  size = 11,
  className,
  style,
}: {
  omit?: Wing[];
  tone?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const arm = (size - 1) / 2;
  const bar = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    background: tone,
    borderRadius: 1,
    ...extra,
  });
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2", className)}
      style={{ width: size, height: size, ...style }}
    >
      {!omit.includes("top") && (
        <span style={bar({ left: "50%", top: 0, width: 1, height: arm, transform: "translateX(-50%)" })} />
      )}
      {!omit.includes("bottom") && (
        <span style={bar({ left: "50%", bottom: 0, width: 1, height: arm, transform: "translateX(-50%)" })} />
      )}
      {!omit.includes("left") && (
        <span style={bar({ top: "50%", left: 0, height: 1, width: arm, transform: "translateY(-50%)" })} />
      )}
      {!omit.includes("right") && (
        <span style={bar({ top: "50%", right: 0, height: 1, width: arm, transform: "translateY(-50%)" })} />
      )}
    </span>
  );
}

/** Four corner pluses that hug a button's edges — each corner omits its two
 *  outward wings so arms only trace the button. Lives on its own layer so
 *  opacity fades independently of the label. */
export function CornerPluses({ tone }: { tone: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
    >
      <GridPlus omit={["top", "left"]} tone={tone} className="left-0 top-0" />
      <GridPlus omit={["top", "right"]} tone={tone} className="left-full top-0" />
      <GridPlus omit={["bottom", "left"]} tone={tone} className="left-0 top-full" />
      <GridPlus omit={["bottom", "right"]} tone={tone} className="left-full top-full" />
    </span>
  );
}

/** Diagonal hatch panel. */
export function Hatch({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bp-hatch", className)} />;
}

/** Square CTA with hover corner-pluses. `variant`: soft grey or accent blue. */
export function Cta({
  href,
  variant,
  arrow = false,
  children,
  className,
}: {
  href: string;
  variant: "soft" | "blue";
  arrow?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const blue = variant === "blue";
  return (
    <Link
      href={href}
      className={cn(
        "group relative inline-flex h-11 items-center gap-2 px-5 text-[13px] font-medium no-underline transition-colors duration-150",
        blue
          ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
          : "bg-[var(--color-soft)] text-[var(--color-ink)] hover:bg-[var(--color-soft-hover)]",
        className,
      )}
    >
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
        {arrow && <ArrowUpRight size={15} strokeWidth={2} />}
      </span>
      <CornerPluses tone={blue ? "#000000" : "rgba(0,0,0,0.5)"} />
    </Link>
  );
}
