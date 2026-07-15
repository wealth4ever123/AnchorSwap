"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import PoolCard from "@/components/PoolCard";
import { KNOWN_TOKENS } from "@/lib/tokens";
import { usePairStats } from "@/hooks/usePairStats";
import { useWallet } from "@/lib/wallet";
import { getUserShare } from "@/lib/soroban";
import { useEffect, useState } from "react";

// Demo: show XLM/USDC and XLM/ANC pools
const FEATURED_PAIRS = [
  { tokenA: KNOWN_TOKENS[0], tokenB: KNOWN_TOKENS[1] },
  { tokenA: KNOWN_TOKENS[0], tokenB: KNOWN_TOKENS[2] },
];

function PairRow({
  tokenA,
  tokenB,
  index,
  userAddress,
}: {
  tokenA: (typeof KNOWN_TOKENS)[0];
  tokenB: (typeof KNOWN_TOKENS)[0];
  index: number;
  userAddress: string | null;
}) {
  const { reserveA, reserveB, totalShares } = usePairStats(
    tokenA.address,
    tokenB.address
  );
  const [userShares, setUserShares] = useState(0n);

  useEffect(() => {
    if (!userAddress) return;
    getUserShare(tokenA.address, tokenB.address, userAddress)
      .then(setUserShares)
      .catch(() => {});
  }, [tokenA.address, tokenB.address, userAddress]);

  return (
    <PoolCard
      tokenASymbol={tokenA.symbol}
      tokenBSymbol={tokenB.symbol}
      tokenAAddress={tokenA.address}
      tokenBAddress={tokenB.address}
      reserveA={reserveA}
      reserveB={reserveB}
      totalShares={totalShares}
      userShares={userShares}
      index={index}
    />
  );
}

export default function PoolPage() {
  const { address } = useWallet();

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-3xl font-bold mb-1">Liquidity Pools</h1>
          <p className="text-white/40 text-sm">
            Provide liquidity and earn 0.3% on every swap.
          </p>
        </div>
        <Link href="/pool/add">
          <motion.span
            whileHover={{ scale: 1.03 }}
            className="btn-primary text-sm px-5 py-2 inline-block cursor-pointer"
          >
            + New Position
          </motion.span>
        </Link>
      </motion.div>

      {/* Pool grid */}
      <div className="grid sm:grid-cols-2 gap-5">
        {FEATURED_PAIRS.map(({ tokenA, tokenB }, i) => (
          <PairRow
            key={`${tokenA.address}-${tokenB.address}`}
            tokenA={tokenA}
            tokenB={tokenB}
            index={i}
            userAddress={address}
          />
        ))}
      </div>

      {/* Info banner */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="glass-card mt-8 p-5 text-sm text-white/50"
      >
        <strong className="text-white/80">How it works:</strong> Deposit equal
        value of two tokens. You receive LP shares proportional to your
        contribution. When swaps happen, the 0.3% fee accrues to the pool,
        increasing the value of your shares over time. Withdraw anytime.
      </motion.div>
    </div>
  );
}
