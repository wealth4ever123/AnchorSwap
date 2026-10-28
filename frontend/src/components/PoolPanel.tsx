"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useBalances } from "@/hooks/useBalances";
import { useTxRunner } from "@/hooks/useTxRunner";
import { balanceOf } from "@/lib/horizon";
import {
  buildAddLiquidity,
  buildRemoveLiquidity,
  getShares,
  listPools,
  matchingAmount,
  sharesToAmounts,
  type Pool,
} from "@/lib/amm";
import { formatAmount, isAmountInput, minWithSlippage, toInputString, tryParseAmount } from "@/lib/amounts";
import { AMM_CONTRACT, DEFAULT_SLIPPAGE_BPS, explorerContract } from "@/lib/config";
import NetworkBanner from "./NetworkBanner";
import { Alert, Spinner, TxStatus } from "./ui";

export default function PoolPanel() {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const { address } = useWallet();
  const balances = useBalances(address);

  const load = useCallback(async () => {
    try {
      setPools(await listPools());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pools");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const pool = pools?.[selected] ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <NetworkBanner accountExists={balances.data ? balances.data.exists : null} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">Liquidity pools</h1>
        <a className="text-sm text-white/50 underline" href={explorerContract(AMM_CONTRACT)} target="_blank" rel="noopener noreferrer">
          Contract on explorer ↗
        </a>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!pools && !error && (
        <div className="flex items-center gap-2 text-white/60">
          <Spinner /> Loading pools from the contract…
        </div>
      )}
      {pools && pools.length === 0 && <Alert tone="info">No pools have been created yet.</Alert>}

      {pools && pools.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <ul className="space-y-2">
            {pools.map((p, i) => (
              <li key={`${p.tokenA.symbol}-${p.tokenB.symbol}`}>
                <button
                  onClick={() => setSelected(i)}
                  className={`glass-card glass-card-hover w-full p-4 text-left ${i === selected ? "ring-2 ring-anchor-400" : ""}`}
                >
                  <div className="font-semibold">
                    {p.tokenA.symbol} / {p.tokenB.symbol}
                  </div>
                  <div className="mt-1 text-sm text-white/60">
                    {formatAmount(p.reserveA, 7, 2)} {p.tokenA.symbol} · {formatAmount(p.reserveB, 7, 2)} {p.tokenB.symbol}
                  </div>
                  {p.reserveA > 0n && (
                    <div className="text-xs text-white/40">
                      1 {p.tokenA.symbol} = {formatAmount((p.reserveB * 10n ** 7n) / p.reserveA, 7, 6)} {p.tokenB.symbol}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {pool && <PoolActions pool={pool} balances={balances} onDone={load} />}
        </div>
      )}
    </div>
  );
}

function PoolActions({
  pool,
  balances,
  onDone,
}: {
  pool: Pool;
  balances: ReturnType<typeof useBalances>;
  onDone: () => Promise<void>;
}) {
  const { address, connect, network } = useWallet();
  const tx = useTxRunner();
  const [tab, setTab] = useState<"add" | "remove">("add");
  const [aStr, setAStr] = useState("");
  const [bStr, setBStr] = useState("");
  const [pct, setPct] = useState(50);
  const [shares, setShares] = useState<bigint | null>(null);
  const [successText, setSuccessText] = useState<string | undefined>();
  const { tokenA, tokenB } = pool;
  const empty = pool.totalShares === 0n;

  const refreshShares = useCallback(async () => {
    if (!address) return setShares(null);
    setShares(await getShares(tokenA, tokenB, address).catch(() => null));
  }, [address, tokenA, tokenB]);

  useEffect(() => {
    void refreshShares();
  }, [refreshShares, pool]);

  const balA = balanceOf(balances.data, tokenA);
  const balB = balanceOf(balances.data, tokenB);
  const amountA = tryParseAmount(aStr);
  const amountB = tryParseAmount(bStr);

  function onA(v: string) {
    if (!isAmountInput(v)) return;
    setAStr(v);
    const a = tryParseAmount(v);
    if (!empty && a !== null) setBStr(toInputString(matchingAmount(a, pool.reserveA, pool.reserveB)));
  }
  function onB(v: string) {
    if (!isAmountInput(v)) return;
    setBStr(v);
    const b = tryParseAmount(v);
    if (!empty && b !== null) setAStr(toInputString(matchingAmount(b, pool.reserveB, pool.reserveA)));
  }

  const addProblem = (() => {
    if (network === "mismatch") return "Wrong network";
    if (!amountA || !amountB) return "Enter amounts";
    if (!balA.hasTrustline || !balB.hasTrustline) return "Missing trustline";
    if (amountA > balA.spendable) return `Insufficient ${tokenA.symbol}`;
    if (amountB > balB.spendable) return `Insufficient ${tokenB.symbol}`;
    return null;
  })();

  const removeShares = shares ? (shares * BigInt(pct)) / 100n : 0n;
  const [outA, outB] = sharesToAmounts(pool, removeShares);
  const removeProblem = network === "mismatch" ? "Wrong network" : !shares ? "No shares to withdraw" : removeShares === 0n ? "Choose an amount" : null;

  async function add() {
    if (!address || !amountA || !amountB) return;
    const minA = minWithSlippage(amountA, DEFAULT_SLIPPAGE_BPS);
    const minB = minWithSlippage(amountB, DEFAULT_SLIPPAGE_BPS);
    const out = await tx.run("add_liquidity", `Add ${aStr} ${tokenA.symbol} + ${bStr} ${tokenB.symbol}`, () =>
      buildAddLiquidity(address, tokenA, tokenB, amountA, amountB, empty ? amountA : minA, empty ? amountB : minB),
    );
    if (out?.status === "success" && Array.isArray(out.returnValue)) {
      const [ua, ub, s] = out.returnValue as bigint[];
      setSuccessText(
        `Deposited ${formatAmount(ua)} ${tokenA.symbol} + ${formatAmount(ub)} ${tokenB.symbol}, received ${formatAmount(s)} shares.`,
      );
      setAStr("");
      setBStr("");
    }
    await Promise.all([onDone(), balances.refresh(), refreshShares()]);
  }

  async function remove() {
    if (!address || removeShares === 0n) return;
    const out = await tx.run("remove_liquidity", `Withdraw ${pct}% of ${tokenA.symbol}/${tokenB.symbol} position`, () =>
      buildRemoveLiquidity(
        address,
        tokenA,
        tokenB,
        removeShares,
        minWithSlippage(outA, DEFAULT_SLIPPAGE_BPS),
        minWithSlippage(outB, DEFAULT_SLIPPAGE_BPS),
      ),
    );
    if (out?.status === "success" && Array.isArray(out.returnValue)) {
      const [ra, rb] = out.returnValue as bigint[];
      setSuccessText(`Received ${formatAmount(ra)} ${tokenA.symbol} + ${formatAmount(rb)} ${tokenB.symbol}.`);
    }
    await Promise.all([onDone(), balances.refresh(), refreshShares()]);
  }

  const share = shares && pool.totalShares > 0n ? Number((shares * 1_000_000n) / pool.totalShares) / 10_000 : 0;
  const [posA, posB] = shares ? sharesToAmounts(pool, shares) : [0n, 0n];

  return (
    <section className="glass-card p-5">
      <h2 className="mb-1 text-lg font-bold">
        {tokenA.symbol} / {tokenB.symbol}
      </h2>
      {address && shares !== null && (
        <p className="mb-4 text-sm text-white/60">
          Your position: {formatAmount(shares, 7, 4)} shares ({share.toFixed(4)}% of pool) ≈ {formatAmount(posA, 7, 4)}{" "}
          {tokenA.symbol} + {formatAmount(posB, 7, 4)} {tokenB.symbol}
        </p>
      )}

      <div className="mb-4 flex gap-1 rounded-xl bg-white/5 p-1" role="tablist">
        {(["add", "remove"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              tx.reset();
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === t ? "bg-anchor-500" : "text-white/60"}`}
          >
            {t === "add" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>

      {tab === "add" ? (
        <div className="space-y-3">
          {[
            { t: tokenA, v: aStr, set: onA, bal: balA },
            { t: tokenB, v: bStr, set: onB, bal: balB },
          ].map(({ t, v, set, bal }) => (
            <label key={t.symbol} className="block rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-1 flex justify-between text-xs text-white/50">
                <span>{t.symbol}</span>
                {address && <span>Spendable: {formatAmount(bal.spendable, 7, 4)}</span>}
              </div>
              <input
                aria-label={`${t.symbol} amount`}
                inputMode="decimal"
                placeholder="0.0"
                value={v}
                onChange={(e) => set(e.target.value)}
                className="w-full bg-transparent text-xl font-semibold outline-none placeholder:text-white/20"
              />
            </label>
          ))}
          <p className="text-xs text-white/50">
            {empty
              ? "This pool is empty: your deposit sets the starting price."
              : "Amounts follow the pool's current ratio. Only the matching amounts are taken (0.5% tolerance)."}
          </p>
          <TxStatus state={tx.state} successText={successText} />
          {!address ? (
            <button className="btn-primary w-full" onClick={connect}>
              Connect wallet
            </button>
          ) : (
            <button className="btn-primary w-full" disabled={!!addProblem || tx.busy} onClick={() => void add()}>
              {tx.busy ? "Transaction in progress…" : (addProblem ?? "Deposit")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(p)}
                className={`flex-1 rounded-lg py-2 text-sm ${pct === p ? "bg-anchor-500" : "bg-white/10"}`}
              >
                {p}%
              </button>
            ))}
          </div>
          <dl className="space-y-1 rounded-xl border border-white/10 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-white/50">Shares to burn</dt>
              <dd>{formatAmount(removeShares, 7, 4)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/50">You receive (est.)</dt>
              <dd className="text-right">
                {formatAmount(outA, 7, 4)} {tokenA.symbol}
                <br />
                {formatAmount(outB, 7, 4)} {tokenB.symbol}
              </dd>
            </div>
          </dl>
          <TxStatus state={tx.state} successText={successText} />
          {!address ? (
            <button className="btn-primary w-full" onClick={connect}>
              Connect wallet
            </button>
          ) : (
            <button className="btn-primary w-full" disabled={!!removeProblem || tx.busy} onClick={() => void remove()}>
              {tx.busy ? "Transaction in progress…" : (removeProblem ?? "Withdraw")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
