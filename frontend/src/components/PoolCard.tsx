"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { formatTokenAmount } from "@/lib/tokens";

interface PoolCardProps {
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenAAddress: string;
  tokenBAddress: string;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  userShares?: bigint;
  index?: number;
}

export default function PoolCard({
  tokenASymbol,
  tokenBSymbol,
  tokenAAddress,
  tokenBAddress,
  reserveA,
  reserveB,
  totalShares,
  userShares = 0n,
  index = 0,
}: PoolCardProps) {
  const price =
    reserveA > 0n
      ? (Number(reserveB) / Number(reserveA)).toFixed(4)
      : "—";

  const sharePercent =
    totalShares > 0n
      ? ((Number(userShares) / Number(totalShares)) * 100).toFixed(2)
      : "0.00";

  const params = new URLSearchParams({
    tokenA: tokenAAddress,
    tokenB: tokenBAddress,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      whileHover={{ y: -2 }}
      className="glass-card glass-card-hover p-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-anchor-400 to-blue-500 flex items-center justify-center text-xs font-bold border-2 border-white/10">
              {tokenASymbol[0]}
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-xs font-bold border-2 border-white/10">
              {tokenBSymbol[0]}
            </div>
          </div>
          <span className="font-bold text-base">
            {tokenASymbol}/{tokenBSymbol}
          </span>
        </div>
        <span className="text-xs bg-anchor-500/20 text-anchor-400 px-2 py-1 rounded-full">
          0.3% fee
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass-card p-3 rounded-xl">
          <div className="text-xs text-white/40 mb-1">Reserve {tokenASymbol}</div>
          <div className="font-semibold text-sm">{formatTokenAmount(reserveA)}</div>
        </div>
        <div className="glass-card p-3 rounded-xl">
          <div className="text-xs text-white/40 mb-1">Reserve {tokenBSymbol}</div>
          <div className="font-semibold text-sm">{formatTokenAmount(reserveB)}</div>
        </div>
        <div className="glass-card p-3 rounded-xl">
          <div className="text-xs text-white/40 mb-1">Price</div>
          <div className="font-semibold text-sm">
            1 {tokenASymbol} = {price} {tokenBSymbol}
          </div>
        </div>
        <div className="glass-card p-3 rounded-xl">
          <div className="text-xs text-white/40 mb-1">Your share</div>
          <div className="font-semibold text-sm">{sharePercent}%</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link
          href={`/pool/add?${params.toString()}`}
          className="flex-1 text-center btn-primary text-sm py-2"
        >
          Add Liquidity
        </Link>
        {userShares > 0n && (
          <Link
            href={`/pool/remove?${params.toString()}`}
            className="flex-1 text-center glass-card glass-card-hover text-sm py-2 rounded-xl text-center font-semibold"
          >
            Remove
          </Link>
        )}
      </div>
    </motion.div>
  );
}
