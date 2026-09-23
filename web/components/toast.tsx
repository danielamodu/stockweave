// Minimal toast system: a module-level emitter + a Toaster mounted once in the
// layout. `toast("…")` works from anywhere (including right before a route
// change — the Toaster lives above the router, so the message survives).
"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

type Toast = { id: number; message: string };
type Listener = (t: Toast) => void;

let listeners: Listener[] = [];
let counter = 0;

export function toast(message: string) {
  const t = { id: ++counter, message };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 3200);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="bp-toast pointer-events-auto inline-flex items-center gap-2.5 border border-[var(--color-grid-strong)] bg-[var(--color-page)] px-4 py-2.5 text-[13px] text-[var(--color-ink)] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          <span className="inline-grid h-4 w-4 place-items-center text-[var(--color-accent)]">
            <Check size={14} strokeWidth={2.5} />
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
