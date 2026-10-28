"use client";

import { useCallback, useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import { useWallet } from "@/lib/wallet";
import { submitAndWait, type TxOutcome } from "@/lib/tx";
import { upsertHistory, type TxKind } from "@/lib/history";

export type TxStage = "idle" | "building" | "signing" | "submitting" | "confirming" | "success" | "failed" | "pending";

export interface TxState {
  stage: TxStage;
  hash: string | null;
  error: string | null;
  outcome: TxOutcome | null;
}

const IDLE: TxState = { stage: "idle", hash: null, error: null, outcome: null };

/**
 * Runs build -> wallet signature -> submit -> wait for the ledger, and
 * records the result in history. Success only comes from the ledger.
 */
export function useTxRunner() {
  const { address, sign, network } = useWallet();
  const [state, setState] = useState<TxState>(IDLE);

  const run = useCallback(
    async (kind: TxKind, summary: string, build: () => Promise<Transaction>): Promise<TxOutcome | null> => {
      if (!address) {
        setState({ ...IDLE, stage: "failed", error: "Connect a wallet first." });
        return null;
      }
      if (network === "mismatch") {
        setState({ ...IDLE, stage: "failed", error: "Your wallet is on a different network. Switch it to Testnet." });
        return null;
      }
      let hash: string | null = null;
      try {
        setState({ ...IDLE, stage: "building" });
        const tx = await build();
        setState({ ...IDLE, stage: "signing" });
        const signed = await sign(tx);
        setState({ ...IDLE, stage: "submitting" });
        const outcome = await submitAndWait(signed, {
          onSubmitted: (h) => {
            hash = h;
            upsertHistory({ hash: h, account: address, kind, summary, status: "pending", createdAt: Date.now() });
            setState({ ...IDLE, stage: "confirming", hash: h });
          },
        });
        if (hash) {
          upsertHistory({ hash, status: outcome.status, ledger: outcome.ledger, error: outcome.error });
        }
        setState({ stage: outcome.status, hash: outcome.hash, error: outcome.error ?? null, outcome });
        return outcome;
      } catch (e) {
        const error = e instanceof Error ? e.message : "Something went wrong";
        if (hash) upsertHistory({ hash, status: "pending", error });
        setState({ ...IDLE, stage: hash ? "pending" : "failed", hash, error });
        return null;
      }
    },
    [address, sign, network],
  );

  const reset = useCallback(() => setState(IDLE), []);
  const busy = ["building", "signing", "submitting", "confirming"].includes(state.stage);
  return { state, run, reset, busy };
}
