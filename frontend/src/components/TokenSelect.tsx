"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { KNOWN_TOKENS, Token } from "@/lib/tokens";

interface TokenSelectProps {
  value: Token | null;
  onChange: (token: Token) => void;
  exclude?: string; // address to exclude (e.g. already selected token)
  label?: string;
}

export default function TokenSelect({
  value,
  onChange,
  exclude,
  label,
}: TokenSelectProps) {
  const [open, setOpen] = useState(false);

  const filtered = KNOWN_TOKENS.filter((t) => t.address !== exclude);

  return (
    <div className="relative">
      {label && (
        <span className="block text-xs text-white/40 mb-1 ml-1">{label}</span>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 glass-card px-3 py-2 rounded-xl hover:bg-white/10 transition-all min-w-[120px]"
      >
        {value ? (
          <>
            <span className="text-lg">{value.logoUrl ? "●" : "⬡"}</span>
            <span className="font-semibold text-sm">{value.symbol}</span>
          </>
        ) : (
          <span className="text-white/50 text-sm">Select token</span>
        )}
        <svg
          className={`w-4 h-4 ml-auto text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 left-0 z-50 w-56 glass-card p-2 rounded-xl shadow-glass"
          >
            {filtered.map((token) => (
              <button
                key={token.address}
                type="button"
                onClick={() => {
                  onChange(token);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left ${
                  value?.address === token.address
                    ? "bg-anchor-500/20 text-anchor-400"
                    : "hover:bg-white/[0.07] text-white"
                }`}
              >
                <span className="text-xl">⬡</span>
                <div>
                  <div className="font-semibold text-sm">{token.symbol}</div>
                  <div className="text-xs text-white/40">{token.name}</div>
                </div>
                {value?.address === token.address && (
                  <svg className="w-4 h-4 ml-auto text-anchor-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
