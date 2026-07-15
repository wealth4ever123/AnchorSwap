"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import TokenSelect from "./TokenSelect";
import { Token, formatTokenAmount } from "@/lib/tokens";
import { usePairStats } from "@/hooks/usePairStats";
import {
  buildRemoveLiquidityTx,
  getUserShare,
  submitSignedTx,
} from "@/lib/soroban";
import { useWallet } from "@/lib/wallet";

export default function RemoveLiquidityForm() {
  const { address, connected, connect, signTransaction } = useWallet();

  const [tokenA, setTokenA] = useState<Token | null>(null);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [sharePct, setSharePct] = useState<number>(50);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [status, setStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { reserveA, reserveB, totalShares, loading } = usePairStats(
    tokenA?.address ?? "",
    tokenB?.address ?? ""
  );

  // Fetch user's current share balance whenever pair or address changes.
  useEffect(() => {
    if (!tokenA || !tokenB || !address) {
      setUserShares(0n);
      return;
    }
    getUserShare(tokenA.address, tokenB.address, address)
      .then(setUserShares)
      .catch(() => setUserShares(0n));
  }, [tokenA, tokenB, address]);

  // Amount of shares to burn based on the slider percentage.
  const sharesToBurn =
    userShares > 0n
      ? (userShares * BigInt(sharePct)) / 100n
      : 0n;

  // Estimated token returns.
  const estimatedA =
    totalShares > 0n ? (sharesToBurn * reserveA) / totalShares : 0n;
  const estimatedB =
    totalShares > 0n ? (sharesToBurn * reserveB) / totalShares : 0n;

  // 1% slippage on min out.
  const minA = estimatedA > 0n ? estimatedA - (estimatedA * 100n) / 10_000n : 0n;
  const minB = estimatedB > 0n ? estimatedB - (estimatedB * 100n) / 10_000n : 0n;

  const sharePercent =
    totalShares > 0n
      ? ((Number(userShares) / Number(totalShares)) * 100).toFixed(2)
      : "0.00";

  const handleRemove = useCallback(async () => {
    if (!tokenA || !tokenB || !address || sharesToBurn === 0n) return;
    setStatus("pending");
    setErrorMsg(null);
    try {
      const xdr = await buildRemoveLiquidityTx(
        address,
        tokenA.address,
        tokenB.address,
        sharesToBurn,
        minA > 0n ? minA : 1n,
        minB > 0n ? minB : 1n
      );
      const signed = await signTransaction(xdr);
      const hash = await submitSignedTx(signed);
      setTxHash(hash);
      setStatus("success");
      setUserShares(userShares - sharesToBurn);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Transaction failed");
      setStatus("error");
    }
  }, [
    tokenA,
    tokenB,
    address,
    sharesToBurn,
    minA,
    minB,
    userShares,
    signTransaction,
  ]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 w-full max-w-md mx-auto"
    >
      <h2 className="text-xl font-bold mb-2">Remove Liquidity</h2>
      <p className="text-sm text-white/40 mb-5">
        Burn LP shares to withdraw your proportional pool tokens.
      </p>

      {/* Token pair selection */}
      <div className="flex items-center gap-3 glass-card p-4 mb-4">
        <div className="flex-1">
          <div className="text-xs text-white/40 mb-2">Token A</div>
          <TokenSelect
            value={tokenA}
            onChange={setTokenA}
            exclude={tokenB?.address}
          />
        </div>
        <div className="text-white/30 text-xl mt-4">/</div>
        <div className="flex-1">
          <div className="text-xs text-white/40 mb-2">Token B</div>
          <TokenSelect
            value={tokenB}
            onChange={setTokenB}
            exclude={tokenA?.address}
          />
        </div>
      </div>

      {/* User position info */}
      {tokenA && tokenB && !loading && (
        <div className="glass-card px-4 py-3 mb-4 text-sm space-y-2">
          <div className="flex justify-between text-white/50">
            <span>Your LP shares</span>
            <span>{formatTokenAmount(userShares)}</span>
          </div>
          <div className="flex justify-between text-white/50">
            <span>Pool share</span>
            <span>{sharePercent}%</span>
          </div>
        </div>
      )}

      {/* Percentage slider */}
      <div className="glass-card p-4 mb-4">
        <div className="flex justify-between mb-3">
          <span className="text-sm text-white/50">Amount to remove</span>
          <span className="text-base font-bold">{sharePct}%</span>
        </div>

        <input
          type="range"
          min={1}
          max={100}
          value={sharePct}
          onChange={(e) => setSharePct(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer
            bg-white/10 accent-anchor-500"
        />

        {/* Quick-select buttons */}
        <div className="flex gap-2 mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => setSharePct(pct)}
              className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                sharePct === pct
                  ? "bg-anchor-500/30 text-anchor-400 border border-anchor-500/40"
                  : "glass-card text-white/50 hover:text-white"
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Estimated returns */}
      {tokenA && tokenB && sharesToBurn > 0n && (
        <div className="glass-card px-4 py-3 mb-4 text-sm space-y-2">
          <div className="text-xs text-white/40 mb-1">You will receive (estimated)</div>
          <div className="flex justify-between">
            <span className="text-white/70">{tokenA.symbol}</span>
            <span className="font-semibold">{formatTokenAmount(estimatedA)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">{tokenB.symbol}</span>
            <span className="font-semibold">{formatTokenAmount(estimatedB)}</span>
          </div>
          <div className="flex justify-between text-white/40 text-xs pt-1 border-t border-white/10">
            <span>Shares to burn</span>
            <span>{formatTokenAmount(sharesToBurn)}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4 text-red-400 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Success */}
      {status === "success" && txHash && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-4 text-green-400 text-sm break-all">
          Liquidity removed!{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View →
          </a>
        </div>
      )}

      {/* CTA */}
      {!connected ? (
        <button onClick={connect} className="btn-primary w-full text-base">
          Connect Wallet
        </button>
      ) : (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleRemove}
          disabled={
            !tokenA ||
            !tokenB ||
            sharesToBurn === 0n ||
            userShares === 0n ||
            status === "pending"
          }
          className="btn-primary w-full text-base"
        >
          {status === "pending" ? "Removing…" : "Remove Liquidity"}
        </motion.button>
      )}
    </motion.div>
  );
}
