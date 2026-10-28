import { Asset, Horizon } from "@stellar/stellar-sdk";
import { NETWORK } from "./config";
import { fromHorizon, toHorizon } from "./amounts";
import { Token, assetKey } from "./tokens";

let server: Horizon.Server | null = null;
export function horizon(): Horizon.Server {
  server ??= new Horizon.Server(NETWORK.horizonUrl);
  return server;
}

const BASE_RESERVE = 5_000_000n; // 0.5 XLM in stroops

export interface TokenBalance {
  /** Total balance in stroops. */
  balance: bigint;
  /** What can actually be spent (minus XLM reserve and open offers). */
  spendable: bigint;
  /** For non-native assets: whether the account trusts the asset. */
  hasTrustline: boolean;
}

export interface AccountBalances {
  exists: boolean;
  balances: Record<string, TokenBalance>;
}

type HorizonBalance = Horizon.HorizonApi.BalanceLine;

/** Load real balances for `address`. Unfunded accounts return exists=false. */
export async function loadBalances(address: string): Promise<AccountBalances> {
  let account: Horizon.AccountResponse;
  try {
    account = await horizon().loadAccount(address);
  } catch (e) {
    if (isNotFound(e)) return { exists: false, balances: {} };
    throw e;
  }
  const balances: Record<string, TokenBalance> = {};
  for (const line of account.balances as HorizonBalance[]) {
    if (line.asset_type === "liquidity_pool_shares") continue;
    const key = line.asset_type === "native" ? "native" : `${line.asset_code}:${line.asset_issuer}`;
    const balance = fromHorizon(line.balance);
    const selling = fromHorizon(line.selling_liabilities ?? "0");
    let spendable = balance - selling;
    if (line.asset_type === "native") {
      const entries =
        2n +
        BigInt(account.subentry_count) +
        BigInt(account.num_sponsoring ?? 0) -
        BigInt(account.num_sponsored ?? 0);
      spendable -= entries * BASE_RESERVE;
    }
    balances[key] = {
      balance,
      spendable: spendable > 0n ? spendable : 0n,
      hasTrustline: true,
    };
  }
  return { exists: true, balances };
}

export function balanceOf(b: AccountBalances | null, token: Token): TokenBalance {
  return b?.balances[assetKey(token.asset)] ?? { balance: 0n, spendable: 0n, hasTrustline: false };
}

export interface DexQuote {
  amountOut: bigint;
  /** Intermediate hops (empty for a direct market). */
  path: Asset[];
}

/**
 * Best real quote from the Stellar DEX (order books + classic AMM pools)
 * for selling exactly `amountIn`. Returns null if no path exists.
 */
export async function dexQuote(from: Token, to: Token, amountIn: bigint): Promise<DexQuote | null> {
  const res = await horizon()
    .strictSendPaths(from.asset, toHorizon(amountIn), [to.asset])
    .limit(20)
    .call();
  let best: DexQuote | null = null;
  for (const r of res.records) {
    const out = fromHorizon(r.destination_amount);
    if (!best || out > best.amountOut) {
      best = {
        amountOut: out,
        path: r.path.map((p) =>
          p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
        ),
      };
    }
  }
  return best && best.amountOut > 0n ? best : null;
}

export function isNotFound(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 404 || (e as { name?: string })?.name === "NotFoundError";
}
