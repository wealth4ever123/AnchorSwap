"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const FEATURES = [
  {
    icon: "⚡",
    title: "Instant Swaps",
    desc: "Constant-product AMM with 0.3% fee. Execute swaps in a single Soroban transaction.",
  },
  {
    icon: "💧",
    title: "Earn Fees",
    desc: "Deposit token pairs to a pool and earn a proportional share of all swap fees.",
  },
  {
    icon: "🔒",
    title: "Non-Custodial",
    desc: "All logic lives on-chain. Your keys, your tokens — no intermediaries.",
  },
  {
    icon: "🛡️",
    title: "Auditable Security",
    desc: "Re-entrancy guard, checked arithmetic, slippage protection, and open-source code.",
  },
];

const STATS = [
  { label: "Fee tier", value: "0.3%" },
  { label: "Formula", value: "x·y=k" },
  { label: "Network", value: "Stellar Testnet" },
  { label: "License", value: "Apache-2.0" },
];

export default function HomePage() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center max-w-3xl mx-auto pt-16 pb-20"
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, repeatDelay: 3 }}
          className="text-6xl mb-6"
        >
          ⚓
        </motion.div>
        <h1 className="text-5xl md:text-6xl font-extrabold mb-5 leading-tight">
          The Permissionless{" "}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-anchor-400 via-blue-400 to-purple-400">
            AMM DEX
          </span>{" "}
          on Stellar
        </h1>
        <p className="text-lg text-white/55 mb-8 max-w-xl mx-auto leading-relaxed">
          AnchorSwap brings on-chain liquidity to Stellar via Soroban smart
          contracts. Swap any token pair, provide liquidity, and earn fees —
          all without a custodian.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/swap">
            <motion.span
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="btn-primary text-base px-8 py-3 inline-block cursor-pointer"
            >
              Launch App →
            </motion.span>
          </Link>
          <a
            href="https://github.com/your-org/anchorswap"
            target="_blank"
            rel="noopener noreferrer"
          >
            <motion.span
              whileHover={{ scale: 1.04 }}
              className="glass-card glass-card-hover inline-block px-8 py-3 rounded-xl font-semibold text-base cursor-pointer"
            >
              GitHub
            </motion.span>
          </a>
        </div>
      </motion.section>

      {/* Stats bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass-card w-full max-w-3xl grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10 mb-16"
      >
        {STATS.map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center py-5 px-4">
            <span className="text-xl font-bold gradient-text">{value}</span>
            <span className="text-xs text-white/40 mt-1">{label}</span>
          </div>
        ))}
      </motion.div>

      {/* Feature cards */}
      <section className="w-full max-w-4xl grid sm:grid-cols-2 gap-5 mb-20">
        {FEATURES.map(({ icon, title, desc }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i + 0.4 }}
            whileHover={{ y: -3 }}
            className="glass-card glass-card-hover p-6"
          >
            <div className="text-3xl mb-3">{icon}</div>
            <h3 className="text-base font-bold mb-2">{title}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{desc}</p>
          </motion.div>
        ))}
      </section>

      {/* CTA */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="glass-card w-full max-w-3xl text-center py-12 px-6 mb-16"
      >
        <h2 className="text-2xl font-bold mb-3">Ready to start?</h2>
        <p className="text-white/50 mb-6">
          Connect your Freighter wallet and make your first swap in seconds.
        </p>
        <Link href="/swap">
          <motion.span
            whileHover={{ scale: 1.04 }}
            className="btn-primary text-base px-10 py-3 inline-block cursor-pointer"
          >
            Start Swapping
          </motion.span>
        </Link>
      </motion.section>
    </div>
  );
}
