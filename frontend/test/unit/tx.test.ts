import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, Operation, TransactionBuilder, Asset, type Transaction } from "@stellar/stellar-sdk";

const rpcMock = { sendTransaction: vi.fn(), getTransaction: vi.fn() };
vi.mock("@/lib/amm", async (orig) => ({
  ...(await orig<typeof import("@/lib/amm")>()),
  sorobanRpc: () => rpcMock,
}));

const { assertSignedFor, submitAndWait, SignatureError } = await import("@/lib/tx");

const user = Keypair.random();

function makeTx(passphrase = Networks.TESTNET): Transaction {
  return new TransactionBuilder(new Account(user.publicKey(), "1"), { fee: "100", networkPassphrase: passphrase })
    .addOperation(Operation.payment({ destination: user.publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(60)
    .build();
}

describe("assertSignedFor", () => {
  it("accepts a testnet signature from the expected account", () => {
    const tx = makeTx();
    tx.sign(user);
    expect(assertSignedFor(tx.toXDR(), user.publicKey()).hash()).toEqual(tx.hash());
  });

  it("rejects a signature made for another network", () => {
    const tx = makeTx(Networks.PUBLIC);
    tx.sign(user);
    expect(() => assertSignedFor(tx.toXDR(), user.publicKey())).toThrow(SignatureError);
    expect(() => assertSignedFor(tx.toXDR(), user.publicKey())).toThrow(/Testnet/);
  });

  it("rejects a signature from a different account", () => {
    const tx = makeTx();
    tx.sign(Keypair.random());
    expect(() => assertSignedFor(tx.toXDR(), user.publicKey())).toThrow(SignatureError);
  });

  it("rejects an unsigned or garbage transaction", () => {
    expect(() => assertSignedFor(makeTx().toXDR(), user.publicKey())).toThrow(SignatureError);
    expect(() => assertSignedFor("not-xdr", user.publicKey())).toThrow(/invalid transaction/);
  });
});

describe("submitAndWait", () => {
  beforeEach(() => {
    rpcMock.sendTransaction.mockReset();
    rpcMock.getTransaction.mockReset();
  });

  it("reports success only after the ledger confirms", async () => {
    rpcMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "h1" });
    rpcMock.getTransaction
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "SUCCESS", ledger: 42, resultXdr: { result: { type: "txSuccess", results: [] } } });
    const onSubmitted = vi.fn();
    const out = await submitAndWait(makeTx(), { onSubmitted, pollMs: 1 });
    expect(onSubmitted).toHaveBeenCalledWith("h1");
    expect(rpcMock.getTransaction).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ hash: "h1", status: "success", ledger: 42 });
  });

  it("returns failed when the ledger says FAILED", async () => {
    rpcMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "h2" });
    rpcMock.getTransaction.mockResolvedValue({
      status: "FAILED",
      ledger: 7,
      diagnosticEventsXdr: [],
      resultXdr: {
        result: {
          type: "txFailed",
          results: [
            {
              type: "opInner",
              tr: { type: "pathPaymentStrictSend", pathPaymentStrictSendResult: { type: "pathPaymentStrictSendUnderDestmin" } },
            },
          ],
        },
      },
    });
    const out = await submitAndWait(makeTx(), { pollMs: 1 });
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/slippage/);
  });

  it("decodes contract errors from diagnostic events", async () => {
    rpcMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "h3" });
    rpcMock.getTransaction.mockResolvedValue({
      status: "FAILED",
      diagnosticEventsXdr: [
        {
          event: {
            body: {
              type: "v0",
              v0: { topics: [{ type: "scvSymbol" }, { type: "scvError", error: { type: "sceContract", contractCode: 8 } }], data: { type: "scvVoid" } },
            },
          },
        },
      ],
      resultXdr: { result: { type: "txFailed", results: [] } },
    });
    const out = await submitAndWait(makeTx(), { pollMs: 1 });
    expect(out.error).toMatch(/expired/);
  });

  it("does not wait on a rejected submission", async () => {
    rpcMock.sendTransaction.mockResolvedValue({ status: "ERROR", hash: "h4", errorResult: { result: { type: "txBadSeq" } } });
    const onSubmitted = vi.fn();
    const out = await submitAndWait(makeTx(), { onSubmitted });
    expect(out).toMatchObject({ status: "failed", error: expect.stringMatching(/sequence/) });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(rpcMock.getTransaction).not.toHaveBeenCalled();
  });

  it("never claims success when confirmation times out", async () => {
    rpcMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "h5" });
    rpcMock.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const out = await submitAndWait(makeTx(), { pollMs: 1, timeoutMs: 20 });
    expect(out).toEqual({ hash: "h5", status: "pending" });
  });
});
