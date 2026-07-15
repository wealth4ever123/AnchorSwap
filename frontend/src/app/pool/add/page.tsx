"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import AddLiquidityForm from "@/components/AddLiquidityForm";

export default function AddLiquidityPage() {
  return (
    <div className="flex flex-col items-center pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md mb-4"
      >
        <Link href="/pool" className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1">
          ← Back to Pools
        </Link>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-3xl font-bold mb-2">Add Liquidity</h1>
        <p className="text-white/40 text-sm">
          Deposit a token pair and start earning swap fees.
        </p>
      </motion.div>
      <AddLiquidityForm />

      {/* Info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass-card mt-6 p-5 w-full max-w-md text-sm text-white/50 space-y-2"
      >
        <p><strong className="text-white/70">First deposit:</strong> You set the initial price. Shares = √(A × B).</p>
        <p><strong className="text-white/70">Subsequent deposits:</strong> Must match the current pool ratio. Shares = min(A/Ra, B/Rb) × total.</p>
        <p><strong className="text-white/70">Slippage:</strong> 1% tolerance on shares. Revert if pool moves before your transaction lands.</p>
      </motion.div>
    </div>
  );
}
