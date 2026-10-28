import { describe, expect, it } from "vitest";
import { ContractError, CONTRACT_ERRORS, amountOut, contractErrorCode, matchingAmount, sharesToAmounts, type Pool } from "@/lib/amm";
import { TOKENS } from "@/lib/tokens";

describe("AMM math mirrors the contract", () => {
  // Same vectors as contracts/anchorswap/src/math.rs and test.rs.
  it("amountOut", () => {
    expect(amountOut(1_000n, 1_000_000n, 1_000_000n)).toBe(996n);
    expect(amountOut(10_000_000n, 1_000_000_000n, 1_000_000_000n)).toBe(9_871_580n);
    expect(amountOut(1n, 1_000_000n, 1_000_000n)).toBe(0n);
    expect(amountOut(0n, 1n, 1n)).toBe(0n);
    expect(amountOut(1n, 0n, 1n)).toBe(0n);
  });

  it("sharesToAmounts rounds down", () => {
    const pool: Pool = { tokenA: TOKENS[0], tokenB: TOKENS[1], reserveA: 3_001n, reserveB: 1_000n, totalShares: 1_000n };
    expect(sharesToAmounts(pool, 500n)).toEqual([1_500n, 500n]);
    expect(sharesToAmounts({ ...pool, totalShares: 0n }, 5n)).toEqual([0n, 0n]);
  });

  it("matchingAmount follows pool ratio", () => {
    expect(matchingAmount(100n, 2_000n, 1_000n)).toBe(50n);
    expect(matchingAmount(100n, 0n, 1_000n)).toBe(0n);
  });
});

describe("contract errors", () => {
  it("parses host error strings", () => {
    expect(contractErrorCode("HostError: Error(Contract, #5)\n...")).toBe(5);
    expect(contractErrorCode("Error(WasmVm, InvalidAction)")).toBeNull();
  });

  it("has a message for every contract error code (1..11)", () => {
    for (let i = 1; i <= 11; i++) expect(CONTRACT_ERRORS[i]).toBeTruthy();
    expect(new ContractError(5).message).toMatch(/slippage/i);
    expect(new ContractError(99).message).toBe("Contract error #99");
  });
});
