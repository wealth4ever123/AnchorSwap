"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import RemoveLiquidityForm from "@/components/RemoveLiquidityForm";

export default function RemoveLiquidityPage() {
  return (
    <div className="flex flex-col items-center pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md mb-4"
      >
        <Link
          href="/pool"
          className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
        >
          ← Back to Pools
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-3xl font-bold mb-2">Remove Liquidity</h1>
        <p className="text-white/40 text-sm">
          Burn LP shares to withdraw your token pair.
        </p>
      </motion.div>

      <RemoveLiquidityForm />

      {/* Informational note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass-card mt-6 p-5 w-full max-w-md text-sm text-white/50 space-y-2"
      >
        <p>
          <strong className="text-white/70">How removal works:</strong> You
          select what percentage of your LP shares to burn. The contract
          computes your proportional share of both reserves and returns the
          tokens directly to your wallet in a single transaction.
        </p>
        <p>
          <strong className="text-white/70">Slippage tolerance:</strong> 1%.
          If the pool ratio shifts significantly before your transaction
          lands, the contract will revert to protect you.
        </p>
        <p>
          <strong className="text-white/70">Fees:</strong> All accrued swap
          fees are already reflected in the reserve values, so you
          automatically collect your share of fees upon withdrawal.
        </p>
      </motion.div>
    </div>
  );
}
