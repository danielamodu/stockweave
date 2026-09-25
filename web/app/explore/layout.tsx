import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Weave",
  description:
    "A live, no-wallet map of every StockWeave strategy on-chain and how they fork from the official baskets — read straight from the Solana program.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
