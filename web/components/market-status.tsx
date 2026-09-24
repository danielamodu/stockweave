"use client";

// Live market-status strip — the small heartbeat that makes the desk read as a
// real-time financial terminal, not a static page. Every value is real: the
// block height is polled off the same RPC the app trades through (so it doubles
// as a "chain connection is alive" signal), and the clock is a running UTC tick.
// Styled in the existing blueprint vocabulary — mono micro-labels, hairline
// dividers, one pulse dot — so it adds signal without adding colour or chrome.
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

export function MarketStatus() {
  const { connection } = useConnection();
  const [block, setBlock] = useState<number | null>(null);
  const [clock, setClock] = useState("");

  // Poll the live Solana block height every 10s. Reads succeed even on a
  // rate-limited RPC, so this stays lit regardless of the trade path.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const h = await connection.getBlockHeight("confirmed");
        if (live) setBlock(h);
      } catch {
        /* keep the last good value */
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection]);

  // Running UTC clock. Seeded in an effect (never during render) so SSR and the
  // first client paint agree — no hydration flash.
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
    setClock(fmt());
    const id = setInterval(() => setClock(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  const Dot = () => <span className="text-[var(--color-grid-strong)]">·</span>;

  return (
    <div className="hidden items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)] md:flex">
      <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
        <span className="bp-pulse h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        Devnet
      </span>
      <Dot />
      <span className="tabular-nums text-[var(--color-muted)]">blk {block == null ? "—" : block.toLocaleString()}</span>
      <Dot />
      <span className="tabular-nums text-[var(--color-muted)]">{clock || "—"} utc</span>
    </div>
  );
}
