"use client";

import { useWallet } from "@/lib/wallet";
import { clearHistory, useHistory } from "@/lib/history";
import { explorerAccount, explorerTx } from "@/lib/config";
import { Alert } from "./ui";

const BADGE = {
  success: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
  pending: "bg-amber-500/15 text-amber-200",
};

export default function HistoryList() {
  const { address, connect } = useWallet();
  const { items, refresh } = useHistory(address);

  if (!address) {
    return (
      <div className="glass-card mx-auto max-w-2xl p-6 text-center">
        <p className="mb-4 text-white/70">Connect a wallet to see transactions you made with AnchorSwap.</p>
        <button className="btn-primary" onClick={connect}>
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">History</h1>
        <div className="flex gap-3 text-sm">
          <button className="text-white/60 underline" onClick={() => void refresh()}>
            Re-check pending
          </button>
          <a className="text-white/60 underline" href={explorerAccount(address)} target="_blank" rel="noopener noreferrer">
            Full account history ↗
          </a>
        </div>
      </div>
      <p className="mb-4 text-sm text-white/50">
        Statuses come from the ledger, not from the app. This list is stored in this browser only.
      </p>
      {items.length === 0 ? (
        <Alert tone="info">No transactions from this browser yet.</Alert>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.hash} className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium">{i.summary}</div>
                <div className="text-xs text-white/50">
                  {new Date(i.createdAt).toLocaleString()}
                  {i.ledger ? ` · ledger ${i.ledger}` : ""}
                </div>
                {i.error && <div className="mt-1 text-xs text-red-300">{i.error}</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE[i.status]}`}>{i.status}</span>
                <a className="text-sm underline" href={explorerTx(i.hash)} target="_blank" rel="noopener noreferrer">
                  {i.hash.slice(0, 8)}… ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <button className="mt-4 text-xs text-white/40 underline" onClick={clearHistory}>
          Clear local history
        </button>
      )}
    </section>
  );
}
