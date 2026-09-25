import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Strategy",
  description:
    "Inspect a StockWeave strategy in full — its assets, weights, on-chain rules and agent permissions — before you follow or fork. No wallet required.",
};

export default function StrategyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
