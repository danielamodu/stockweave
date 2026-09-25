import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Page not found",
};

// Custom 404 — matches the blueprint frame of the standalone routes (top bar +
// bordered canvas) so a mistyped strategy id or dead link lands somewhere on-brand
// with a clear way back, instead of the bare framework default.
export default function NotFound() {
  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 flex min-h-dvh flex-col border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.08em] text-[var(--color-ink)] no-underline transition-colors hover:text-[var(--color-accent)]"
          >
            <ArrowLeft size={15} /> Stockweave
          </Link>
          <span className="bp-mono-label text-[10px]">Error · 404</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <div className="bp-mono-label text-[10px]">404 — not found</div>
          <h1 className="mt-3 font-sans text-[clamp(2rem,5vw,3.25rem)] font-medium uppercase leading-[1.05] tracking-[-0.035em]">
            This page isn&apos;t on the chain
          </h1>
          <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-[var(--color-muted)]">
            The strategy or page you were looking for doesn&apos;t exist here. It may have moved, or the
            link was mistyped.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Link
              href="/"
              className="inline-flex h-11 items-center bg-[var(--color-accent)] px-6 text-[14px] font-medium text-white no-underline transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              Back to home
            </Link>
            <Link
              href="/explore"
              className="inline-flex h-11 items-center bg-[var(--color-soft)] px-6 text-[14px] font-medium text-[var(--color-ink)] no-underline transition-colors hover:bg-[var(--color-soft-hover)]"
            >
              Explore The Weave
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
