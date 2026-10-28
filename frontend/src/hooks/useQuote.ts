"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQuotes, type QuoteResult } from "@/lib/quotes";
import type { Token } from "@/lib/tokens";

const DEBOUNCE_MS = 400;
const REFRESH_MS = 15_000;

/** Live quotes for `amountIn`, debounced and refreshed every 15 s. */
export function useQuote(from: Token | null, to: Token | null, amountIn: bigint | null) {
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const fetchQuote = useCallback(async () => {
    if (!from || !to || !amountIn || amountIn <= 0n || from.symbol === to.symbol) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return null;
    }
    const id = ++reqId.current;
    setLoading(true);
    try {
      const q = await getQuotes(from, to, amountIn);
      if (id !== reqId.current) return null; // a newer request superseded this one
      setQuote(q);
      setError(null);
      return q;
    } catch (e) {
      if (id !== reqId.current) return null;
      setQuote(null);
      setError(e instanceof Error ? e.message : "Could not get a quote");
      return null;
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [from, to, amountIn]);

  useEffect(() => {
    setQuote(null);
    const t = setTimeout(fetchQuote, DEBOUNCE_MS);
    const r = setInterval(fetchQuote, REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(r);
      // Invalidate in-flight requests. reqId is a counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      reqId.current++;
    };
  }, [fetchQuote]);

  return { quote, loading, error, refetch: fetchQuote };
}
