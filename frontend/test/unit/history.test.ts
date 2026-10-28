import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tx", () => ({ verifyOnHorizon: vi.fn() }));
const tx = await import("@/lib/tx");
const { upsertHistory, refreshPending, clearHistory, _resetHistoryCache } = await import("@/lib/history");

const read = () => JSON.parse(localStorage.getItem("anchorswap.history.v1") ?? "[]");
const base = { account: "GA", kind: "swap" as const, summary: "Swap", createdAt: 1 };

beforeEach(() => {
  _resetHistoryCache();
  localStorage.clear();
});

describe("history", () => {
  it("adds new items first and merges updates", () => {
    upsertHistory({ ...base, hash: "a", status: "pending" });
    upsertHistory({ ...base, hash: "b", status: "pending" });
    upsertHistory({ hash: "a", status: "success", ledger: 10 });
    expect(read().map((i: { hash: string }) => i.hash)).toEqual(["b", "a"]);
    expect(read()[1]).toMatchObject({ hash: "a", status: "success", ledger: 10, summary: "Swap" });
  });

  it("updates pending items only from Horizon results", async () => {
    upsertHistory({ ...base, hash: "p1", status: "pending" });
    upsertHistory({ ...base, hash: "p2", status: "pending" });
    upsertHistory({ ...base, hash: "p3", status: "pending" });
    vi.mocked(tx.verifyOnHorizon).mockImplementation(async (h) =>
      h === "p1" ? { successful: true, ledger: 5 } : h === "p2" ? { successful: false, ledger: 6 } : null,
    );
    await refreshPending(read());
    const byHash = Object.fromEntries(read().map((i: { hash: string; status: string }) => [i.hash, i.status]));
    expect(byHash).toEqual({ p1: "success", p2: "failed", p3: "pending" });
  });

  it("survives corrupt storage and can be cleared", () => {
    localStorage.setItem("anchorswap.history.v1", "{not json");
    upsertHistory({ ...base, hash: "x", status: "failed" });
    expect(read()).toHaveLength(1);
    clearHistory();
    expect(read()).toEqual([]);
  });
});
