"use client";

// Broadcast wallet-signed transactions through OUR Devnet connection instead of
// letting the wallet send them.
//
// Why this exists: wallet-adapter's `sendTransaction` (a.k.a. signAndSend) makes
// the WALLET choose the broadcast network — it derives a chain from the RPC URL
// and hands it to the wallet, which then either broadcasts to whatever network
// the user has selected or rejects a chain it doesn't support. Zerion, for one,
// has NO Solana Devnet: passing it `solana:devnet` fails with "Network should be
// known", and passing it `solana:mainnet` makes it broadcast our Devnet-blockhash
// tx to mainnet, where it's dropped ("block height exceeded").
//
// So we never let the wallet send. We ask it only to SIGN — the standard
// `signTransaction` call carries no chain, so the wallet just signs the bytes —
// then we submit the raw tx via the same Devnet `connection` that produced the
// blockhash and that confirms it. Blockhash, broadcast, and confirmation all run
// on one Devnet RPC, and the wallet's own network selection is irrelevant.
//
// Drop-in for `useWallet().sendTransaction`: same (tx, connection) => signature
// shape, so callers and their dependency arrays are unchanged.
import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { SendFn } from "@/lib/onchain";

export function useWalletSender(): SendFn {
  const { signTransaction, sendTransaction } = useWallet();
  return useCallback<SendFn>(
    async (tx, connection, onPhase) => {
      // feePayer + recentBlockhash are already set by the caller, so the wallet
      // signs a complete message and we own the submission.
      if (signTransaction) {
        onPhase?.("signing");
        const signed = await signTransaction(tx);
        onPhase?.("broadcasting");
        return connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 5,
        });
      }
      // Wallets that only expose signAndSend (no standalone sign) fall back to
      // the old path; nothing we support hits this, but it keeps the contract.
      return sendTransaction(tx, connection);
    },
    [signTransaction, sendTransaction],
  );
}
