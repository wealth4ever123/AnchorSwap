"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useBalances } from "@/hooks/useBalances";
import { useQuote } from "@/hooks/useQuote";
import { useTxRunner } from "@/hooks/useTxRunner";
import { balanceOf } from "@/lib/horizon";
import { TOKENS, type Token } from "@/lib/tokens";
import {
  formatAmount,
  formatBps,
  isAmountInput,
  minWithSlippage,
  toInputString,
  tryParseAmount,
} from "@/lib/amounts";
import { DEFAULT_SLIPPAGE_BPS, PRICE_IMPACT_BLOCK_BPS, PRICE_IMPACT_WARN_BPS } from "@/lib/config";
import { buildAmmSwap } from "@/lib/amm";
import { buildPathPayment, buildTrustline } from "@/lib/dex";
import { getQuotes, type Route } from "@/lib/quotes";
import TokenSelect from "./TokenSelect";
import SlippageSettings from "./SlippageSettings";
import NetworkBanner from "./NetworkBanner";
import { Alert, Spinner, TxStatus } from "./ui";

export default function SwapCard() {
  const { address, connect, network } = useWallet();
  const balances = useBalances(address);
  const tx = useTxRunner();

  const [from, setFrom] = useState<Token>(TOKENS[0]);
  const [to, setTo] = useState<Token>(TOKENS[1]);
  const [amountStr, setAmountStr] = useState("");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_BPS);
  const [routeKind, setRouteKind] = useState<Route["kind"] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [priceChanged, setPriceChanged] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | undefined>();

  const amountIn = tryParseAmount(amountStr, from.decimals);
  const { quote, loading: quoting, error: quoteError, refetch } = useQuote(from, to, amountIn);

  const route = useMemo(() => {
    if (!quote) return null;
    return quote.routes.find((r) => r.kind === routeKind) ?? quote.best;
  }, [quote, routeKind]);

  const fromBal = balanceOf(balances.data, from);
  const toBal = balanceOf(balances.data, to);
  const needsTrustline = !!address && balances.data?.exists === true && !to.asset.isNative() && !toBal.hasTrustline;
  const minOut = route ? minWithSlippage(route.amountOut, slippage) : null;
  const impact = route?.priceImpactBps ?? null;

  // First problem found, shown on the button.
  const problem = (() => {
    if (!address) return null;
    if (network === "mismatch") return "Wrong network";
    if (balances.data?.exists === false) return "Fund account first";
    if (amountStr && amountIn === null) return "Invalid amount";
    if (!amountIn) return "Enter an amount";
    if (balances.data && amountIn > fromBal.spendable) return `Insufficient ${from.symbol}`;
    if (quoting && !quote) return "Getting quote…";
    if (quote && !route) return "No liquidity for this pair";
    if (impact !== null && impact >= PRICE_IMPACT_BLOCK_BPS) return "Price impact too high";
    if (needsTrustline) return `Add ${to.symbol} trustline first`;
    return null;
  })();

  function flip() {
    setFrom(to);
    setTo(from);
    setAmountStr("");
    setRouteKind(null);
  }

  function pickFrom(t: Token) {
    if (t.symbol === to.symbol) setTo(from);
    setFrom(t);
    setRouteKind(null);
  }

  function pickTo(t: Token) {
    if (t.symbol === from.symbol) setFrom(to);
    setTo(t);
    setRouteKind(null);
  }

  async function addTrustline() {
    if (!address) return;
    setSuccessText(`You can now receive ${to.symbol}.`);
    await tx.run("trustline", `Add ${to.symbol} trustline`, () => buildTrustline(address, to));
    await balances.refresh();
  }

  async function executeSwap() {
    if (!address || !route || !amountIn || !minOut) return;
    setPriceChanged(null);
    // Re-quote right before signing so the user never signs a stale price.
    const fresh = await getQuotes(from, to, amountIn).catch(() => null);
    const freshRoute = fresh?.routes.find((r) => r.kind === route.kind);
    if (!freshRoute) {
      setPriceChanged("This route is no longer available. Review the new quote.");
      void refetch();
      return;
    }
    if (freshRoute.amountOut < minOut) {
      setPriceChanged(
        `Price moved: you'd now get ${formatAmount(freshRoute.amountOut, to.decimals)} ${to.symbol}, below your minimum. Review and confirm again.`,
      );
      void refetch();
      return;
    }
    setConfirming(false);
    // Never accept less than the minimum the user just confirmed.
    const freshMin = minWithSlippage(freshRoute.amountOut, slippage);
    const finalMin = freshMin > minOut ? freshMin : minOut;
    const summary = `Swap ${formatAmount(amountIn, from.decimals)} ${from.symbol} → ${to.symbol} (${route.label})`;
    const outcome = await tx.run("swap", summary, () =>
      route.kind === "amm"
        ? buildAmmSwap(address, from, to, amountIn, finalMin)
        : buildPathPayment(address, from, to, amountIn, finalMin, freshRoute.path ?? []),
    );
    if (outcome?.status === "success") {
      const got =
        typeof outcome.returnValue === "bigint" ? outcome.returnValue : (outcome.received ?? null);
      setSuccessText(got !== null ? `Received ${formatAmount(got, to.decimals)} ${to.symbol}.` : undefined);
      setAmountStr("");
    }
    await balances.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <NetworkBanner accountExists={balances.data ? balances.data.exists : null} />
      <section className="glass-card p-5" aria-labelledby="swap-title">
        <div className="mb-4 flex items-center justify-between">
          <h1 id="swap-title" className="text-xl font-bold">
            Swap
          </h1>
          <SlippageSettings value={slippage} onChange={setSlippage} />
        </div>

        {/* You pay */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 flex justify-between text-xs text-white/50">
            <span>You pay</span>
            {address && balances.data?.exists && (
              <span>
                Balance: {formatAmount(fromBal.balance, from.decimals, 4)}
                {fromBal.spendable > 0n && (
                  <button
                    className="ml-2 font-semibold text-anchor-400 hover:text-anchor-100"
                    onClick={() => setAmountStr(toInputString(fromBal.spendable, from.decimals))}
                  >
                    MAX
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              aria-label="Amount to pay"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => isAmountInput(e.target.value) && setAmountStr(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-white/20"
            />
            <TokenSelect label="Token to pay" value={from} onChange={pickFrom} />
          </div>
          {from.symbol === "XLM" && address && balances.data?.exists && (
            <div className="mt-1 text-xs text-white/40">
              Spendable after reserve: {formatAmount(fromBal.spendable, 7, 4)} XLM
            </div>
          )}
        </div>

        <div className="relative z-10 -my-3 flex justify-center">
          <button
            aria-label="Switch tokens"
            onClick={flip}
            className="h-9 w-9 rounded-full border border-white/15 bg-anchor-900 text-white/70 hover:text-white"
          >
            ↕
          </button>
        </div>

        {/* You receive */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 flex justify-between text-xs text-white/50">
            <span>You receive (estimated)</span>
            {address && balances.data?.exists && toBal.hasTrustline && (
              <span>Balance: {formatAmount(toBal.balance, to.decimals, 4)}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <output aria-label="Amount to receive" className="min-w-0 flex-1 truncate text-2xl font-semibold text-white/80">
              {quoting && !route ? <Spinner /> : route ? formatAmount(route.amountOut, to.decimals, 7) : "0.0"}
            </output>
            <TokenSelect label="Token to receive" value={to} onChange={pickTo} />
          </div>
        </div>

        {/* Quote details */}
        {quote && quote.routes.length > 1 && (
          <fieldset className="mt-4 space-y-2">
            <legend className="mb-1 text-xs text-white/50">Routes (real quotes)</legend>
            {quote.routes.map((r) => (
              <label
                key={r.kind}
                className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                  route?.kind === r.kind ? "border-anchor-400/60 bg-anchor-500/10" : "border-white/10"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="route"
                    checked={route?.kind === r.kind}
                    onChange={() => setRouteKind(r.kind)}
                  />
                  {r.label}
                  {r === quote.best && <span className="text-xs text-emerald-300">best</span>}
                </span>
                <span className="font-mono">{formatAmount(r.amountOut, to.decimals, 4)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {route && amountIn && minOut !== null && (
          <dl className="mt-4 space-y-1.5 rounded-xl border border-white/10 px-4 py-3 text-sm text-white/70">
            <Row label="Route">{route.label}</Row>
            <Row label="Rate">
              1 {from.symbol} ≈ {formatAmount((route.amountOut * 10n ** 7n) / amountIn, 7, 6)} {to.symbol}
            </Row>
            <Row label="Liquidity fee">{route.feeBps !== null ? formatBps(route.feeBps) : "Included in price"}</Row>
            <Row label="Price impact">
              <span
                className={
                  impact === null
                    ? ""
                    : impact >= PRICE_IMPACT_BLOCK_BPS
                      ? "text-red-400"
                      : impact >= PRICE_IMPACT_WARN_BPS
                        ? "text-amber-300"
                        : ""
                }
              >
                {impact === null ? "Unknown" : impact < 1 ? "<0.01%" : formatBps(impact)}
              </span>
            </Row>
            <Row label={`Minimum received (${formatBps(slippage)} slippage)`}>
              {formatAmount(minOut, to.decimals, 7)} {to.symbol}
            </Row>
          </dl>
        )}

        <div className="mt-4 space-y-3">
          {quoteError && <Alert tone="error">Could not get a quote: {quoteError}</Alert>}
          {quote?.errors.map((e) => (
            <Alert key={e.kind} tone="warn">
              {e.kind === "amm" ? "AnchorSwap" : "Stellar DEX"} quote unavailable: {e.message}
            </Alert>
          ))}
          {impact !== null && impact >= PRICE_IMPACT_WARN_BPS && impact < PRICE_IMPACT_BLOCK_BPS && (
            <Alert tone="warn">High price impact ({formatBps(impact)}). Consider a smaller amount.</Alert>
          )}
          {needsTrustline && (
            <Alert tone="info">
              To receive {to.symbol} your account must trust it first (reserves 0.5 XLM).
              <button
                className="btn-primary mt-2 w-full py-2 text-sm"
                onClick={() => void addTrustline()}
                disabled={tx.busy || network === "mismatch"}
              >
                Add {to.symbol} trustline
              </button>
            </Alert>
          )}
          <TxStatus state={tx.state} successText={successText} />
        </div>

        {!address ? (
          <button onClick={connect} className="btn-primary mt-4 w-full text-base">
            Connect wallet
          </button>
        ) : (
          <button
            onClick={() => {
              tx.reset();
              setPriceChanged(null);
              setConfirming(true);
            }}
            disabled={!!problem || tx.busy}
            className="btn-primary mt-4 w-full text-base"
          >
            {tx.busy ? "Transaction in progress…" : (problem ?? "Review swap")}
          </button>
        )}
      </section>

      {confirming && route && amountIn && minOut !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="glass-card w-full max-w-sm bg-anchor-900/95 p-5">
            <h2 id="confirm-title" className="mb-4 text-lg font-bold">
              Confirm swap
            </h2>
            <dl className="space-y-2 text-sm">
              <Row label="You pay">
                {formatAmount(amountIn, from.decimals)} {from.symbol}
              </Row>
              <Row label="You receive (est.)">
                {formatAmount(route.amountOut, to.decimals)} {to.symbol}
              </Row>
              <Row label="Minimum received">
                {formatAmount(minOut, to.decimals)} {to.symbol}
              </Row>
              <Row label="Route">{route.label}</Row>
              <Row label="Slippage tolerance">{formatBps(slippage)}</Row>
              <Row label="Network">Stellar Testnet</Row>
            </dl>
            <p className="mt-3 text-xs text-white/50">
              If the price moves beyond your slippage limit, the transaction fails on-chain and only the network fee
              (a fraction of a cent of XLM) is spent.
            </p>
            {priceChanged && (
              <div className="mt-3">
                <Alert tone="warn">{priceChanged}</Alert>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-xl border border-white/20 py-3 font-semibold" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn-primary flex-1" onClick={() => void executeSwap()}>
                Confirm swap
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
