// Real Solana wallet context (Devnet). Standard wallets (Phantom, Solflare,
// Backpack, …) auto-register via the Wallet Standard, so no per-wallet adapter
// packages are needed. Wraps the whole app from the root layout.
"use client";

import { useCallback, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { emitWalletCancel } from "@/lib/wallet-events";
import "@solana/wallet-adapter-react-ui/styles.css";

// Errors the user causes on purpose (declining the popup, closing the picker)
// are not failures — swallow them quietly. Anything else gets a console warning
// but never throws, so a wallet hiccup can't take the app (or dev server) down.
const BENIGN = new Set([
  "WalletConnectionError", // user rejected the connection request
  "WalletNotSelectedError", // closed the picker without choosing
  "WalletWindowClosedError",
  "WalletUserRejectedError",
]);

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);

  const onError = useCallback((error: WalletError) => {
    if (BENIGN.has(error?.name)) {
      emitWalletCancel(); // tell the connect screen the user backed out
      return;
    }
    console.warn("[wallet]", error?.name, error?.message);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
