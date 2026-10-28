import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "AnchorSwap – Swap on Stellar",
  description: "Swap Stellar assets through the AnchorSwap AMM or the Stellar DEX, with real quotes and on-chain confirmation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <WalletProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-white/40">
            Testnet only. AnchorSwap never asks for your secret key.
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
