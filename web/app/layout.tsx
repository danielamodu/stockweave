import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { Toaster } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockWeave — inspect, simulate, fork, follow",
  description:
    "A public, forkable strategy layer for tokenized stocks on Solana. Every rule, weight, and agent permission inspectable before you follow or fork.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <SolanaWalletProvider>
          {children}
          <Toaster />
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
