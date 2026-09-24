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
  faucetUsdcOnchain,
  OFFICIAL_CREATOR,
  readAssetPrices,
  readNavHistory,
  readOfficialStrategy,
  readStrategyById,
  readWalletTokenBalances,
  redeemFromBasketOnchain,
  sizeAssetQtyFromPriceU,
  strategyAddress,
  subscribeToBasketOnchain,
  type NavSeries,
  type OnchainStrategyState,
  type RedeemLeg,
  type SubscribeLeg,
} from "@/lib/onchain";
import { devnetAsset, devnetMintBySymbol, devnetSeeded, devnetUsdc } from "@/lib/devnet-registry";

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
  // forward-tracked, on-chain NAV proof-of-return (record_nav ring); null = loading
  nav: NavSeries | null;
  navLoading: boolean;
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
  // funded = holds ≥1 non-cash asset of this basket (USDC alone doesn't count)
  hasAssetHoldings: boolean;
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
  // Devnet mirror buy/faucet — only meaningful once the mirror mints are seeded.
  devnetReady: boolean;
  usdcBalance: number | null;
  fauceting: boolean;
  buying: boolean;
  selling: boolean;
  getTestUsdc: () => void;
  buyBasket: () => void;
  sellBasket: () => void;
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
  projectedReserveBps: number;
  maxDriftBps: number;
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
  const [nav, setNav] = useState<NavSeries | null>(null);
  const [navLoading, setNavLoading] = useState(false);
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
  // Devnet mirror buy/faucet: in-flight flags + a tick bumped after each on-chain
  // action so the balance effect re-reads the wallet's real holdings.
  const [fauceting, setFauceting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [selling, setSelling] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
    // Drop the previous basket's balances so the setup gate re-reads cleanly for
    // the new pick (no stale "funded" flash while the new balances load).
    setTokenAmounts(null);
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

  // Read the forward-tracked on-chain NAV ring for the followed strategy. The
  // keeper records real live-priced snapshots into a PDA at [b"nav", strategy];
  // this is the honest proof-of-return (no back-fill — pre-IPO mirror assets have
  // no price history). A fork with no snapshots yet reads back empty, and the
  // panel says so rather than inventing a curve.
  useEffect(() => {
    if (!following || !followedBasketId) {
      setNav(null);
      return;
    }
    let live = true;
    setNav(null);
    setNavLoading(true);
    let strategyPk: PublicKey;
    try {
      strategyPk =
        customOnchain?.id && wallet
          ? strategyAddress(new PublicKey(wallet), customOnchain.id)
          : strategyAddress(OFFICIAL_CREATOR, followedBasketId);
    } catch {
      strategyPk = strategyAddress(OFFICIAL_CREATOR, followedBasketId);
    }
    readNavHistory(connection, strategyPk)
      .then((s) => live && setNav(s))
      .catch(() => live && setNav({ count: 0, points: [] }))
      .finally(() => live && setNavLoading(false));
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
        // Size the on-chain trim: burn the asset-quantity worth `notional` USDC,
        // bound to an on-chain PUBLISHED price (D-703). The execute tx publishes a
        // fresh price for the pick (creator-signed — this branch only runs when the
        // wallet IS the strategy creator, i.e. its own fork) and the program checks
        // assetQty against it. priceU = USDC base units (6 dp) per whole token; we
        // size assetQty from priceU so it matches the program's expected_qty within
        // rounding. The USDC leg stays fixed on-chain by the guarded notional.
        const usdc = devnetUsdc();
        const price = data?.tokenPrices?.find((t) => t.symbol === proposal.symbol)?.price ?? 0;
        const priceU = Math.round(price * 1_000_000);
        const usdcOutBase = proposal.notional * 1_000_000; // whole USDC → 6 dp base units
        const assetQty =
          usdc?.mint && priceU > 0 ? Number(sizeAssetQtyFromPriceU(usdcOutBase, priceU)) : 0;
        if (assetQty > 0 && usdc?.mint && priceU > 0) {
          const execSig = await executeRebalanceOnchain({
            connection,
            walletPublicKey: publicKey,
            sendTransaction,
            strategy: strategyPk,
            proposalId: proposal.proposalId,
            assetMint: new PublicKey(proposal.mint),
            usdcMint: new PublicKey(usdc.mint),
            assetQty,
            priceU,
          });
          setApproved(true);
          setActivity((a) => [
            `You approved + executed on-chain · trimmed ${proposal.symbol} · ${execSig.slice(0, 8)}… · just now`,
            ...a,
          ]);
          toast("Approved + executed on-chain");
        } else {
          setApproved(true);
          setActivity((a) => ["You approved on-chain · execution needs a live price + test mints · just now", ...a]);
          toast("Approved on-chain");
        }
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
  }, [proposal, publicKey, onchain, connection, sendTransaction, data]);

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
        projectedReserveBps: d.projectedReserveBps,
        maxDriftBps: d.maxDriftBps,
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
    // Prefer the Devnet mirror mints once seeded — the wallet can genuinely hold
    // and buy those on-chain. Fall back to the real mainnet mints otherwise.
    if (devnetSeeded()) return devnetMintBySymbol();
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
  }, [publicKey, following, connection, mintsKey, refreshTick]);
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
  // "Funded" = the wallet actually holds at least one non-cash asset of this
  // basket. Unlike hasHoldings it ignores USDC, so a wallet that only fauceted
  // test USDC (no deposit yet) still reads as not-yet-funded and the setup flow
  // keeps guiding it to deposit before the basket goes live.
  const hasAssetHoldings = useMemo(
    () => !!tokenAmounts && order.some((s) => s !== "USDC" && (tokenAmounts[s] ?? 0) > 0),
    [tokenAmounts, order],
  );

  // --- Devnet mirror buy/faucet (real on-chain, wallet-signed) ---
  const devnetReady = devnetSeeded();
  const usdcBalance = tokenAmounts ? tokenAmounts["USDC"] ?? 0 : null;

  // Mint capped Devnet test-USDC to the connected wallet (one wallet-signed txn),
  // then re-read balances. No server key — the program's vault PDA is the mint
  // authority, so the program itself signs the mint.
  const getTestUsdc = useCallback(async () => {
    const usdc = devnetUsdc();
    if (!publicKey || !usdc?.mint) return;
    setFauceting(true);
    try {
      const amountBaseUnits = 1_000 * 10 ** usdc.decimals; // 1,000 test USDC
      const sig = await faucetUsdcOnchain({
        connection,
        walletPublicKey: publicKey,
        sendTransaction,
        usdcMint: new PublicKey(usdc.mint),
        amountBaseUnits,
      });
      setRefreshTick((t) => t + 1);
      setActivity((a) => [`You minted 1,000 test USDC on-chain · ${sig.slice(0, 8)}… · just now`, ...a]);
      toast("1,000 test USDC added");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`Couldn't get test USDC: ${msg}`);
    } finally {
      setFauceting(false);
    }
  }, [publicKey, connection, sendTransaction]);

  // Buy the followed mix on-chain: split the wallet's test-USDC across the
  // non-cash constituents by their target weights (the cash-reserve weight simply
  // stays as USDC). Each leg's asset quantity is sized from the asset's on-chain
  // PUBLISHED price (D-703) — the program binds subscribe's asset_qty to
  // asset.price_u within tolerance, so sizing from that same integer price keeps
  // the only difference to rounding. Subscribes to the official strategy — whose
  // asset PDAs are bound to the mirror mints — so the program mints the buyer the
  // real mirror tokens and the wallet holds the mix.
  const buyBasket = useCallback(async () => {
    const usdc = devnetUsdc();
    if (!publicKey || !usdc?.mint || !followedBasketId || !displayWeights) return;
    const usdcUi = tokenAmounts?.["USDC"] ?? 0;
    if (usdcUi <= 0) {
      toast("Get test USDC first.");
      return;
    }
    setBuying(true);
    try {
      const usdcBase = Math.floor(usdcUi * 10 ** usdc.decimals);
      const strategyPk = strategyAddress(OFFICIAL_CREATOR, followedBasketId);
      // Published on-chain prices for this strategy, keyed by mint. A mint with no
      // published price is skipped (its subscribe would revert PriceUnavailable).
      const published = await readAssetPrices(connection, strategyPk);
      const legs: SubscribeLeg[] = [];
      for (const s of order) {
        if (s === "USDC") continue;
        const mint = mintBySymbol[s];
        const weightBps = displayWeights[s] ?? 0;
        if (!mint || weightBps <= 0) continue;
        const priceU = published[mint]?.priceU ?? 0;
        if (priceU <= 0) continue; // no on-chain price → subscribe would revert
        const usdcIn = Math.floor((usdcBase * weightBps) / 10_000);
        if (usdcIn <= 0) continue;
        const assetQty = Number(sizeAssetQtyFromPriceU(usdcIn, priceU));
        if (assetQty <= 0) continue;
        legs.push({ assetMint: mint, usdcIn, assetQty });
      }
      if (legs.length === 0) {
        toast("Nothing to buy — no on-chain price published for this mix yet.");
        return;
      }
      const { signatures } = await subscribeToBasketOnchain({
        connection,
        walletPublicKey: publicKey,
        sendTransaction,
        strategyCreator: OFFICIAL_CREATOR,
        strategyId: followedBasketId,
        usdcMint: new PublicKey(usdc.mint),
        legs,
      });
      setRefreshTick((t) => t + 1);
      const last = signatures[signatures.length - 1] ?? "";
      setActivity((a) => [`You bought the mix on-chain · ${legs.length} assets · ${last.slice(0, 8)}… · just now`, ...a]);
      toast("Bought the mix on-chain");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`Couldn't buy: ${msg}`);
    } finally {
      setBuying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, connection, sendTransaction, followedBasketId, displayWeights, tokenAmounts, order, mintBySymbol]);

  // Sell (redeem) the followed mix on-chain — the mirror image of buyBasket. For
  // every non-cash constituent the wallet actually holds, burn the whole balance
  // and take USDC back from the strategy treasury at the on-chain published price
  // (D-705). The redeemed quantity is sized from the wallet's REAL on-chain
  // balance (uiAmount × 10^decimals), and usdc_out is computed on-chain from the
  // price — the caller supplies nothing to game. Redeems against the same official
  // strategy the tokens were minted by, so the treasury that pays out is the one
  // subscribe funded.
  const sellBasket = useCallback(async () => {
    const usdc = devnetUsdc();
    if (!publicKey || !usdc?.mint || !followedBasketId || !tokenAmounts) return;
    const legs: RedeemLeg[] = [];
    for (const s of order) {
      if (s === "USDC") continue;
      const mint = mintBySymbol[s];
      const asset = devnetAsset(s);
      const uiAmt = tokenAmounts[s] ?? 0;
      if (!mint || !asset || uiAmt <= 0) continue;
      const assetQty = Math.round(uiAmt * 10 ** asset.decimals); // full-exit, base units
      if (assetQty <= 0) continue;
      legs.push({ assetMint: mint, assetQty });
    }
    if (legs.length === 0) {
      toast("Nothing to sell — you don't hold any of this mix yet.");
      return;
    }
    setSelling(true);
    try {
      const { signatures } = await redeemFromBasketOnchain({
        connection,
        walletPublicKey: publicKey,
        sendTransaction,
        strategyCreator: OFFICIAL_CREATOR,
        strategyId: followedBasketId,
        usdcMint: new PublicKey(usdc.mint),
        legs,
      });
      setRefreshTick((t) => t + 1);
      const last = signatures[signatures.length - 1] ?? "";
      setActivity((a) => [`You sold the mix on-chain · ${legs.length} assets · ${last.slice(0, 8)}… · just now`, ...a]);
      toast("Sold the mix on-chain");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`Couldn't sell: ${msg}`);
    } finally {
      setSelling(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, connection, sendTransaction, followedBasketId, tokenAmounts, order, mintBySymbol]);

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
    nav,
    navLoading,
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
    hasAssetHoldings,
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
    devnetReady,
    usdcBalance,
    fauceting,
    buying,
    selling,
    getTestUsdc,
    buyBasket,
    sellBasket,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;



}

