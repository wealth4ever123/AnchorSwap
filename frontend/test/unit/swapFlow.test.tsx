import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Account, Asset, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { fakeWallet } from "./fakeWallet";

vi.mock("@/lib/horizon", async (orig) => ({
  ...(await orig<typeof import("@/lib/horizon")>()),
  loadBalances: vi.fn(),
  dexQuote: vi.fn(),
}));
vi.mock("@/lib/amm", async (orig) => ({
  ...(await orig<typeof import("@/lib/amm")>()),
  ammQuote: vi.fn(),
  getPool: vi.fn(),
  buildAmmSwap: vi.fn(),
}));
vi.mock("@/lib/dex", () => ({ buildPathPayment: vi.fn(), buildTrustline: vi.fn() }));
vi.mock("@/lib/tx", async (orig) => ({
  ...(await orig<typeof import("@/lib/tx")>()),
  submitAndWait: vi.fn(),
}));

const horizon = await import("@/lib/horizon");
const amm = await import("@/lib/amm");
const dex = await import("@/lib/dex");
const tx = await import("@/lib/tx");
const { WalletProvider } = await import("@/lib/wallet");
const { default: SwapCard } = await import("@/components/SwapCard");
const { tokenBySymbol } = await import("@/lib/tokens");

const XLM = tokenBySymbol("XLM")!;
const ANC = tokenBySymbol("ANC")!;
const ancKey = `${ANC.asset.getCode()}:${ANC.asset.getIssuer()}`;

function dummyTx(user: string) {
  return new TransactionBuilder(new Account(user, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: user, asset: Asset.native(), amount: "1" }))
    .setTimeout(60)
    .build();
}

function setup(walletOpts?: Parameters<typeof fakeWallet>[0], { trustsAnc = true } = {}) {
  const w = fakeWallet(walletOpts);
  vi.mocked(horizon.loadBalances).mockResolvedValue({
    exists: true,
    balances: {
      native: { balance: 1_000_000_000n, spendable: 990_000_000n, hasTrustline: true },
      ...(trustsAnc ? { [ancKey]: { balance: 0n, spendable: 0n, hasTrustline: true } } : {}),
    },
  });
  render(
    <WalletProvider adapter={w.adapter}>
      <SwapCard />
    </WalletProvider>,
  );
  return w;
}

beforeEach(() => {
  vi.mocked(amm.getPool).mockResolvedValue({
    tokenA: XLM,
    tokenB: ANC,
    reserveA: 20_000_000_000n,
    reserveB: 100_000_000_000n,
    totalShares: 1n,
  });
  vi.mocked(amm.ammQuote).mockResolvedValue(49_825_610n);
  vi.mocked(horizon.dexQuote).mockResolvedValue(null);
  vi.mocked(amm.buildAmmSwap).mockImplementation(async (user) => dummyTx(user));
  vi.mocked(dex.buildTrustline).mockImplementation(async (user) => dummyTx(user));
});

async function connectAndQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: "Connect wallet" })[0]);
  await screen.findByText(/Balance: 100/);
  await user.type(screen.getByLabelText("Amount to pay"), "1");
  await waitFor(() => expect(screen.getByLabelText("Amount to receive")).toHaveTextContent("4.982561"));
}

describe("swap flow", () => {
  it("connect → quote → review → sign → confirmed on-chain", async () => {
    const user = userEvent.setup();
    const w = setup();
    let resolveSubmit!: (v: Awaited<ReturnType<typeof tx.submitAndWait>>) => void;
    vi.mocked(tx.submitAndWait).mockImplementation(async (_t, opts) => {
      opts?.onSubmitted?.("abc123");
      return new Promise((r) => (resolveSubmit = r));
    });

    await connectAndQuote(user);
    expect(screen.getByText("0.3%")).toBeInTheDocument(); // LP fee
    expect(screen.getByText(/Minimum received \(0.5% slippage\)/)).toBeInTheDocument();
    expect(screen.getByText("4.9576481 ANC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review swap" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("1 XLM")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm swap" }));

    // Built with the exact amount and the slippage-protected minimum.
    await waitFor(() => expect(amm.buildAmmSwap).toHaveBeenCalled());
    const [addr, from, to, amountIn, minOut] = vi.mocked(amm.buildAmmSwap).mock.calls[0];
    expect([addr, from.symbol, to.symbol, amountIn, minOut]).toEqual([w.keypair.publicKey(), "XLM", "ANC", 10_000_000n, 49_576_481n]);
    expect(w.adapter.signTransaction).toHaveBeenCalledTimes(1);

    // Submitted but not confirmed: no success message yet.
    expect(await screen.findByText(/Waiting for ledger confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed on-chain/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Stellar Expert/ })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );

    resolveSubmit({ hash: "abc123", status: "success", ledger: 99, returnValue: 49_825_610n });
    expect(await screen.findByText(/Confirmed on-chain in ledger 99/)).toBeInTheDocument();
    expect(screen.getByText("Received 4.982561 ANC.")).toBeInTheDocument();

    const history = JSON.parse(localStorage.getItem("anchorswap.history.v1")!);
    expect(history[0]).toMatchObject({ hash: "abc123", status: "success", kind: "swap", ledger: 99 });
  });

  it("shows the on-chain failure reason", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(tx.submitAndWait).mockResolvedValue({ hash: "bad1", status: "failed", error: "Price moved beyond your slippage limit." });
    await connectAndQuote(user);
    await user.click(screen.getByRole("button", { name: "Review swap" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByText("Transaction failed.")).toBeInTheDocument();
    expect(screen.getByText(/slippage limit/)).toBeInTheDocument();
  });

  it("stops if the price moved below the confirmed minimum", async () => {
    const user = userEvent.setup();
    setup();
    await connectAndQuote(user);
    await user.click(screen.getByRole("button", { name: "Review swap" }));
    vi.mocked(amm.ammQuote).mockResolvedValue(40_000_000n);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByText(/Price moved/)).toBeInTheDocument();
    expect(amm.buildAmmSwap).not.toHaveBeenCalled();
  });

  it("does not submit when the user rejects in the wallet", async () => {
    const user = userEvent.setup();
    const w = setup();
    await connectAndQuote(user);
    vi.mocked(w.adapter.signTransaction).mockRejectedValueOnce({ message: "User rejected the request" });
    await user.click(screen.getByRole("button", { name: "Review swap" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByText("Request rejected in the wallet.")).toBeInTheDocument();
    expect(tx.submitAndWait).not.toHaveBeenCalled();
  });

  it("blocks swaps on the wrong network", async () => {
    const user = userEvent.setup();
    setup({ network: Networks.PUBLIC });
    await user.click(screen.getAllByRole("button", { name: "Connect wallet" })[0]);
    expect(await screen.findByRole("button", { name: "Wrong network" })).toBeDisabled();
  });

  it("blocks amounts above the spendable balance", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole("button", { name: "Connect wallet" })[0]);
    await screen.findByText(/Balance: 100/);
    await user.type(screen.getByLabelText("Amount to pay"), "500");
    expect(await screen.findByRole("button", { name: "Insufficient XLM" })).toBeDisabled();
  });

  it("asks for a trustline before receiving a new asset", async () => {
    const user = userEvent.setup();
    setup(undefined, { trustsAnc: false });
    vi.mocked(tx.submitAndWait).mockResolvedValue({ hash: "t1", status: "success", ledger: 5 });
    await connectAndQuote(user);
    expect(screen.getByRole("button", { name: "Add ANC trustline first" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add ANC trustline" }));
    await waitFor(() => expect(dex.buildTrustline).toHaveBeenCalled());
    expect(await screen.findByText(/You can now receive ANC/)).toBeInTheDocument();
  });

  it("shows when no route has liquidity", async () => {
    const user = userEvent.setup();
    setup();
    vi.mocked(amm.getPool).mockResolvedValue(null);
    await user.click(screen.getAllByRole("button", { name: "Connect wallet" })[0]);
    await screen.findByText(/Balance: 100/);
    await user.type(screen.getByLabelText("Amount to pay"), "1");
    expect(await screen.findByRole("button", { name: "No liquidity for this pair" })).toBeDisabled();
  });
});
