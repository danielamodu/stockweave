"use client";

// Shared data + orchestration for every dashboard route. Lives once in the
// layout so switching between Overview / Holdings / Assistant keeps the same
// live figures, scenario and approval state. Nothing here is invented in the
// browser — strategy + agent numbers come straight from the engine API.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useSession } from "@/lib/session";
import { plainStatus, plainSuggestion, pct, segTone } from "@/lib/present";
import { toast } from "@/components/toast";
import type { Agent, Basket, PriceSnap, Strategy } from "@/components/dashboard/ui";
import {
  approveRebalanceOnchain,
  executeRebalanceOnchain,
  readOfficialStrategy,
  readStrategyById,
  readWalletTokenBalances,
  type OnchainStrategyState,
} from "@/lib/onchain";

export type DashboardValue = {
  // session / gate
  ready: boolean;
  wallet: string | null;
  walletShort: string | null;
  following: boolean;
  followedBasketId: string | null;
  isFork: boolean;
  onDisconnect: () => void;
  // catalogue
  baskets: Basket[];
  onFollow: (b: Basket) => void;
  // raw + loading
  data: Strategy | null;
  agent: Agent | null;
  loading: boolean;
  // real on-chain state for the followed basket (rules + agent permission)
  onchain: OnchainStrategyState | null;
  // derived figures
  isLive: boolean;
  total: number;
  change24h: number | null;
  holdingCount: number;
  cashPct: number | null;
  followedName: string;
  followedTheme: string;
  status: ReturnType<typeof plainStatus> | null;
  order: string[];
  displayWeights?: Record<string, number>;
  donutSegs: { key: string; pct: number; color: string }[];
  prices: Record<string, PriceSnap>;
  movers: PriceSnap[];
  // real holdings — the connected wallet's actual token balances for this basket
  hasHoldings: boolean;
  holdingsLoading: boolean;
  holdingsBySymbol: Record<string, number> | null;
  // agent proposal flow
  suggestion: { text: string } | null;
  proposal: AgentProposal | null;
  canRunAgent: boolean;
  requestingProposal: boolean;
  approving: boolean;
  requestProposal: () => void;
  approved: boolean;
  onApprove: () => void;
  onSkip: () => void;
  activity: string[];
  // links
  makeHref: string;
  stratHref: string;
};

// A REAL on-chain proposal returned by /api/agent/propose (agent-signed). The
// connected wallet (strategy creator) then approves + executes it.
export type AgentProposal = {
  strategy: string;
  proposalId: number;
  approvalNonce: number;
  mint: string;
  symbol: string;
  newTargetWeightBps: number;
  notional: number;
  text: string;
  signature: string;
};

const Ctx = createContext<DashboardValue | null>(null);

export function useDashboard(): DashboardValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used within <DashboardProvider>");
  return v;
}
// __CTX_APPEND__

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { wallet, walletShort, ready, following, followedBasketId, customMix, customOnchain, disconnect, follow } = useSession();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [data, setData] = useState<Strategy | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [onchain, setOnchain] = useState<OnchainStrategyState | null>(null);
  const [approved, setApproved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  // Real on-chain agent proposal (agent-signed) awaiting the creator's approval.
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [requestingProposal, setRequestingProposal] = useState(false);
  const [approving, setApproving] = useState(false);
  // Connected wallet's REAL token balances for the followed basket (symbol → uiAmount).
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, number> | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  // Wallet-gate: once the session has resolved, a disconnected user goes back.
  useEffect(() => {
    if (ready && !wallet) router.replace("/connect");
  }, [ready, wallet, router]);

  // Catalogue — used by the browse screen and to order/name the followed mix.
  useEffect(() => {
    let live = true;
    fetch("/api/baskets")
      .then((r) => r.json())
      .then((d) => {
        if (live) setBaskets(d.baskets ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Live strategy + agent proposal for the followed basket (always real state).
  useEffect(() => {
    if (!following || !followedBasketId) {
      setData(null);
      setAgent(null);
      return;
    }
    let live = true;
    setData(null);
    setAgent(null);
    const qs = "?basket=" + encodeURIComponent(followedBasketId);
    Promise.all([
      fetch("/api/strategy" + qs).then((r) => r.json()),
      fetch("/api/agent" + qs).then((r) => r.json()),
    ])
      .then(([s, a]) => {
        if (!live) return;
        setData(s);
        setAgent(a);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [following, followedBasketId]);

  // A new basket is a fresh decision — clear any prior approve/skip/proposal.
  useEffect(() => {
    setApproved(false);
    setDismissed(false);
    setProposal(null);
  }, [followedBasketId]);
  // Read the REAL on-chain strategy for the followed basket: a custom fork reads
  // its own minted account (creator = connected wallet), else the canonical
  // official strategy. Powers the "enforced on-chain" limits + agent permission.
  useEffect(() => {
    if (!following || !followedBasketId) {
      setOnchain(null);
      return;
    }
    let live = true;
    setOnchain(null);
    let read: Promise<OnchainStrategyState>;
    try {
      read =
        customOnchain?.id && wallet
          ? readStrategyById(connection, new PublicKey(wallet), customOnchain.id)
          : readOfficialStrategy(connection, followedBasketId);
    } catch {
      read = readOfficialStrategy(connection, followedBasketId);
    }
    read.then((s) => live && setOnchain(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [following, followedBasketId, customOnchain?.id, wallet, connection]);
  // __CTX_APPEND2__

  const onFollow = useCallback(
    (b: Basket) => {
      follow(b.id);
      toast("You're following " + b.name);
    },
    [follow],
  );

  // Approve: if a REAL agent proposal is live and the connected wallet is the
  // strategy's on-chain creator, approve + execute it on-chain (two wallet-signed
  // txns). Otherwise fall back to a local acknowledgement (official baskets the
  // user only follows, preview mode, or no agent configured).
  const onApprove = useCallback(async () => {
    if (proposal && publicKey && onchain?.creator === publicKey.toBase58()) {
      setApproving(true);
      try {
        const strategyPk = new PublicKey(proposal.strategy);
        await approveRebalanceOnchain({
          connection,
          walletPublicKey: publicKey,
          sendTransaction,
          strategy: strategyPk,
          proposalId: proposal.proposalId,
          approvalNonce: proposal.approvalNonce,
        });
        const execSig = await executeRebalanceOnchain({
          connection,
          walletPublicKey: publicKey,
          sendTransaction,
          strategy: strategyPk,
          proposalId: proposal.proposalId,
        });
        setApproved(true);
        setActivity((a) => [`You approved + executed on-chain · ${execSig.slice(0, 8)}… · just now`, ...a]);
        toast("Approved + executed on-chain");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast(`Couldn't submit: ${msg}`);
      } finally {
        setApproving(false);
      }
      return;
    }
    setApproved(true);
    setActivity((a) => ["You approved a tune-up · just now", ...a]);
    toast("Change approved");
  }, [proposal, publicKey, onchain, connection, sendTransaction]);

  const onSkip = useCallback(() => {
    setProposal(null);
    setDismissed(true);
  }, []);

  // Ask the constrained backend agent to read the on-chain strategy + live prices
  // and (if the mix has drifted past its band) sign a REAL propose_rebalance. Only
  // meaningful for a basket the connected wallet owns — it approves the result.
  const requestProposal = useCallback(async () => {
    const creator = onchain?.creator;
    const strategyId = customOnchain?.id ?? followedBasketId;
    if (!onchain?.exists || !creator || !strategyId) return;
    setRequestingProposal(true);
    try {
      const res = await fetch("/api/agent/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creator, strategyId }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast(d?.message || "The agent couldn't propose right now.");
        return;
      }
      if (!d.ok || !d.signature) {
        toast(d?.reason === "WITHIN_DRIFT_BAND" ? "Agent checked — the mix is within its drift band." : "Nothing to propose right now.");
        return;
      }
      setProposal({
        strategy: d.strategy,
        proposalId: d.proposalId,
        approvalNonce: d.approvalNonce,
        mint: d.mint,
        symbol: d.symbol,
        newTargetWeightBps: d.newTargetWeightBps,
        notional: d.notional,
        text: d.text,
        signature: d.signature,
      });
      setApproved(false);
      setDismissed(false);
      setActivity((a) => [`Agent proposed a tune-up on-chain · ${String(d.signature).slice(0, 8)}… · just now`, ...a]);
      toast("Agent proposed a tune-up");
    } catch {
      toast("Couldn't reach the agent service.");
    } finally {
      setRequestingProposal(false);
    }
  }, [onchain, customOnchain?.id, followedBasketId]);

  const onDisconnect = useCallback(() => {
    disconnect();
    router.replace("/connect");
  }, [disconnect, router]);

  // --- derived (all from real engine output) ---
  const isFork = Boolean(customMix);
  const isLive = data?.dataMode === "LIVE";
  const loading = following && !data;

  const followedBasket = useMemo(
    () => baskets.find((b) => b.id === followedBasketId) ?? null,
    [baskets, followedBasketId],
  );

  // Weights in bps. A fork stores whole-percent weights → scale to bps so the
  // whole UI (donut, legend, holdings) can share one pct() convention.
  const displayWeights = useMemo<Record<string, number> | undefined>(() => {
    if (customMix) {
      const w: Record<string, number> = {};
      for (const [k, v] of Object.entries(customMix)) w[k] = v * 100;
      return w;
    }
    return data?.valuation.targetWeights;
  }, [customMix, data]);

  const order = useMemo(() => {
    if (followedBasket) return followedBasket.constituents.map((c) => c.symbol);
    if (displayWeights) return Object.keys(displayWeights);
    return [];
  }, [followedBasket, displayWeights]);

  const priceBySym = useMemo(() => {
    const m: Record<string, PriceSnap> = {};
    for (const t of data?.tokenPrices ?? []) if (t.symbol) m[t.symbol] = t;
    return m;
  }, [data]);
  // Map each basket symbol to its real mint (served by /api/baskets from the
  // approved registry) so we can read the wallet's actual balances.
  const mintBySymbol = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of baskets) for (const c of b.constituents) if (c.mint) m[c.symbol] = c.mint;
    return m;
  }, [baskets]);

  // Read the connected wallet's REAL token balances for the followed basket.
  // The protocol custodies nothing, so this is the wallet's own holdings —
  // genuinely empty ($0) until the user buys the assets. No modelled portfolio.
  const mintsKey = order.map((s) => mintBySymbol[s] ?? "").join(",");
  useEffect(() => {
    if (!publicKey || !following) {
      setTokenAmounts(null);
      return;
    }
    const mints = order.map((s) => mintBySymbol[s]).filter(Boolean) as string[];
    if (mints.length === 0) {
      setTokenAmounts(null);
      return;
    }
    let live = true;
    setHoldingsLoading(true);
    readWalletTokenBalances(connection, publicKey, mints)
      .then((byMint) => {
        if (!live) return;
        const bySym: Record<string, number> = {};
        for (const s of order) {
          const mint = mintBySymbol[s];
          bySym[s] = mint ? byMint[mint] ?? 0 : 0;
        }
        setTokenAmounts(bySym);
      })
      .catch(() => live && setTokenAmounts({}))
      .finally(() => {
        if (live) setHoldingsLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, following, connection, mintsKey]);
  // Value those real balances at live prices (USDC pinned to $1). A missing
  // price contributes nothing rather than inventing a mark.
  const holdingsBySymbol = useMemo(() => {
    if (!tokenAmounts) return null;
    const out: Record<string, number> = {};
    for (const s of order) {
      const amt = tokenAmounts[s] ?? 0;
      const price = s === "USDC" ? 1 : priceBySym[s]?.price ?? 0;
      out[s] = amt * (price ?? 0);
    }
    return out;
  }, [tokenAmounts, order, priceBySym]);

  const total = useMemo(
    () => (holdingsBySymbol ? Object.values(holdingsBySymbol).reduce((a, b) => a + b, 0) : 0),
    [holdingsBySymbol],
  );
  const hasHoldings = total > 0;
  // __CTX_APPEND3__

  const donutSegs = useMemo(
    () =>
      order.map((s, i) => ({
        key: s,
        pct: displayWeights ? pct(displayWeights[s] ?? 0) : 0,
        color: s === "USDC" ? "var(--color-grid-strong)" : segTone(s, i),
      })),
    [order, displayWeights],
  );

  // "Today" is YOUR position's move — weighted by what you actually hold. With
  // no holdings there is no personal P&L to show, so it reads as "—". (The
  // strategy's own live moves still show per-asset and in Today's movers.)
  const change24h = useMemo(() => {
    if (!hasHoldings || !holdingsBySymbol || total <= 0) return null;
    let acc = 0;
    for (const s of order) {
      if (s === "USDC") continue;
      const ch = priceBySym[s]?.priceChange24h;
      if (ch != null) acc += (holdingsBySymbol[s] / total) * ch;
    }
    return acc;
  }, [hasHoldings, holdingsBySymbol, total, order, priceBySym]);

  const movers = useMemo(
    () =>
      (data?.tokenPrices ?? [])
        .filter((t) => t.symbol !== "USDC" && t.priceChange24h != null)
        .sort((a, b) => Math.abs(b.priceChange24h ?? 0) - Math.abs(a.priceChange24h ?? 0)),
    [data],
  );

  const holdingCount = order.filter((s) => s !== "USDC").length;
  const cashPct = displayWeights ? pct(displayWeights["USDC"] ?? 0) : null;
  const followedName = data?.basket?.name ?? followedBasket?.name ?? "Your strategy";
  const followedTheme = data?.basket?.theme ?? followedBasket?.theme ?? "";
  const status = data ? plainStatus(data.valuation.state) : null;
  const suggestion = !dismissed && agent ? plainSuggestion(agent.decision) : null;
  // The real approve/execute loop only works when the connected wallet is the
  // strategy's on-chain creator (its own basket) — official baskets are read-only.
  const canRunAgent = Boolean(publicKey) && Boolean(onchain?.exists) && onchain?.creator === publicKey?.toBase58();
  const makeHref = "/make?basket=" + (followedBasketId ?? "");
  const stratHref = "/strategy/" + (followedBasketId ?? "");
  // __CTX_APPEND4__

  const value: DashboardValue = {
    ready,
    wallet,
    walletShort,
    following,
    followedBasketId,
    isFork,
    onDisconnect,
    baskets,
    onFollow,
    data,
    agent,
    loading,
    onchain,
    isLive,
    total,
    change24h,
    holdingCount,
    cashPct,
    followedName,
    followedTheme,
    status,
    order,
    displayWeights,
    donutSegs,
    prices: priceBySym,
    movers,
    hasHoldings,
    holdingsLoading,
    holdingsBySymbol,
    suggestion,
    proposal,
    canRunAgent,
    requestingProposal,
    approving,
    requestProposal,
    approved,
    onApprove,
    onSkip,
    activity,
    makeHref,
    stratHref,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;



}

