"use client";

import { useCallback, useEffect, useState } from "react";
import { loadBalances, type AccountBalances } from "@/lib/horizon";

export function useBalances(address: string | null) {
  const [data, setData] = useState<AccountBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      setData(await loadBalances(address));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load balances");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setData(null);
    void refresh();
    if (!address) return;
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [address, refresh]);

  return { data, loading, error, refresh };
}
