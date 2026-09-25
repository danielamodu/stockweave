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

// Did the CURRENT connection attempt start from a user tapping "Connect"? The
// provider's onError swallows the same benign errors for a user cancel AND for a
// silent autoConnect that fails because the wallet is just locked — but only the
// first should raise "Connection cancelled" on the connect screen. connect()
// marks this true; a successful connect (or the next error) clears it, so an
// autoConnect failure on a locked wallet never shows the scary banner.
let userInitiated = false;
export function markUserConnecting() {
  userInitiated = true;
}
export function clearUserConnecting() {
  userInitiated = false;
}
export function wasUserInitiated(): boolean {
  return userInitiated;
}
