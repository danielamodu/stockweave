// Session for the demo flow: a REAL Solana wallet (via wallet-adapter) plus
// the user's follow state and custom mix (kept in localStorage for the demo —
// these would live on-chain in a full build). Multi-basket: the user follows
// one basket at a time and can fork it into a custom mix.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { clearUserConnecting, markUserConnecting } from "@/lib/wallet-events";

const K_FOLLOW = "sw_followed_basket"; // stores the followed basket id
const K_FORK = "sw_fork"; // stores { basketId, weights } for a custom version
const K_WALLET_NAME = "walletName"; // wallet-adapter's remembered wallet (JSON)

// A mix is symbol -> whole-percent weight (e.g. { OPENAI: 30, USDC: 10 }).
export type Mix = Record<string, number>;
// A fork remembers the real Devnet account it was minted into so the dashboard
// can read the strategy straight from chain instead of trusting these weights.
export type Fork = { basketId: string; weights: Mix; onchainId?: string; onchainStrategy?: string };

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readFork(): Fork | null {
  const raw = read(K_FORK);
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Fork;
    if (f && typeof f.basketId === "string" && f.weights) return f;
    return null;
  } catch {
    return null;
  }
}

export function useSession() {
  const { publicKey, connected, connecting, disconnect: walletDisconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const [mounted, setMounted] = useState(false);
  const [graceElapsed, setGraceElapsed] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  // Whether the wallet-adapter remembers a previously-selected wallet — i.e. the
  // visitor has connected here before. Lets the connect screen say "reconnect /
  // unlock" instead of a cold "connect", and drives the returning-user routing.
  const [hadWallet, setHadWallet] = useState(false);
  const [followedBasketId, setFollowedBasketId] = useState<string | null>(null);
  const [fork, setForkState] = useState<Fork | null>(null);

  useEffect(() => {
    const sync = () => {
      setFollowedBasketId(read(K_FOLLOW));
      setForkState(readFork());
      const remembered = read(K_WALLET_NAME);
      setHadWallet(Boolean(remembered) && remembered !== "null" && remembered !== '""');
    };
    sync();
    setMounted(true);
    // Dev-only design preview: `?preview=1` fakes a connected wallet so the
    // wallet-gated dashboard/make/strategy screens render fully without a
    // browser wallet. The flag is kept in sessionStorage so it survives
    // client-side navigation between the /dashboard routes. Never active in a
    // production build.
    if (process.env.NODE_ENV !== "production") {
      let preview = sessionStorage.getItem("sw_preview") === "1";
      if (new URLSearchParams(window.location.search).get("preview") === "1") {
        preview = true;
        try {
          sessionStorage.setItem("sw_preview", "1");
        } catch {}
      }
      if (preview) setPreviewMode(true);
    }
    // Ceiling on how long we'll wait for autoConnect. A flaky standard wallet
    // (e.g. MetaMask's Solana shim) can hang `connecting` forever; without this
    // the wallet-gated pages would sit on a blank screen and never redirect.
    // Kept generous so a returning visitor unlocking their wallet (typing a
    // Phantom password) isn't bounced to /connect mid-unlock.
    const t = setTimeout(() => setGraceElapsed(true), 6000);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("storage", sync);
      clearTimeout(t);
    };
  }, []);

  // short-circuit the "not connected" redirect while autoConnect is resolving,
  // but never wait past the grace ceiling — a stuck wallet must not freeze us.
  const ready = previewMode || (mounted && (!connecting || graceElapsed));
  const wallet = previewMode
    ? "Preview1111111111111111111111111111111111111"
    : connected && publicKey
      ? publicKey.toBase58()
      : null;
  const walletShort = wallet ? wallet.slice(0, 4) + "…" + wallet.slice(-4) : null;
  const isConnecting = connecting;

  const following = followedBasketId !== null;
  // customMix only applies when the fork is for the basket currently followed.
  const forkForFollowed = fork && fork.basketId === followedBasketId ? fork : null;
  const customMix = forkForFollowed ? forkForFollowed.weights : null;
  // Real on-chain account for the followed custom basket, when it was minted.
  const customOnchain =
    forkForFollowed && forkForFollowed.onchainId
      ? { id: forkForFollowed.onchainId, strategy: forkForFollowed.onchainStrategy ?? null }
      : null;

  const connect = useCallback(() => {
    markUserConnecting(); // so a later cancel (not a locked-wallet autoConnect) can show the hint
    setVisible(true);
  }, [setVisible]);

  // Once a wallet actually connects, drop the "user is connecting" flag and
  // remember that this visitor has a wallet — so a stray benign error afterwards
  // can't retroactively raise "Connection cancelled".
  useEffect(() => {
    if (connected) {
      clearUserConnecting();
      setHadWallet(true);
    }
  }, [connected]);

  const disconnect = useCallback(() => {
    [K_FOLLOW, K_FORK].forEach((k) => window.localStorage.removeItem(k));
    setFollowedBasketId(null);
    setForkState(null);
    setHadWallet(false);
    void walletDisconnect();
  }, [walletDisconnect]);

  // Follow an official basket. Drops any custom fork tied to a different basket.
  const follow = useCallback((basketId: string) => {
    window.localStorage.setItem(K_FOLLOW, basketId);
    setFollowedBasketId(basketId);
    const existing = readFork();
    if (existing && existing.basketId !== basketId) {
      window.localStorage.removeItem(K_FORK);
      setForkState(null);
    }
  }, []);

  // Save a custom fork of a basket and follow it. `onchain` records the real
  // Devnet account when the fork was minted on-chain (via createBasketOnchain).
  const setCustomMix = useCallback(
    (basketId: string, weights: Mix, onchain?: { onchainId?: string; onchainStrategy?: string }) => {
      const f: Fork = { basketId, weights, ...onchain };
      window.localStorage.setItem(K_FORK, JSON.stringify(f));
      window.localStorage.setItem(K_FOLLOW, basketId);
      setForkState(f);
      setFollowedBasketId(basketId);
    },
    [],
  );

  return {
    wallet,
    walletShort,
    isConnecting,
    hadWallet,
    followedBasketId,
    following,
    customMix,
    customOnchain,
    ready,
    connect,
    disconnect,
    follow,
    setCustomMix,
  };
}
