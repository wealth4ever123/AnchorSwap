"use client";

import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import TokenSelect from "./TokenSelect";
import { Token, formatTokenAmount } from "@/lib/tokens";
import { usePairStats, useSwapQuote } from "@/hooks/usePairStats";
import { parseAmount, buildSwapTx, submitSignedTx } from "@/lib/soroban";
import { useWallet } from "@/lib/wallet";

const SLIPPAGE_BPS = 50n; // 0.5%

export default function SwapForm() {
  const { address, connected, connect, signTransaction } = useWallet();

  const [tokenIn, setTokenIn] = useState<Token | null>(null);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountInStr, setAmountInStr] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { reserveA, reserveB, price, loading: statsLoading } = usePairStats(
    tokenIn?.address ?? "",
    tokenOut?.address ?? ""
  );

  const amountIn = amountInStr ? parseAmount(amountInStr) : 0n;
  const amountOut = useSwapQuote(amountIn, reserveA, reserveB);
  const minOut = amountOut > 0n ? amountOut - (amountOut * SLIPPAGE_BPS) / 10_000n : 0n;

  const handleSwap = useCallback(async () => {
    if (!tokenIn || !tokenOut || !address || amountIn === 0n) return;
    setStatus("pending");
    setErrorMsg(null);
    try {
      const xdr = await buildSwapTx(address, tokenIn.address, tokenOut.address, amountIn, minOut);
      const signed = await signTransaction(xdr);
      const hash = await submitSignedTx(signed);
      setTxHash(hash);
      setStatus("success");
      setAmountInStr("");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Swap failed");
      setStatus("error");
    }
  }, [tokenIn, tokenOut, address, amountIn, minOut, signTransaction]);

  const handleFlip = useCallback(() => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountInStr("");
  }, [tokenIn, tokenOut]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 w-full max-w-md mx-auto"
    >
      <h2 className="text-xl font-bold mb-5">Swap</h2>

      {/* Token In */}
      <div className="glass-card p-4 mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/40">You pay</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            placeholder="0.0"
            value={amountInStr}
            onChange={(e) => setAmountInStr(e.target.value)}
            className="flex-1 text-2xl font-semibold bg-transparent border-0 outline-none text-white placeholder-white/20"
          />
          <TokenSelect value={tokenIn} onChange={setTokenIn} exclude={tokenOut?.address} />
        </div>
      </div>

      {/* Flip */}
      <div className="flex justify-center my-1">
        <motion.button
          whileHover={{ rotate: 180 }}
          transition={{ duration: 0.3 }}
          onClick={handleFlip}
          className="w-9 h-9 glass-card rounded-full flex items-center justify-center text-white/60 hover:text-white"
        >
          ↕
        </motion.button>
      </div>

      {/* Token Out */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/40">You receive</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-2xl font-semibold text-white/70">
            {amountOut > 0n ? formatTokenAmount(amountOut) : "0.0"}
          </div>
          <TokenSelect value={tokenOut} onChange={setTokenOut} exclude={tokenIn?.address} />
        </div>
      </div>

      {/* Price info */}
      {tokenIn && tokenOut && !statsLoading && (
        <div className="glass-card px-4 py-3 mb-4 text-sm text-white/50 flex justify-between">
          <span>Rate</span>
          <span>1 {tokenIn.symbol} = {price} {tokenOut.symbol}</span>
        </div>
      )}

      {/* Min received */}
      {amountOut > 0n && (
        <div className="text-xs text-white/40 mb-4 flex justify-between px-1">
          <span>Min received (0.5% slippage)</span>
          <span>{formatTokenAmount(minOut)} {tokenOut?.symbol}</span>
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
          Swap confirmed!{" "}
          <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
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
          onClick={handleSwap}
          disabled={!tokenIn || !tokenOut || !amountInStr || amountIn === 0n || status === "pending"}
          className="btn-primary w-full text-base"
        >
          {status === "pending" ? "Swapping…" : "Swap"}
        </motion.button>
      )}
    </motion.div>
  );
}
