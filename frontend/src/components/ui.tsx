"use client";

import { explorerTx } from "@/lib/config";
import type { TxState } from "@/hooks/useTxRunner";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white ${className}`}
    />
  );
}

export function Alert({ tone, children }: { tone: "error" | "warn" | "info" | "success"; children: React.ReactNode }) {
  const styles = {
    error: "bg-red-500/10 border-red-500/30 text-red-300",
    warn: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    info: "bg-anchor-500/10 border-anchor-400/30 text-anchor-100",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function shortAddress(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

const STAGE_TEXT: Record<string, string> = {
  building: "Preparing transaction…",
  signing: "Waiting for your wallet signature…",
  submitting: "Submitting to the network…",
  confirming: "Waiting for ledger confirmation…",
};

/** Shows progress and the verified on-chain result of a transaction. */
export function TxStatus({ state, successText }: { state: TxState; successText?: string }) {
  if (state.stage === "idle") return null;
  const link = state.hash ? (
    <a className="underline underline-offset-2" href={explorerTx(state.hash)} target="_blank" rel="noopener noreferrer">
      View on Stellar Expert ↗
    </a>
  ) : null;

  if (STAGE_TEXT[state.stage]) {
    return (
      <Alert tone="info">
        <div className="flex items-center gap-2">
          <Spinner /> {STAGE_TEXT[state.stage]}
        </div>
        {link && <div className="mt-1">{link}</div>}
      </Alert>
    );
  }
  if (state.stage === "success") {
    return (
      <Alert tone="success">
        <div className="font-semibold">Confirmed on-chain{state.outcome?.ledger ? ` in ledger ${state.outcome.ledger}` : ""}.</div>
        {successText && <div className="mt-1">{successText}</div>}
        {link && <div className="mt-1">{link}</div>}
      </Alert>
    );
  }
  if (state.stage === "pending") {
    return (
      <Alert tone="warn">
        <div className="font-semibold">Not confirmed yet.</div>
        <div className="mt-1">
          The network has not reported a final result. It will be re-checked in History. {state.error}
        </div>
        {link && <div className="mt-1">{link}</div>}
      </Alert>
    );
  }
  return (
    <Alert tone="error">
      <div className="font-semibold">Transaction failed.</div>
      {state.error && <div className="mt-1">{state.error}</div>}
      {link && <div className="mt-1">{link}</div>}
    </Alert>
  );
}
