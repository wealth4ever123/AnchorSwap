/**
 * Real quotes from every supported route. Nothing here is estimated
 * locally: the AnchorSwap quote is the contract's own `get_amount_out`
 * (simulated on-chain) and the DEX quote is Horizon's path finder.
 */
import type { Asset } from "@stellar/stellar-sdk";
import { ammQuote, getPool } from "./amm";
import { dexQuote } from "./horizon";
import { priceImpactBps } from "./amounts";
import { Token } from "./tokens";

export type RouteKind = "amm" | "dex";

export interface Route {
  kind: RouteKind;
  label: string;
  amountOut: bigint;
  /** Liquidity provider fee in bps, if the route has a fixed one. */
  feeBps: number | null;
  /** Price impact in bps, or null if it could not be measured. */
  priceImpactBps: number | null;
  /** DEX only: intermediate assets. */
  path?: Asset[];
}

export interface QuoteResult {
  from: Token;
  to: Token;
  amountIn: bigint;
  routes: Route[];
  best: Route | null;
  /** Routes that failed for a reason other than "no liquidity". */
  errors: { kind: RouteKind; message: string }[];
  fetchedAt: number;
}

async function ammRoute(from: Token, to: Token, amountIn: bigint): Promise<Route | null> {
  const pool = await getPool(from, to);
  if (!pool || pool.reserveA === 0n || pool.reserveB === 0n) return null;
  const out = await ammQuote(from, to, amountIn);
  if (out === null) return null;
  return {
    kind: "amm",
    label: "AnchorSwap pool",
    amountOut: out,
    feeBps: 30,
    priceImpactBps: priceImpactBps(amountIn, out, { num: pool.reserveB, den: pool.reserveA }),
  };
}

async function dexRoute(from: Token, to: Token, amountIn: bigint): Promise<Route | null> {
  // A quote for a small slice gives the current market price, which is
  // what price impact is measured against.
  const refIn = amountIn / 1000n > 0n ? amountIn / 1000n : amountIn;
  const [main, ref] = await Promise.all([dexQuote(from, to, amountIn), dexQuote(from, to, refIn).catch(() => null)]);
  if (!main) return null;
  return {
    kind: "dex",
    label: main.path.length ? `Stellar DEX (via ${main.path.map((a) => a.getCode()).join(" → ")})` : "Stellar DEX",
    amountOut: main.amountOut,
    feeBps: null,
    priceImpactBps: ref ? priceImpactBps(amountIn, main.amountOut, { num: ref.amountOut, den: refIn }) : null,
    path: main.path,
  };
}

export async function getQuotes(from: Token, to: Token, amountIn: bigint): Promise<QuoteResult> {
  if (from.symbol === to.symbol) throw new Error("Choose two different tokens");
  if (amountIn <= 0n) throw new Error("Amount must be greater than zero");

  const kinds: RouteKind[] = ["amm", "dex"];
  const settled = await Promise.allSettled([ammRoute(from, to, amountIn), dexRoute(from, to, amountIn)]);
  const routes: Route[] = [];
  const errors: QuoteResult["errors"] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value) routes.push(r.value);
    } else {
      errors.push({ kind: kinds[i], message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    }
  });
  routes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  return { from, to, amountIn, routes, best: routes[0] ?? null, errors, fetchedAt: Date.now() };
}
