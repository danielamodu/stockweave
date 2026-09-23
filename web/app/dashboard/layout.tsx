"use client";

// Dashboard shell: a persistent, non-scrolling left rail + a sticky top bar,
// shared by every /dashboard route. Data lives in <DashboardProvider> so the
// Overview / Holdings / Assistant pages all read the same live figures.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Layers, Copy, SlidersHorizontal, Bot, Menu, X } from "lucide-react";
import { DashboardProvider, useDashboard } from "@/components/dashboard/context";
import { cn } from "@/lib/utils";

// Left-rail item — blue when active, with a short accent tick on the left.
function NavItem({
  icon: Icon,
  label,
  href,
  active,
  muted,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  href: string;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    "group relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] no-underline transition-colors",
    active
      ? "text-[var(--color-accent)]"
      : muted
        ? "pointer-events-none text-[var(--color-faint)]"
        : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
  );
  return (
    <Link href={muted ? "#" : href} aria-disabled={muted} onClick={onClick} className={cls}>
      {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-[var(--color-accent)]" />}
      <Icon size={15} />
      <span>{label}</span>
    </Link>
  );
}
// Shared nav body — the Main/Invest sections. Used by both the desktop rail and
// the mobile drawer; `onNavigate` lets the drawer close itself on a tap.
function NavSections({ onNavigate }: { onNavigate?: () => void }) {
  const { following, stratHref, makeHref } = useDashboard();
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;
  return (
    <nav className="flex-1 px-2 py-4">
      <div className="bp-mono-label px-3 pb-1 text-[8px]">Main</div>
      <NavItem icon={LayoutGrid} label="Overview" href="/dashboard" active={isActive("/dashboard")} onClick={onNavigate} />
      <NavItem icon={Layers} label="Holdings" href="/dashboard/holdings" active={isActive("/dashboard/holdings")} muted={!following} onClick={onNavigate} />
      <div className="bp-mono-label px-3 pb-1 pt-4 text-[8px]">Invest</div>
      <NavItem icon={Bot} label="Assistant" href="/dashboard/assistant" active={isActive("/dashboard/assistant")} muted={!following} onClick={onNavigate} />
      <NavItem icon={Copy} label="Strategy" href={stratHref} muted={!following} onClick={onNavigate} />
      <NavItem icon={SlidersHorizontal} label="Make your own" href={makeHref} muted={!following} onClick={onNavigate} />
    </nav>
  );
}

// Persistent, non-scrolling rail — sticky at the top, its own viewport height.
function Sidebar() {
  const { walletShort, onDisconnect } = useDashboard();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[212px] shrink-0 flex-col self-start border-r border-[var(--color-grid)] lg:flex">
      <div className="border-b border-[var(--color-grid)] px-5 py-4">
        <Link href="/" className="block text-[14px] uppercase tracking-[0.1em] no-underline text-[var(--color-ink)]">
          Stockweave
        </Link>
        <div className="bp-mono-label mt-1 text-[8px]">Strategy desk</div>
      </div>
      <NavSections />
      <div className="border-t border-[var(--color-grid)] p-4">
        <div className="bp-mono-label text-[8px]">Wallet</div>
        <div className="mt-1 font-mono text-[11px] text-[var(--color-ink)]">{walletShort ?? "—"}</div>
        <button
          onClick={onDisconnect}
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Disconnect
        </button>
      </div>
    </aside>
  );
}
// Mobile navigation — below `lg` the rail is hidden, so this slide-in drawer is
// the only top-level nav on phones. Closes on tap-through, backdrop click, the
// X, or Escape; also locks background scroll while open.
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { walletShort, onDisconnect } = useDashboard();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button
        aria-label="Close menu"
        onClick={onClose}
        className="bp-backdrop absolute inset-0 h-full w-full cursor-default bg-black/30 backdrop-blur-sm"
      />
      <div className="bp-drawer absolute left-0 top-0 flex h-dvh w-[260px] max-w-[80vw] flex-col border-r border-[var(--color-grid)] bg-[var(--color-page)]">
        <div className="flex items-center justify-between border-b border-[var(--color-grid)] px-5 py-4">
          <div>
            <Link
              href="/"
              onClick={onClose}
              className="block text-[14px] uppercase tracking-[0.1em] no-underline text-[var(--color-ink)]"
            >
              Stockweave
            </Link>
            <div className="bp-mono-label mt-1 text-[8px]">Strategy desk</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-8 w-8 shrink-0 place-items-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </div>
        <NavSections onNavigate={onClose} />
        <div className="border-t border-[var(--color-grid)] p-4">
          <div className="bp-mono-label text-[8px]">Wallet</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-ink)]">{walletShort ?? "—"}</div>
          <button
            onClick={() => {
              onClose();
              onDisconnect();
            }}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

const CRUMB: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/holdings": "Holdings",
  "/dashboard/assistant": "Assistant",
};

// Sticky top bar: breadcrumb, the demo scenario switch, live + wallet chips.
function TopBar({ onMenu }: { onMenu: () => void }) {
  const { following, isLive, walletShort } = useDashboard();
  const pathname = usePathname();
  const crumb = following ? CRUMB[pathname] ?? "Overview" : "Browse";
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-grid)] bg-[var(--color-page)]/95 px-4 py-3.5 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
        <button
          onClick={onMenu}
          aria-label="Open menu"
          className="-ml-1 grid h-8 w-8 shrink-0 place-items-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] lg:hidden"
        >
          <Menu size={18} />
        </button>
        <Link href="/" className="no-underline text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] lg:hidden">
          Stockweave
        </Link>
        <span className="hidden lg:inline">Desk</span>
        <span className="text-[var(--color-faint)]">/</span>
        <span className="text-[var(--color-ink)]">{crumb}</span>
      </div>
      <div className="flex items-center gap-3">
        {isLive && following && (
          <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)] sm:inline-flex">
            <span className="bp-pulse h-1.5 w-1.5 rounded-full bg-[var(--color-up)]" /> Live
          </span>
        )}
        <span className="font-mono text-[11px] text-[var(--color-muted)]">{walletShort}</span>
      </div>
    </div>
  );
}

// Gate + frame. Blank while the session resolves so a disconnected user never
// flashes the app before the redirect fires.
function Shell({ children }: { children: React.ReactNode }) {
  const { ready, wallet } = useDashboard();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the mobile drawer whenever the route changes (belt-and-braces with the
  // per-item onNavigate) so it never lingers over a freshly navigated page.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  if (!ready || !wallet) return <div className="min-h-dvh bg-[var(--color-page)]" />;
  return (
    <main className="min-h-dvh bg-[var(--color-page)] text-[var(--color-ink)]">
      <div className="mx-3 flex min-h-dvh items-start border-x border-[var(--color-grid)] sm:mx-6 lg:mx-10">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <TopBar onMenu={() => setMenuOpen(true)} />
          <div className="px-4 py-8 sm:px-6 lg:px-8">{children}</div>
        </div>
      </div>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </main>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Shell>{children}</Shell>
    </DashboardProvider>
  );
}


