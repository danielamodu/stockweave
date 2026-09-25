// Real Solana wallet context (Devnet). Standard wallets (Phantom, Solflare,
// Backpack, …) auto-register via the Wallet Standard, so no per-wallet adapter
// packages are needed. Wraps the whole app from the root layout.
"use client";

import { useCallback, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { clearUserConnecting, emitWalletCancel, wasUserInitiated } from "@/lib/wallet-events";
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
  // Pick the client's RPC. The public devnet endpoint is heavily rate-limited and
  // makes wallet-signed txns time out ("block height exceeded"), so:
  //   1. an explicit NEXT_PUBLIC_SOLANA_RPC full URL wins (direct; browser-exposed,
  //      so Devnet-only) — handy for local dev;
  //   2. otherwise use the same-origin `/api/rpc` proxy, which forwards to a
  //      server-only Devnet RPC so no key ships in the client bundle;
  //   3. server-render / no window → public devnet as a last resort.
  //
  // The `?cluster=devnet` suffix on the proxy URL is load-bearing, not cosmetic:
  // wallet-adapter picks the chain it tells Phantom to broadcast on by string-
  // matching the RPC endpoint (getChainForEndpoint → /\bdevnet\b/i), and DEFAULTS
  // TO MAINNET for anything it can't recognize. A bare `/api/rpc` therefore made
  // Phantom fetch a Devnet blockhash from us but broadcast to MAINNET, which drops
  // the tx (unknown blockhash) — surfacing as "block height exceeded" once our
  // Devnet poll gives up. The proxy ignores the query string, so this only steers
  // wallet-adapter's cluster inference; it does not change where requests go.
  const endpoint = useMemo(() => {
    const direct = (process.env.NEXT_PUBLIC_SOLANA_RPC ?? "").trim();
    if (/^https?:\/\//i.test(direct)) {
      // A direct Devnet URL that lacks the word "devnet" (e.g. a custom RPC host)
      // would also be misread as mainnet — tag it so the chain inference is right.
      return /\bdevnet\b/i.test(direct) ? direct : `${direct}${direct.includes("?") ? "&" : "?"}cluster=devnet`;
    }
    if (typeof window !== "undefined") return `${window.location.origin}/api/rpc?cluster=devnet`;
    return clusterApiUrl("devnet");
  }, []);

  const onError = useCallback((error: WalletError) => {
    if (BENIGN.has(error?.name)) {
      // Only the user tapping "Connect" and then backing out should surface the
      // "Connection cancelled" hint. A background autoConnect that fails because
      // the wallet is simply locked throws the same benign error — stay quiet so
      // a returning visitor isn't told they cancelled something they never did.
      if (wasUserInitiated()) {
        clearUserConnecting();
        emitWalletCancel();
      }
      return;
    }
    clearUserConnecting();
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
