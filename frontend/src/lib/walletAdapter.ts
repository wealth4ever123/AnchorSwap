/**
 * Wallet abstraction. The app only talks to this interface, so the real
 * Stellar Wallets Kit can be swapped for a fake in tests.
 *
 * The app never asks for, sees, or stores a secret key: wallets only return
 * a public address and signed transactions.
 */
export interface WalletAdapter {
  /** Let the user pick a wallet and grant access. Returns the public key. */
  connect(): Promise<{ address: string; walletId: string }>;
  /** Restore a previous session without a prompt, if the wallet allows it. */
  reconnect(walletId: string): Promise<string | null>;
  /**
   * The wallet's current network passphrase, or null when the wallet cannot
   * report it (e.g. xBull, Albedo). Signatures are still checked afterwards.
   */
  getNetworkPassphrase(): Promise<string | null>;
  signTransaction(xdr: string, opts: { address: string; networkPassphrase: string }): Promise<string>;
  disconnect(): Promise<void>;
}

export async function createKitAdapter(networkPassphrase: string): Promise<WalletAdapter> {
  const [{ StellarWalletsKit }, freighter, xbull, albedo, lobstr, hana, rabet] = await Promise.all([
    import("@creit.tech/stellar-wallets-kit/sdk"),
    import("@creit.tech/stellar-wallets-kit/modules/freighter"),
    import("@creit.tech/stellar-wallets-kit/modules/xbull"),
    import("@creit.tech/stellar-wallets-kit/modules/albedo"),
    import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
    import("@creit.tech/stellar-wallets-kit/modules/hana"),
    import("@creit.tech/stellar-wallets-kit/modules/rabet"),
  ]);

  StellarWalletsKit.init({
    modules: [
      new freighter.FreighterModule(),
      new xbull.xBullModule(),
      new albedo.AlbedoModule(),
      new lobstr.LobstrModule(),
      new hana.HanaModule(),
      new rabet.RabetModule(),
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    network: networkPassphrase as any,
  });

  return {
    async connect() {
      const { address } = await StellarWalletsKit.authModal();
      return { address, walletId: StellarWalletsKit.selectedModule.productId };
    },
    async reconnect(walletId) {
      try {
        StellarWalletsKit.setWallet(walletId);
        const { address } = await StellarWalletsKit.fetchAddress();
        return address || null;
      } catch {
        return null;
      }
    },
    async getNetworkPassphrase() {
      try {
        const { networkPassphrase } = await StellarWalletsKit.getNetwork();
        return networkPassphrase || null;
      } catch {
        return null;
      }
    },
    async signTransaction(xdr, opts) {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, opts);
      return signedTxXdr;
    },
    async disconnect() {
      await StellarWalletsKit.disconnect().catch(() => undefined);
    },
  };
}

/** Turn wallet-kit errors (objects with code/message) into readable text. */
export function walletErrorMessage(e: unknown): string {
  const msg =
    (e as { message?: string })?.message ?? (typeof e === "string" ? e : "The wallet returned an error.");
  if (/reject|declin|denied|cancel/i.test(msg)) return "Request rejected in the wallet.";
  if (/not (installed|available)|no wallet/i.test(msg)) return "Wallet not found. Install it or choose another wallet.";
  return msg;
}
