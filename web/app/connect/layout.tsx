import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect wallet",
  description:
    "Connect your Solana wallet to follow a strategy and approve changes. You keep your keys — nothing moves without your signature.",
};

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
