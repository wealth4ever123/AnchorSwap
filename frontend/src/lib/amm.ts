/**
 * Client for the AnchorSwap Soroban contract: read-only views run through
 * RPC simulation; writes are built here, signed by the wallet, and sent by
 * `tx.ts`.
 */
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { AMM_CONTRACT, NETWORK, TX_TIMEOUT_SECONDS } from "./config";
import { Token, tokenByContract } from "./tokens";

let server: rpc.Server | null = null;
export function sorobanRpc(): rpc.Server {
  server ??= new rpc.Server(NETWORK.rpcUrl);
  return server;
}

/** Placeholder source for read-only simulations (never signs anything). */
const SIM_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Must stay in sync with `contracts/anchorswap/src/error.rs`. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: "This pool already exists.",
  2: "There is no AnchorSwap pool for this pair.",
  3: "Choose two different tokens.",
  4: "Amount must be greater than zero.",
  5: "Price moved beyond your slippage limit. Get a new quote and try again.",
  6: "Not enough liquidity in the pool for this trade.",
  7: "You don't have that many pool shares.",
  8: "The transaction expired before it was processed. Please try again.",
  9: "The pool is paused by the admin. Withdrawals still work.",
  10: "Amount is too large.",
  11: "The maximum number of pools has been reached.",
};

export class ContractError extends Error {
  constructor(public code: number) {
    super(CONTRACT_ERRORS[code] ?? `Contract error #${code}`);
  }
}

/** Find `Error(Contract, #N)` in a simulation/host error string. */
export function contractErrorCode(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return m ? Number(m[1]) : null;
}

function toError(message: string): Error {
  const code = contractErrorCode(message);
  if (code !== null) return new ContractError(code);
  if (/trustline entry is missing/i.test(message)) {
    return new Error("Your account has no trustline for one of these tokens. Add it first.");
  }
  if (/resulting balance is not within the allowed range|balance is not sufficient/i.test(message)) {
    return new Error("Insufficient balance for this transaction.");
  }
  return new Error(message.split("\n")[0].slice(0, 300));
}

const addr = (a: string) => new Address(a).toScVal();
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u64 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" });

async function simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(new Contract(AMM_CONTRACT).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await sorobanRpc().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw toError(sim.error);
  if (!sim.result) throw new Error(`No result from ${method}`);
  return scValToNative(sim.result.retval);
}

// ── Views ────────────────────────────────────────────────────────────────────

/** Exact output of a swap right now, or null if there is no usable pool. */
export async function ammQuote(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<bigint | null> {
  try {
    const out = (await simulate("get_amount_out", [addr(tokenIn.contract), addr(tokenOut.contract), i128(amountIn)])) as bigint;
    return out > 0n ? out : null;
  } catch (e) {
    if (e instanceof ContractError && (e.code === 2 || e.code === 6)) return null;
    throw e;
  }
}

export interface Pool {
  tokenA: Token;
  tokenB: Token;
  /** Reserves in tokenA/tokenB order. */
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
}

/** Pool state in the order the tokens are given, or null if none exists. */
export async function getPool(tokenA: Token, tokenB: Token): Promise<Pool | null> {
  let state: { reserve_a: bigint; reserve_b: bigint; total_shares: bigint };
  try {
    state = (await simulate("get_pair", [addr(tokenA.contract), addr(tokenB.contract)])) as typeof state;
  } catch (e) {
    if (e instanceof ContractError && e.code === 2) return null;
    throw e;
  }
  // get_pair returns canonical order; get_reserves returns caller order.
  const [ra, rb] = (await simulate("get_reserves", [addr(tokenA.contract), addr(tokenB.contract)])) as [bigint, bigint];
  return { tokenA, tokenB, reserveA: ra, reserveB: rb, totalShares: state.total_shares };
}

/** All pools registered in the contract whose tokens are in our token list. */
export async function listPools(): Promise<Pool[]> {
  const pairs = (await simulate("get_pairs", [])) as { token_a: string; token_b: string }[];
  const pools: Pool[] = [];
  for (const p of pairs) {
    const a = tokenByContract(p.token_a);
    const b = tokenByContract(p.token_b);
    if (!a || !b) continue; // unknown tokens are never shown
    // Show XLM first when present.
    const [x, y] = b.symbol === "XLM" ? [b, a] : [a, b];
    const pool = await getPool(x, y);
    if (pool) pools.push(pool);
  }
  return pools;
}

export async function getShares(tokenA: Token, tokenB: Token, user: string): Promise<bigint> {
  return (await simulate("get_shares", [addr(tokenA.contract), addr(tokenB.contract), addr(user)])) as bigint;
}

// ── Transaction builders ─────────────────────────────────────────────────────

async function buildInvoke(user: string, method: string, args: xdr.ScVal[]): Promise<Transaction> {
  const s = sorobanRpc();
  const account = await s.getAccount(user);
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(new Contract(AMM_CONTRACT).call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  // Simulates the exact call (with the user's min_out), so a trade that
  // would fail is caught here, before the user is asked to sign.
  const sim = await s.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw toError(sim.error);
  return rpc.assembleTransaction(tx, sim).build();
}

/** Unix seconds after which the contract rejects the call. */
export function deadlineFromNow(seconds = TX_TIMEOUT_SECONDS): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

export function buildAmmSwap(user: string, tokenIn: Token, tokenOut: Token, amountIn: bigint, minOut: bigint) {
  return buildInvoke(user, "swap_exact_in", [
    addr(user),
    addr(tokenIn.contract),
    addr(tokenOut.contract),
    i128(amountIn),
    i128(minOut),
    u64(deadlineFromNow()),
  ]);
}

export function buildAddLiquidity(
  user: string,
  tokenA: Token,
  tokenB: Token,
  amountA: bigint,
  amountB: bigint,
  minA: bigint,
  minB: bigint,
) {
  return buildInvoke(user, "add_liquidity", [
    addr(user),
    addr(tokenA.contract),
    addr(tokenB.contract),
    i128(amountA),
    i128(amountB),
    i128(minA),
    i128(minB),
    u64(deadlineFromNow()),
  ]);
}

export function buildRemoveLiquidity(user: string, tokenA: Token, tokenB: Token, shares: bigint, minA: bigint, minB: bigint) {
  return buildInvoke(user, "remove_liquidity", [
    addr(user),
    addr(tokenA.contract),
    addr(tokenB.contract),
    i128(shares),
    i128(minA),
    i128(minB),
    u64(deadlineFromNow()),
  ]);
}

// ── Pure helpers (mirrors contracts/anchorswap/src/math.rs) ──────────────────

export const FEE_BPS = 30n;

export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * (10_000n - FEE_BPS);
  return (inWithFee * reserveOut) / (reserveIn * 10_000n + inWithFee);
}

/** Tokens returned for burning `shares` (rounded down like the contract). */
export function sharesToAmounts(pool: Pool, shares: bigint): [bigint, bigint] {
  if (pool.totalShares === 0n) return [0n, 0n];
  return [(shares * pool.reserveA) / pool.totalShares, (shares * pool.reserveB) / pool.totalShares];
}

/** Amount of B matching `amountA` at the pool's current ratio. */
export function matchingAmount(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (reserveA === 0n) return 0n;
  return (amountA * reserveB) / reserveA;
}
