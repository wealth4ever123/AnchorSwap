import { beforeEach, describe, expect, it, vi } from "vitest";
import { Asset } from "@stellar/stellar-sdk";
import { tokenBySymbol } from "@/lib/tokens";

vi.mock("@/lib/amm", () => ({ ammQuote: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/horizon", () => ({ dexQuote: vi.fn() }));

const amm = await import("@/lib/amm");
const horizon = await import("@/lib/horizon");
const { getQuotes } = await import("@/lib/quotes");

const XLM = tokenBySymbol("XLM")!;
const ANC = tokenBySymbol("ANC")!;
const pool = { tokenA: XLM, tokenB: ANC, reserveA: 20_000_000_000n, reserveB: 100_000_000_000n, totalShares: 1n };

beforeEach(() => {
  vi.mocked(amm.getPool).mockResolvedValue(pool);
  vi.mocked(amm.ammQuote).mockResolvedValue(49_000_000n);
  vi.mocked(horizon.dexQuote).mockResolvedValue(null);
});

describe("getQuotes", () => {
  it("returns the AMM route with fee and price impact", async () => {
    const q = await getQuotes(XLM, ANC, 10_000_000n);
    expect(q.routes).toHaveLength(1);
    expect(q.best).toMatchObject({ kind: "amm", amountOut: 49_000_000n, feeBps: 30 });
    // Spot is 5 ANC per XLM, got 4.9 -> 2 % impact.
    expect(q.best!.priceImpactBps).toBe(200);
    expect(amm.ammQuote).toHaveBeenCalledWith(XLM, ANC, 10_000_000n);
  });

  it("picks the route with the higher output", async () => {
    vi.mocked(horizon.dexQuote).mockImplementation(async (_f, _t, amt) => ({
      amountOut: amt === 10_000_000n ? 49_500_000n : 49_600n,
      path: [Asset.native()],
    }));
    const q = await getQuotes(XLM, ANC, 10_000_000n);
    expect(q.routes.map((r) => r.kind)).toEqual(["dex", "amm"]);
    expect(q.best!.kind).toBe("dex");
    expect(q.best!.label).toContain("via XLM");
    expect(q.best!.priceImpactBps).toBe(20); // 49.5 vs 49.6 reference
  });

  it("skips empty pools and reports no route", async () => {
    vi.mocked(amm.getPool).mockResolvedValue({ ...pool, reserveA: 0n, reserveB: 0n });
    const q = await getQuotes(XLM, ANC, 10_000_000n);
    expect(q.best).toBeNull();
    expect(q.errors).toEqual([]);
  });

  it("keeps working when one venue errors", async () => {
    vi.mocked(horizon.dexQuote).mockRejectedValue(new Error("Horizon down"));
    const q = await getQuotes(XLM, ANC, 10_000_000n);
    expect(q.best!.kind).toBe("amm");
    expect(q.errors).toEqual([{ kind: "dex", message: "Horizon down" }]);
  });

  it("validates input", async () => {
    await expect(getQuotes(XLM, XLM, 1n)).rejects.toThrow(/different/);
    await expect(getQuotes(XLM, ANC, 0n)).rejects.toThrow(/greater than zero/);
  });
});
