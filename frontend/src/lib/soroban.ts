/**
 * AnchorSwap Soroban RPC client.
 *
 * Wraps stellar-sdk's SorobanRpc.Server to simulate read-only contract
 * calls and build/submit transactions for state-changing operations.
 */

import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

// ─── Config ───────────────────────────────────────────────────────────────────

export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Fill this in after `scripts/deploy_testnet.sh` prints the contract ID. */
export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

// ─── RPC server singleton ─────────────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;
export function getRpcServer(): SorobanRpc.Server {
  if (!_server) {
    _server = new SorobanRpc.Server(TESTNET_RPC, { allowHttp: false });
  }
  return _server;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReserveData {
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  price: number; // tokenB per tokenA
}

export interface PoolInfo {
  tokenA: string;
  tokenB: string;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  price: number;
  tvlUsd: number; // placeholder
}

// ─── Simulation helpers ───────────────────────────────────────────────────────

async function simulateRead(
  method: string,
  args: xdr.ScVal[]
): Promise<xdr.ScVal> {
  const server = getRpcServer();
  const contract = new Contract(CONTRACT_ID);

  // We need a dummy source account for simulation
  const dummyKey = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const account = await server.getAccount(dummyKey).catch(() => {
    // Fallback to a synthetic account object
    return { accountId: () => dummyKey, sequenceNumber: () => "0", incrementSequenceNumber: () => {} } as unknown as SorobanRpc.Api.AccountResponse;
  });

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation error: ${simResult.error}`);
  }
  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    throw new Error("Simulation failed");
  }

  const retVal = simResult.result?.retval;
  if (!retVal) throw new Error("No return value from simulation");
  return retVal;
}

// ─── Public read-only calls ───────────────────────────────────────────────────

export async function getReserves(
  tokenA: string,
  tokenB: string
): Promise<{ reserveA: bigint; reserveB: bigint }> {
  const result = await simulateRead("get_reserves", [
    new Address(tokenA).toScVal(),
    new Address(tokenB).toScVal(),
  ]);
  const [ra, rb] = scValToNative(result) as [bigint, bigint];
  return { reserveA: BigInt(ra), reserveB: BigInt(rb) };
}

export async function getTotalShares(
  tokenA: string,
  tokenB: string
): Promise<bigint> {
  const result = await simulateRead("total_shares", [
    new Address(tokenA).toScVal(),
    new Address(tokenB).toScVal(),
  ]);
  return BigInt(scValToNative(result) as number);
}

export async function getUserShare(
  tokenA: string,
  tokenB: string,
  user: string
): Promise<bigint> {
  const result = await simulateRead("get_share", [
    new Address(tokenA).toScVal(),
    new Address(tokenB).toScVal(),
    new Address(user).toScVal(),
  ]);
  return BigInt(scValToNative(result) as number);
}

/** Compute expected swap output using the constant-product formula locally. */
export function computeSwapOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): bigint {
  if (reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/** Format a raw i128 (stroops) to a human-readable decimal string. */
export function formatAmount(raw: bigint, decimals = 7): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/** Parse a human-readable decimal string to raw i128 stroops. */
export function parseAmount(value: string, decimals = 7): bigint {
  const [whole, frac = ""] = value.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10 ** decimals) + BigInt(fracPadded || "0");
}

// ─── Transaction builders (returned XDR for Freighter to sign) ───────────────

export async function buildSwapTx(
  userAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  minOut: bigint
): Promise<string> {
  const server = getRpcServer();
  const account = await server.getAccount(userAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "swap_exact_in",
        new Address(tokenIn).toScVal(),
        new Address(tokenOut).toScVal(),
        nativeToScVal(amountIn, { type: "i128" }),
        nativeToScVal(minOut, { type: "i128" }),
        new Address(userAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  return preparedTx.toXDR();
}

export async function buildAddLiquidityTx(
  userAddress: string,
  tokenA: string,
  tokenB: string,
  amountA: bigint,
  amountB: bigint,
  minShare: bigint
): Promise<string> {
  const server = getRpcServer();
  const account = await server.getAccount(userAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "add_liquidity",
        new Address(tokenA).toScVal(),
        new Address(tokenB).toScVal(),
        nativeToScVal(amountA, { type: "i128" }),
        nativeToScVal(amountB, { type: "i128" }),
        nativeToScVal(minShare, { type: "i128" }),
        new Address(userAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  return preparedTx.toXDR();
}

export async function buildRemoveLiquidityTx(
  userAddress: string,
  tokenA: string,
  tokenB: string,
  shareAmount: bigint,
  minA: bigint,
  minB: bigint
): Promise<string> {
  const server = getRpcServer();
  const account = await server.getAccount(userAddress);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "remove_liquidity",
        new Address(tokenA).toScVal(),
        new Address(tokenB).toScVal(),
        nativeToScVal(shareAmount, { type: "i128" }),
        nativeToScVal(minA, { type: "i128" }),
        nativeToScVal(minB, { type: "i128" }),
        new Address(userAddress).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  return preparedTx.toXDR();
}

export async function submitSignedTx(signedXdr: string): Promise<string> {
  const server = getRpcServer();
  const result = await server.sendTransaction(
    // Re-hydrate the transaction from XDR
    new (await import("@stellar/stellar-sdk")).Transaction(
      signedXdr,
      NETWORK_PASSPHRASE
    )
  );
  if (result.status === "ERROR") {
    throw new Error(`Submit failed: ${result.errorResult?.toXDR("base64")}`);
  }
  return result.hash;
}
