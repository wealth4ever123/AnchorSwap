/**
 * Exact token amount handling. Amounts are always bigint in the token's
 * smallest unit (stroops for 7-decimal Stellar assets). Floats are never
 * used for balances or limits.
 */

export class AmountError extends Error {}

const DECIMAL_RE = /^\d*(\.\d*)?$/;
/** Largest amount a classic Stellar asset can hold (int64). */
export const MAX_AMOUNT = 9_223_372_036_854_775_807n;

/** True if `value` is something the user could still be typing. */
export function isAmountInput(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** "1.5" -> 15000000n for 7 decimals. Throws AmountError on bad input. */
export function parseAmount(value: string, decimals = 7): bigint {
  const v = value.trim();
  if (v === "" || v === ".") throw new AmountError("Enter an amount");
  if (!DECIMAL_RE.test(v)) throw new AmountError("Not a valid number");
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) throw new AmountError(`At most ${decimals} decimal places`);
  const raw = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  if (raw > MAX_AMOUNT) throw new AmountError("Amount is too large");
  return raw;
}

/** Like parseAmount but returns null instead of throwing. */
export function tryParseAmount(value: string, decimals = 7): bigint | null {
  try {
    return parseAmount(value, decimals);
  } catch {
    return null;
  }
}

/** 15000000n -> "1.5". `maxFraction` truncates (never rounds up). */
export function formatAmount(raw: bigint, decimals = 7, maxFraction = decimals): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Same as formatAmount but without thousands separators (for inputs). */
export function toInputString(raw: bigint, decimals = 7): string {
  return formatAmount(raw, decimals).replace(/,/g, "");
}

/** Classic Horizon amounts are strings like "12.3400000". */
export function fromHorizon(value: string): bigint {
  return parseAmount(value, 7);
}

export function toHorizon(raw: bigint): string {
  return toInputString(raw, 7);
}

/** Lowest acceptable output after `bps` slippage, rounded down. */
export function minWithSlippage(amount: bigint, bps: number): bigint {
  if (bps < 0 || bps > 10_000) throw new AmountError("Invalid slippage");
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

/**
 * Price impact in basis points: how much worse the execution price is than
 * the pool's spot price. For x*y=k with a fee this includes the fee.
 */
export function priceImpactBps(amountIn: bigint, amountOut: bigint, spotOutPerIn: { num: bigint; den: bigint }): number {
  if (amountIn <= 0n || spotOutPerIn.num <= 0n) return 0;
  // ideal = amountIn * num / den. impact = 1 - out/ideal.
  const ideal = amountIn * spotOutPerIn.num;
  const actual = amountOut * spotOutPerIn.den;
  if (actual >= ideal) return 0;
  return Number(((ideal - actual) * 10_000n) / ideal);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
