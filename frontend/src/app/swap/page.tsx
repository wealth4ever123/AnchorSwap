"use client";

import { motion } from "framer-motion";
import SwapForm from "@/components/SwapForm";

export default function SwapPage() {
  return (
    <div className="flex flex-col items-center pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-3xl font-bold mb-2">Swap Tokens</h1>
        <p className="text-white/40 text-sm">
          Trade any token pair. 0.3% fee stays in the pool for LPs.
        </p>
      </motion.div>
      <SwapForm />
    </div>
  );
}
