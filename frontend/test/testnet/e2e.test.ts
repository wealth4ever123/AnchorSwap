/**
 * End-to-end tests against the real Stellar Testnet, using the same library
 * code as the web app. A fresh throwaway keypair (funded by Friendbot) plays
 * the role of the wallet. Nothing is mocked.
 *
 *   npm run test:testnet
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { NETWORK, explorerTx } from "@/lib/config";
import { tokenBySymbol } from "@/lib/tokens";
import { balanceOf, loadBalances } from "@/lib/horizon";
import { getQuotes } from "@/lib/quotes";
import {
  ContractError,
  buildAddLiquidity,
  buildAmmSwap,
  buildRemoveLiquidity,
  getPool,
  getShares,
  matchingAmount,
} from "@/lib/amm";
import { buildPathPayment, buildTrustline } from "@/lib/dex";
import { assertSignedFor, submitAndWait, verifyOnHorizon, type TxOutcome } from "@/lib/tx";
import { minWithSlippage } from "@/lib/amounts";

const XLM = tokenBySymbol("XLM")!;
const ANC = tokenBySymbol("ANC")!;
const USDC = tokenBySymbol("USDC")!;
const kp = Keypair.random();
const user = kp.publicKey();
const hashes: Record<string, string> = {};

/** Acts like a wallet: signs for testnet, then the app verifies it. */
function walletSign(tx: Transaction): Transaction {
  const copy = TransactionBuilder.fromXDR(tx.toXDR(), NETWORK.passphrase) as Transaction;
  copy.sign(kp);
  return assertSignedFor(copy.toXDR(), user);
}

async function send(label: string, tx: Transaction): Promise<TxOutcome> {
  const out = await submitAndWait(walletSign(tx));
  hashes[label] = out.hash;
  console.log(`${label}: ${out.status} ${explorerTx(out.hash)}${out.error ? ` (${out.error})` : ""}`);
  return out;
}

/** Second, independent confirmation through Horizon (retries while it catches up). */
async function horizonConfirms(hash: string) {
  for (let i = 0; i < 15; i++) {
    const r = await verifyOnHorizon(hash);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2_000));
  }
  return null;
}

beforeAll(async () => {
  const res = await fetch(`${NETWORK.friendbotUrl}/?addr=${user}`);
  expect(res.ok, `friendbot: ${res.status}`).toBe(true);
  console.log(`test account: ${user}`);
});

describe("Stellar Testnet end-to-end", () => {
  it("account is funded with real XLM", async () => {
    const b = await loadBalances(user);
    expect(b.exists).toBe(true);
    expect(balanceOf(b, XLM).balance).toBe(10_000n * 10_000_000n);
  });

  it("adds ANC and USDC trustlines", async () => {
    for (const t of [ANC, USDC]) {
      const out = await send(`trustline_${t.symbol}`, await buildTrustline(user, t));
      expect(out.status).toBe("success");
    }
    const b = await loadBalances(user);
    expect(balanceOf(b, ANC).hasTrustline).toBe(true);
    expect(balanceOf(b, USDC).hasTrustline).toBe(true);
  });

  it("rejects a swap whose minimum is above the quote before anything is signed", async () => {
    const q = await getQuotes(XLM, ANC, 10_000_000n);
    const amm = q.routes.find((r) => r.kind === "amm")!;
    await expect(buildAmmSwap(user, XLM, ANC, 10_000_000n, amm.amountOut + 1n)).rejects.toSatisfy(
      (e) => e instanceof ContractError && e.code === 5,
    );
  });

  it("swaps XLM → ANC through the AnchorSwap pool with a real quote", async () => {
    const amountIn = 25n * 10_000_000n;
    const q = await getQuotes(XLM, ANC, amountIn);
    const route = q.routes.find((r) => r.kind === "amm");
    expect(route, "AnchorSwap route").toBeTruthy();
    expect(route!.feeBps).toBe(30);
    const minOut = minWithSlippage(route!.amountOut, 50);

    const before = await loadBalances(user);
    const out = await send("swap_amm_XLM_ANC", await buildAmmSwap(user, XLM, ANC, amountIn, minOut));
    expect(out.status).toBe("success");
    const received = out.returnValue as bigint;
    expect(received).toBeGreaterThanOrEqual(minOut);
    console.log(`quoted ${route!.amountOut}, received ${received} stroops ANC`);

    expect(await horizonConfirms(out.hash)).toMatchObject({ successful: true, ledger: out.ledger });
    const after = await loadBalances(user);
    expect(balanceOf(after, ANC).balance - balanceOf(before, ANC).balance).toBe(received);
    // Paid exactly amountIn plus a network fee (< 0.1 XLM).
    const spent = balanceOf(before, XLM).balance - balanceOf(after, XLM).balance;
    expect(spent).toBeGreaterThanOrEqual(amountIn);
    expect(spent - amountIn).toBeLessThan(1_000_000n);
  });

  it("swaps ANC → XLM back through the pool", async () => {
    const b = await loadBalances(user);
    const amountIn = balanceOf(b, ANC).balance / 2n;
    const q = await getQuotes(ANC, XLM, amountIn);
    const route = q.routes.find((r) => r.kind === "amm")!;
    const out = await send(
      "swap_amm_ANC_XLM",
      await buildAmmSwap(user, ANC, XLM, amountIn, minWithSlippage(route.amountOut, 50)),
    );
    expect(out.status).toBe("success");
    expect(await horizonConfirms(out.hash)).toMatchObject({ successful: true });
  });

  it("swaps XLM → USDC through the Stellar DEX with a Horizon path quote", async () => {
    const amountIn = 5n * 10_000_000n;
    const q = await getQuotes(XLM, USDC, amountIn);
    const route = q.routes.find((r) => r.kind === "dex");
    if (!route) {
      console.warn("No testnet DEX liquidity for XLM/USDC right now; skipping.");
      return;
    }
    const minOut = minWithSlippage(route.amountOut, 100);
    const before = await loadBalances(user);
    const out = await send(
      "swap_dex_XLM_USDC",
      await buildPathPayment(user, XLM, USDC, amountIn, minOut, route.path ?? []),
    );
    expect(out.status).toBe("success");
    expect(out.received).toBeGreaterThanOrEqual(minOut);
    expect(await horizonConfirms(out.hash)).toMatchObject({ successful: true });
    const after = await loadBalances(user);
    expect(balanceOf(after, USDC).balance - balanceOf(before, USDC).balance).toBe(out.received);
  });

  it("adds and removes liquidity", async () => {
    const pool = (await getPool(XLM, ANC))!;
    const b = await loadBalances(user);
    const ancAmount = balanceOf(b, ANC).balance / 2n;
    const xlmAmount = matchingAmount(ancAmount, pool.reserveB, pool.reserveA);
    const added = await send(
      "add_liquidity",
      await buildAddLiquidity(
        user,
        XLM,
        ANC,
        xlmAmount,
        ancAmount,
        minWithSlippage(xlmAmount, 50),
        minWithSlippage(ancAmount, 50),
      ),
    );
    expect(added.status).toBe("success");
    const [, , shares] = added.returnValue as bigint[];
    expect(shares).toBeGreaterThan(0n);
    expect(await getShares(XLM, ANC, user)).toBe(shares);

    const removed = await send("remove_liquidity", await buildRemoveLiquidity(user, XLM, ANC, shares, 0n, 0n));
    expect(removed.status).toBe("success");
    const [outXlm, outAnc] = removed.returnValue as bigint[];
    expect(outXlm).toBeGreaterThan(0n);
    expect(outAnc).toBeGreaterThan(0n);
    expect(await getShares(XLM, ANC, user)).toBe(0n);
    expect(await horizonConfirms(removed.hash)).toMatchObject({ successful: true });
  });

  it("prints the transactions for independent verification", () => {
    console.log(JSON.stringify({ account: user, transactions: hashes }, null, 2));
    expect(Object.keys(hashes).length).toBeGreaterThanOrEqual(5);
  });
});
