"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/swap", label: "Swap" },
  { href: "/pool", label: "Pool" },
];

function truncate(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function Navbar() {
  const pathname = usePathname();
  const { address, connected, connecting, connect, disconnect } = useWallet();

  return (
    <nav className="sticky top-0 z-50 w-full glass-card rounded-none border-x-0 border-t-0 px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <motion.div
            whileHover={{ rotate: 15 }}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-anchor-400 to-blue-500 flex items-center justify-center text-sm font-bold"
          >
            ⚓
          </motion.div>
          <span className="text-lg font-bold gradient-text">AnchorSwap</span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
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
        </div>

        {/* Wallet button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={connected ? disconnect : connect}
          disabled={connecting}
          className="btn-primary text-sm py-2 px-4"
        >
          {connecting
            ? "Connecting…"
            : connected && address
            ? truncate(address)
            : "Connect Wallet"}
        </motion.button>
      </div>
    </nav>
  );
}
