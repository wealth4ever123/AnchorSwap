import { vi } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { WalletAdapter } from "@/lib/walletAdapter";

/**
 * In-memory wallet for tests. It holds a throwaway random key and signs
 * like a real wallet: for whatever network the wallet itself is set to.
 */
export function fakeWallet(opts: { network?: string | null; reject?: boolean } = {}) {
  const kp = Keypair.random();
  let network = opts.network === undefined ? Networks.TESTNET : opts.network;
  const adapter: WalletAdapter = {
    connect: vi.fn(async () => {
      if (opts.reject) throw { code: -1, message: "User declined access" };
      return { address: kp.publicKey(), walletId: "fake" };
    }),
    reconnect: vi.fn(async () => null),
    getNetworkPassphrase: vi.fn(async () => network),
    signTransaction: vi.fn(async (xdr: string) => {
      if (opts.reject) throw { code: -1, message: "User rejected the request" };
      const signingNetwork = network ?? Networks.TESTNET;
      const tx = TransactionBuilder.fromXDR(xdr, signingNetwork);
      tx.sign(kp);
      return tx.toXDR();
    }),
    disconnect: vi.fn(async () => undefined),
  };
  return {
    adapter,
    keypair: kp,
    setNetwork(n: string | null) {
      network = n;
    },
  };
}
