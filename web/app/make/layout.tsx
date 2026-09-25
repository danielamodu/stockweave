import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Build your own",
  description:
    "Compose your own tokenized pre-IPO PreStocks strategy, or fork an official basket — your wallet mints a standalone strategy account on Devnet.",
};

export default function MakeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
