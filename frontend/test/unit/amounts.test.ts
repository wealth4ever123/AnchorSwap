import { describe, expect, it } from "vitest";
import {
  AmountError,
  MAX_AMOUNT,
  formatAmount,
  formatBps,
  fromHorizon,
  isAmountInput,
  minWithSlippage,
  parseAmount,
  priceImpactBps,
  toHorizon,
  toInputString,
  tryParseAmount,
} from "@/lib/amounts";

describe("parseAmount", () => {
  it("parses whole and fractional amounts exactly", () => {
    expect(parseAmount("1")).toBe(10_000_000n);
    expect(parseAmount("1.5")).toBe(15_000_000n);
    expect(parseAmount("0.0000001")).toBe(1n);
    expect(parseAmount(".5")).toBe(5_000_000n);
    expect(parseAmount("5.")).toBe(50_000_000n);
    expect(parseAmount("  2 ")).toBe(20_000_000n);
    // No float rounding: 0.1 + 0.2 style inputs stay exact.
    expect(parseAmount("0.3")).toBe(3_000_000n);
  });

  it("rejects invalid input", () => {
    for (const bad of ["", ".", "abc", "1,5", "-1", "1e5", "1.2.3"]) {
      expect(() => parseAmount(bad), bad).toThrow(AmountError);
    }
    expect(() => parseAmount("1.00000001")).toThrow(/decimal places/);
    expect(() => parseAmount("922337203686.4775808")).toThrow(/too large/);
    expect(parseAmount("922337203685.4775807")).toBe(MAX_AMOUNT);
  });

  it("tryParseAmount returns null instead of throwing", () => {
    expect(tryParseAmount("x")).toBeNull();
    expect(tryParseAmount("3")).toBe(30_000_000n);
  });

  it("isAmountInput allows partial typing only", () => {
    expect(isAmountInput("")).toBe(true);
    expect(isAmountInput("1.")).toBe(true);
    expect(isAmountInput("1.2")).toBe(true);
    expect(isAmountInput("1a")).toBe(false);
    expect(isAmountInput("-")).toBe(false);
  });
});

describe("formatAmount", () => {
  it("formats with separators and truncates", () => {
    expect(formatAmount(12_345_678_900_000n)).toBe("1,234,567.89");
    expect(formatAmount(15_000_000n)).toBe("1.5");
    expect(formatAmount(19_999_999n, 7, 2)).toBe("1.99"); // never rounds up
    expect(formatAmount(0n)).toBe("0");
    expect(formatAmount(-15_000_000n)).toBe("-1.5");
  });

  it("round-trips through input strings and Horizon strings", () => {
    for (const v of [1n, 15_000_000n, 12_345_678_900_000n, MAX_AMOUNT]) {
      expect(parseAmount(toInputString(v))).toBe(v);
      expect(fromHorizon(toHorizon(v))).toBe(v);
    }
    expect(fromHorizon("12.3400000")).toBe(123_400_000n);
  });
});

describe("slippage and price impact", () => {
  it("minWithSlippage rounds down", () => {
    expect(minWithSlippage(10_000n, 50)).toBe(9_950n);
    expect(minWithSlippage(999n, 50)).toBe(994n);
    expect(minWithSlippage(10_000n, 0)).toBe(10_000n);
    expect(() => minWithSlippage(1n, -1)).toThrow();
    expect(() => minWithSlippage(1n, 10_001)).toThrow();
  });

  it("priceImpactBps measures shortfall against spot price", () => {
    // Spot 1:1, got 99 for 100 -> 1 %.
    expect(priceImpactBps(100n, 99n, { num: 1n, den: 1n })).toBe(100);
    // Better than spot reports 0.
    expect(priceImpactBps(100n, 101n, { num: 1n, den: 1n })).toBe(0);
    // Spot 5 out per 1 in.
    expect(priceImpactBps(10n, 45n, { num: 5n, den: 1n })).toBe(1000);
    expect(priceImpactBps(0n, 0n, { num: 1n, den: 1n })).toBe(0);
  });

  it("formatBps", () => {
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(30)).toBe("0.3%");
    expect(formatBps(1500)).toBe("15%");
  });
});
