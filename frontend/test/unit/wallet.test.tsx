import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Account, Asset, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { WalletProvider, useWallet } from "@/lib/wallet";
import NetworkBanner from "@/components/NetworkBanner";
import WalletButton from "@/components/WalletButton";
import { fakeWallet } from "./fakeWallet";

function wrapperFor(adapter: ReturnType<typeof fakeWallet>["adapter"]) {
  return ({ children }: { children: React.ReactNode }) => <WalletProvider adapter={adapter}>{children}</WalletProvider>;
}

function txFor(address: string) {
  return new TransactionBuilder(new Account(address, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: address, asset: Asset.native(), amount: "1" }))
    .setTimeout(60)
    .build();
}

describe("wallet flow", () => {
  it("connects, reports the network, and signs for Testnet", async () => {
    const w = fakeWallet();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    expect(result.current.address).toBeNull();

    await act(() => result.current.connect());
    expect(result.current.address).toBe(w.keypair.publicKey());
    expect(result.current.network).toBe("ok");

    const signed = await result.current.sign(txFor(w.keypair.publicKey()));
    expect(signed.signatures).toHaveLength(1);
    // The app only ever passes our network passphrase and the address.
    expect(w.adapter.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      address: w.keypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("detects a wallet on the wrong network and rejects its signatures", async () => {
    const w = fakeWallet({ network: Networks.PUBLIC });
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    expect(result.current.network).toBe("mismatch");
    await expect(result.current.sign(txFor(w.keypair.publicKey()))).rejects.toThrow(/not valid for Stellar Testnet/);
  });

  it("treats wallets that cannot report a network as unknown, still verifying signatures", async () => {
    const w = fakeWallet({ network: null });
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    expect(result.current.network).toBe("unknown");
    await expect(result.current.sign(txFor(w.keypair.publicKey()))).resolves.toBeTruthy();
  });

  it("notices when the user switches network later", async () => {
    const w = fakeWallet();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    w.setNetwork(Networks.PUBLIC);
    await act(() => result.current.recheckNetwork());
    expect(result.current.network).toBe("mismatch");
  });

  it("shows a readable error when the user rejects the connection", async () => {
    const w = fakeWallet({ reject: true });
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    expect(result.current.address).toBeNull();
    expect(result.current.error).toBe("Request rejected in the wallet.");
  });

  it("disconnects and forgets the session", async () => {
    const w = fakeWallet();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    expect(localStorage.getItem("anchorswap.wallet.v1")).toContain("fake");
    await act(() => result.current.disconnect());
    expect(result.current.address).toBeNull();
    expect(localStorage.getItem("anchorswap.wallet.v1")).toBeNull();
  });

  it("never exposes or requests a secret key", async () => {
    const w = fakeWallet();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(w.adapter) });
    await act(() => result.current.connect());
    const json = JSON.stringify({ ...result.current, ls: { ...localStorage } });
    expect(json).not.toContain(w.keypair.secret());
  });
});

describe("wallet UI", () => {
  it("connect button and wrong-network banner", async () => {
    const w = fakeWallet({ network: Networks.PUBLIC });
    render(
      <WalletProvider adapter={w.adapter}>
        <WalletButton />
        <NetworkBanner accountExists={true} />
      </WalletProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByText(/Wrong network/)).toBeInTheDocument());
    expect(screen.getByText(`${w.keypair.publicKey().slice(0, 4)}…${w.keypair.publicKey().slice(-4)}`)).toBeInTheDocument();
  });

  it("offers Friendbot when the account is unfunded", async () => {
    const w = fakeWallet();
    render(
      <WalletProvider adapter={w.adapter}>
        <WalletButton />
        <NetworkBanner accountExists={false} />
      </WalletProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const link = await screen.findByRole("link", { name: /Friendbot/ });
    expect(link).toHaveAttribute("href", `https://friendbot.stellar.org/?addr=${w.keypair.publicKey()}`);
  });
});
