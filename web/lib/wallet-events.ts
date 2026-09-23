// Tiny signal so the WalletProvider (which catches connection errors) can tell
// the connect screen that the user backed out of the wallet popup.
"use client";

import { useEffect, useState } from "react";

let listeners: (() => void)[] = [];

export function emitWalletCancel() {
  listeners.forEach((l) => l());
}

// Returns a counter that increments each time the user cancels a connection.
export function useWalletCancelled(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const l = () => setCount((c) => c + 1);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return count;
}
