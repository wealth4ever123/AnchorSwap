"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getReserves, getTotalShares, computeSwapOut, formatAmount } from "@/lib/soroban";

export interface PairStats {
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  price: string; // tokenB per tokenA
  loading: boolean;
  error: string | null;
  lastUpdated: number;
}

const POLL_INTERVAL_MS = 5_000;

/**
 * Poll pair reserves every 5 seconds via RPC simulation.
 * Returns live reserve and price data.
 */
export function usePairStats(tokenA: string, tokenB: string): PairStats {
  const [stats, setStats] = useState<PairStats>({
    reserveA: 0n,
    reserveB: 0n,
    totalShares: 0n,
    price: "0",
    loading: true,
    error: null,
    lastUpdated: 0,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    if (!tokenA || !tokenB) return;
    try {
      const [{ reserveA, reserveB }, totalShares] = await Promise.all([
        getReserves(tokenA, tokenB),
        getTotalShares(tokenA, tokenB),
      ]);

      const price =
        reserveA > 0n
          ? formatAmount((reserveB * BigInt(1e7)) / reserveA)
          : "0";

      setStats({
        reserveA,
        reserveB,
        totalShares,
        price,
        loading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (e: unknown) {
      setStats((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "RPC error",
      }));
    }
  }, [tokenA, tokenB]);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  return stats;
}

/**
 * Compute expected swap output locally (no RPC needed).
 */
export function useSwapQuote(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): bigint {
  return computeSwapOut(amountIn, reserveIn, reserveOut);
}
