/**
 * Per-browser list of transactions this app submitted. Statuses are only
 * ever set from on-chain results (RPC or Horizon), never assumed.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { verifyOnHorizon, type FinalStatus } from "./tx";

export type TxKind = "swap" | "add_liquidity" | "remove_liquidity" | "trustline";

export interface HistoryItem {
  hash: string;
  account: string;
  kind: TxKind;
  summary: string;
  status: FinalStatus;
  createdAt: number;
  ledger?: number;
  error?: string;
}

const KEY = "anchorswap.history.v1";
const MAX_ITEMS = 50;
const listeners = new Set<() => void>();
let cache: HistoryItem[] | null = null;

function read(): HistoryItem[] {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as HistoryItem[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((i) => typeof i?.hash === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: HistoryItem[]) {
  cache = items.slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage may be unavailable (private mode); keep in memory */
  }
  listeners.forEach((l) => l());
}

export function upsertHistory(item: Partial<HistoryItem> & { hash: string }) {
  const items = read();
  const i = items.findIndex((x) => x.hash === item.hash);
  if (i >= 0) {
    const next = [...items];
    next[i] = { ...next[i], ...item };
    write(next);
  } else {
    write([item as HistoryItem, ...items]);
  }
}

export function clearHistory() {
  write([]);
}

/** Re-check anything still pending against Horizon. */
export async function refreshPending(items: HistoryItem[]) {
  for (const item of items.filter((i) => i.status === "pending")) {
    try {
      const r = await verifyOnHorizon(item.hash);
      if (r) upsertHistory({ hash: item.hash, status: r.successful ? "success" : "failed", ledger: r.ledger });
    } catch {
      /* try again later */
    }
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: HistoryItem[] = [];

export function useHistory(account: string | null) {
  const all = useSyncExternalStore(subscribe, read, () => EMPTY);
  const items = useMemo(() => (account ? all.filter((i) => i.account === account) : EMPTY), [all, account]);
  const pending = items.some((i) => i.status === "pending");

  const refresh = useCallback(() => refreshPending(items), [items]);
  useEffect(() => {
    if (!pending) return;
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [pending, refresh]);

  return { items, refresh };
}

/** Test helper. */
export function _resetHistoryCache() {
  cache = null;
}
