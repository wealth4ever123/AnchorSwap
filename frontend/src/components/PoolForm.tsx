"use client";

/**
 * PoolForm.tsx
 *
 * Tabbed container for "Add Liquidity" and "Remove Liquidity" forms.
 * Delegates to `AddLiquidityForm` and `RemoveLiquidityForm` respectively.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AddLiquidityForm from "./AddLiquidityForm";
import RemoveLiquidityForm from "./RemoveLiquidityForm";

type Tab = "add" | "remove";

const TABS: { id: Tab; label: string }[] = [
  { id: "add", label: "Add Liquidity" },
  { id: "remove", label: "Remove Liquidity" },
];

export default function PoolForm() {
  const [activeTab, setActiveTab] = useState<Tab>("add");

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Tab bar */}
      <div className="glass-card flex mb-1 p-1 rounded-2xl">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === id
                ? "bg-anchor-500/30 text-white shadow"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Form panels */}
      <AnimatePresence mode="wait">
        {activeTab === "add" ? (
          <motion.div
            key="add"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.2 }}
          >
            <AddLiquidityForm />
          </motion.div>
        ) : (
          <motion.div
            key="remove"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
          >
            <RemoveLiquidityForm />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
