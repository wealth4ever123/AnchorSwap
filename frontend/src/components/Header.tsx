"use client";

/**
 * Header.tsx
 *
 * Top navigation bar with wallet connector, logo, and page navigation links.
 * This component is a named export so it can be imported alongside the
 * default Navbar export for flexibility.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/swap", label: "Swap" },
  { href: "/pool", label: "Pool" },
];

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * AnchorSwap site header.
 *
 * Renders the logo, navigation links, and a wallet connect/disconnect button
 * powered by the Freighter wallet context from `@/lib/wallet`.
 */
export default function Header() {
  const pathname = usePathname();
  const { address, connected, connecting, connect, disconnect } = useWallet();

  return (
    <header className="sticky top-0 z-50 w-full glass-card rounded-none border-x-0 border-t-0 px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <Link href="/" className="flex items-center gap-2 group" aria-label="AnchorSwap home">
          <motion.div
            whileHover={{ rotate: 15 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-anchor-400 to-blue-500
                       flex items-center justify-center text-sm font-bold select-none"
          >
            ⚓
          </motion.div>
          <span className="text-lg font-bold gradient-text">AnchorSwap</span>
        </Link>

        {/* ── Navigation links (desktop) ────────────────────────────────── */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                pathname === href
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* ── Wallet button ─────────────────────────────────────────────── */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={connected ? disconnect : connect}
          disabled={connecting}
          aria-label={connected ? "Disconnect wallet" : "Connect Freighter wallet"}
          className="btn-primary text-sm py-2 px-4"
        >
          {connecting
            ? "Connecting…"
            : connected && address
            ? truncateAddress(address)
            : "Connect Wallet"}
        </motion.button>
      </div>
    </header>
  );
}
