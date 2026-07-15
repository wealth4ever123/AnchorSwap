"use client";

import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import TokenSelect from "./TokenSelect";
import { Token, formatTokenAmount } from "@/lib/tokens";
import { usePairStats } from "@/hooks/usePairStats";
import { parseAmount, buildAddLiquidityTx, submitSignedTx } from "@/lib/soroban";
import { useWallet } from "@/lib/wallet";

export default function AddLiquidityForm() {
  const { address, connected, connect, signTransaction } = useWallet();

  const [tokenA, setTokenA] = useState<Token | null>(null);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [amountAStr, setAmountAStr] = useState("");
  const [amountBStr, setAmountBStr] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { reserveA, reserveB, totalShares } = usePairStats(
    tokenA?.address ?? "",
    tokenB?.address ?? ""
  );

  // Auto-fill opposite side based on pool ratio
  const handleAmountAChange = useCallback(
    (val: string) => {
      setAmountAStr(val);
      if (reserveA > 0n && reserveB > 0n && val) {
        const a = parseAmount(val);
        const b = (a * reserveB) / reserveA;
        setAmountBStr(formatTokenAmount(b));
      }
    },
    [reserveA, reserveB]
  );

  const handleAmountBChange = useCallback(
    (val: string) => {
      setAmountBStr(val);
      if (reserveA > 0n && reserveB > 0n && val) {
        const b = parseAmount(val);
        const a = (b * reserveA) / reserveB;
        setAmountAStr(formatTokenAmount(a));
      }
    },
    [reserveA, reserveB]
  );

  // Estimate shares for display
  const estimatedShares = (() => {
    if (!amountAStr || !amountBStr) return 0n;
    const a = parseAmount(amountAStr);
    const b = parseAmount(amountBStr);
    if (totalShares === 0n) {
      // First LP: sqrt(a*b) approximation
      const product = Number(a) * Number(b);
      return BigInt(Math.floor(Math.sqrt(product)));
    }
    const sA = (a * totalShares) / reserveA;
    const sB = (b * totalShares) / reserveB;
    return sA < sB ? sA : sB;
  })();

  const handleAdd = useCallback(async () => {
    if (!tokenA || !tokenB || !address || !amountAStr || !amountBStr) return;
    setStatus("pending");
    setErrorMsg(null);
    try {
      const amountA = parseAmount(amountAStr);
      const amountB = parseAmount(amountBStr);
      // Accept 1% less shares than expected
      const minShare = estimatedShares - (estimatedShares * 100n) / 10_000n;
      const xdr = await buildAddLiquidityTx(
        address, tokenA.address, tokenB.address, amountA, amountB, minShare > 0n ? minShare : 1n
      );
      const signed = await signTransaction(xdr);
      const hash = await submitSignedTx(signed);
      setTxHash(hash);
      setStatus("success");
      setAmountAStr("");
      setAmountBStr("");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Transaction failed");
      setStatus("error");
    }
  }, [tokenA, tokenB, address, amountAStr, amountBStr, estimatedShares, signTransaction]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 w-full max-w-md mx-auto"
    >
      <h2 className="text-xl font-bold mb-2">Add Liquidity</h2>
      <p className="text-sm text-white/40 mb-5">
        Deposit token pairs to earn 0.3% swap fees.
      </p>

      {/* Token A */}
      <div className="glass-card p-4 mb-3">
        <div className="text-xs text-white/40 mb-2">Token A</div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            placeholder="0.0"
            value={amountAStr}
            onChange={(e) => handleAmountAChange(e.target.value)}
            className="flex-1 text-2xl font-semibold bg-transparent border-0 outline-none text-white placeholder-white/20"
          />
          <TokenSelect value={tokenA} onChange={setTokenA} exclude={tokenB?.address} />
        </div>
      </div>

      {/* Plus sign */}
      <div className="flex justify-center my-1 text-white/30 text-xl">+</div>

      {/* Token B */}
      <div className="glass-card p-4 mb-4">
        <div className="text-xs text-white/40 mb-2">Token B</div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            placeholder="0.0"
            value={amountBStr}
            onChange={(e) => handleAmountBChange(e.target.value)}
            className="flex-1 text-2xl font-semibold bg-transparent border-0 outline-none text-white placeholder-white/20"
          />
          <TokenSelect value={tokenB} onChange={setTokenB} exclude={tokenA?.address} />
        </div>
      </div>

      {/* Pool info */}
      {reserveA > 0n && tokenA && tokenB && (
        <div className="glass-card px-4 py-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between text-white/40">
            <span>Pool rate</span>
            <span>1 {tokenA.symbol} = {(Number(reserveB) / Number(reserveA)).toFixed(4)} {tokenB.symbol}</span>
          </div>
          <div className="flex justify-between text-white/40">
            <span>Est. shares</span>
            <span>{formatTokenAmount(estimatedShares)}</span>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4 text-red-400 text-sm">
          {errorMsg}
        </div>
      )}

      {status === "success" && txHash && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-4 text-green-400 text-sm break-all">
          Liquidity added!{" "}
          <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
            View →
          </a>
        </div>
      )}

      {!connected ? (
        <button onClick={connect} className="btn-primary w-full text-base">
          Connect Wallet
        </button>
      ) : (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleAdd}
          disabled={!tokenA || !tokenB || !amountAStr || !amountBStr || status === "pending"}
          className="btn-primary w-full text-base"
        >
          {status === "pending" ? "Adding…" : "Add Liquidity"}
        </motion.button>
      )}
    </motion.div>
  );
}
