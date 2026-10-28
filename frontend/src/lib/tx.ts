/**
 * Submit signed transactions and wait for the network's final verdict.
 * A transaction is only reported as successful after Stellar RPC returns
 * SUCCESS for its hash.
 */
import { Keypair, TransactionBuilder, rpc, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { NETWORK } from "./config";
import { sorobanRpc, CONTRACT_ERRORS } from "./amm";
import { horizon, isNotFound } from "./horizon";

export type FinalStatus = "success" | "failed" | "pending";

export interface TxOutcome {
  hash: string;
  status: FinalStatus;
  ledger?: number;
  /** Soroban return value, decoded. */
  returnValue?: unknown;
  /** Classic path payment: amount actually received, in stroops. */
  received?: bigint;
  error?: string;
}

export class SignatureError extends Error {}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Check that the wallet signed this exact transaction for our network, with
 * the expected account. A wallet set to Mainnet produces a signature that
 * fails this check, so it is caught before anything is sent.
 */
export function assertSignedFor(signedXdr: string, address: string): Transaction {
  let tx: Transaction;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase) as Transaction;
  } catch {
    throw new SignatureError("The wallet returned an invalid transaction.");
  }
  const kp = Keypair.fromPublicKey(address);
  const hash = tx.hash();
  const ok = tx.signatures.some((s) => {
    try {
      return sameBytes(s.hint.toBytes(), kp.signatureHint()) && kp.verify(hash, s.signature);
    } catch {
      return false;
    }
  });
  if (!ok) {
    throw new SignatureError(
      `The wallet signature is not valid for Stellar ${NETWORK.name}. Switch your wallet to ${NETWORK.name} and try again.`,
    );
  }
  return tx;
}

const TX_CODES: Record<string, string> = {
  txBadSeq: "Your account sequence changed. Please try again.",
  txInsufficientBalance: "Not enough XLM to pay the network fee.",
  txInsufficientFee: "Network is busy; the fee was too low. Please try again.",
  txTooLate: "The transaction expired before it was processed.",
  txBadAuth: "The transaction signature was rejected by the network.",
  txNoAccount: "This account does not exist on the network yet. Fund it first.",
};

const OP_CODES: Record<string, string> = {
  pathPaymentStrictSendUnderDestmin: "Price moved beyond your slippage limit. Get a new quote and try again.",
  pathPaymentStrictSendTooFewOffers: "Not enough DEX liquidity for this trade right now.",
  pathPaymentStrictSendUnderfunded: "Insufficient balance for this swap.",
  pathPaymentStrictSendNoTrust: "Your account has no trustline for the token you're receiving.",
  pathPaymentStrictSendSrcNoTrust: "Your account has no trustline for the token you're sending.",
  pathPaymentStrictSendLineFull: "Your trustline limit for the received token is full.",
  changeTrustLowReserve: "Not enough XLM to add a trustline (each needs 0.5 XLM reserve).",
};

// stellar-sdk v17 XDR values are tagged unions: `{ type: "...", ...arm }`.
type Tagged = { type: string; [k: string]: unknown };
const tagged = (v: unknown): Tagged | null =>
  v && typeof v === "object" && typeof (v as Tagged).type === "string" ? (v as Tagged) : null;

/** Inner result code of each operation, e.g. "pathPaymentStrictSendUnderDestmin". */
function opCodes(result: xdr.TransactionResult): string[] {
  const res = tagged(result.result);
  const ops = (res?.results as unknown[] | undefined) ?? [];
  return ops.map((op) => {
    const o = tagged(op);
    if (o?.type !== "opInner") return o?.type ?? "unknown";
    const tr = tagged(o.tr);
    const arm = tr ? tagged(tr[`${tr.type}Result`]) : null;
    return arm?.type ?? tr?.type ?? "unknown";
  });
}

/** Human-readable reason from a TransactionResult. */
export function describeResult(result: xdr.TransactionResult): string {
  const code = tagged(result.result)?.type ?? "unknown";
  if (code === "txFailed") {
    for (const op of opCodes(result)) {
      if (OP_CODES[op]) return OP_CODES[op];
      if (!/Success$/.test(op)) return `Operation failed: ${op}`;
    }
    return "The transaction failed on-chain.";
  }
  return TX_CODES[code] ?? `Transaction rejected: ${code}`;
}

/** First contract error code found in a list of ScVals (searches vecs). */
function findContractError(vals: unknown[]): number | null {
  for (const raw of vals) {
    const v = tagged(raw);
    if (!v) continue;
    if (v.type === "scvError") {
      const err = tagged(v.error);
      if (err?.type === "sceContract") return Number(err.contractCode);
    }
    if (v.type === "scvVec") {
      const inner = findContractError((v.vec as unknown[] | null) ?? []);
      if (inner !== null) return inner;
    }
  }
  return null;
}

export function contractErrorFromEvents(events: xdr.DiagnosticEvent[] | undefined): number | null {
  for (const d of events ?? []) {
    const body = tagged(d.event.body);
    const v0 = body?.type === "v0" ? (body.v0 as { topics: unknown[]; data: unknown }) : null;
    if (!v0) continue;
    const code = findContractError([...v0.topics, v0.data]);
    if (code !== null) return code;
  }
  return null;
}

function sorobanFailure(res: rpc.Api.GetFailedTransactionResponse): string {
  const code = contractErrorFromEvents(res.diagnosticEventsXdr);
  if (code !== null && CONTRACT_ERRORS[code]) return CONTRACT_ERRORS[code];
  try {
    return describeResult(res.resultXdr);
  } catch {
    return "The transaction failed on-chain.";
  }
}

/** Amount actually delivered by a successful path payment. */
export function receivedFromPathPayment(result: xdr.TransactionResult): bigint | undefined {
  const res = tagged(result.result);
  const op = tagged((res?.results as unknown[] | undefined)?.[0]);
  const tr = op?.type === "opInner" ? tagged(op.tr) : null;
  if (tr?.type !== "pathPaymentStrictSend") return undefined;
  const arm = tagged(tr.pathPaymentStrictSendResult);
  if (arm?.type !== "pathPaymentStrictSendSuccess") return undefined;
  const amount = (arm.success as { last?: { amount?: bigint } })?.last?.amount;
  return amount === undefined ? undefined : BigInt(amount);
}

export interface SubmitOptions {
  /** Called as soon as the network accepts the tx for processing. */
  onSubmitted?: (hash: string) => void;
  timeoutMs?: number;
  pollMs?: number;
}

export async function submitAndWait(tx: Transaction, opts: SubmitOptions = {}): Promise<TxOutcome> {
  const { onSubmitted, timeoutMs = 90_000, pollMs = 2_000 } = opts;
  const s = sorobanRpc();
  const sent = await s.sendTransaction(tx);
  const hash = sent.hash;

  if (sent.status === "ERROR") {
    return {
      hash,
      status: "failed",
      error: sent.errorResult ? describeResult(sent.errorResult) : "The network rejected the transaction.",
    };
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    return { hash, status: "failed", error: "The network is busy. Please try again in a moment." };
  }
  onSubmitted?.(hash);

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await s.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        hash,
        status: "success",
        ledger: res.ledger,
        returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined,
        received: receivedFromPathPayment(res.resultXdr),
      };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      return { hash, status: "failed", ledger: res.ledger, error: sorobanFailure(res) };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Unknown is reported as pending, never as success.
  return { hash, status: "pending" };
}

/**
 * Independent check through Horizon (a different service from the RPC used
 * to submit). Returns null if Horizon does not know the hash yet.
 */
export async function verifyOnHorizon(hash: string): Promise<{ successful: boolean; ledger: number } | null> {
  try {
    const t = await horizon().transactions().transaction(hash).call();
    return { successful: t.successful, ledger: t.ledger_attr };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

