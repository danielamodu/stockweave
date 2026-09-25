import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { Toaster } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stockweavexbt.vercel.app"),
  title: {
    default: "StockWeave — inspect, simulate, fork, follow",
    template: "%s · StockWeave",
  },
  description:
    "A public, forkable strategy layer for tokenized pre-IPO PreStocks on Solana. Every rule, weight, and agent permission inspectable before you follow or fork.",
  openGraph: {
    type: "website",
    siteName: "StockWeave",
    url: "/",
    title: "StockWeave — inspect, simulate, fork, follow",
    description:
      "A public, forkable strategy layer for tokenized pre-IPO PreStocks on Solana. Every rule, weight, and agent permission inspectable before you follow or fork.",
  },
  twitter: {
    card: "summary_large_image",
    title: "StockWeave — inspect, simulate, fork, follow",
    description:
      "A public, forkable strategy layer for tokenized pre-IPO PreStocks on Solana — inspect every rule, weight, and agent permission before you follow or fork.",
  },
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
