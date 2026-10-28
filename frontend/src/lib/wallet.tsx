"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NETWORK } from "./config";
import { assertSignedFor } from "./tx";
import { createKitAdapter, walletErrorMessage, type WalletAdapter } from "./walletAdapter";
import type { Transaction } from "@stellar/stellar-sdk";

export type NetworkState = "ok" | "mismatch" | "unknown";

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  error: string | null;
  /** "unknown" when the wallet cannot report its network. */
  network: NetworkState;
  walletNetworkPassphrase: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Ask the wallet to sign, then verify the signature is for our network. */
  sign(tx: Transaction): Promise<Transaction>;
  recheckNetwork(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const STORAGE_KEY = "anchorswap.wallet.v1";

function loadSaved(): { walletId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(v: { walletId: string } | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function WalletProvider({
  children,
  adapter: injected,
}: {
  children: React.ReactNode;
  /** Tests pass a fake adapter; the app uses Stellar Wallets Kit. */
  adapter?: WalletAdapter;
}) {
  const adapterRef = useRef<Promise<WalletAdapter> | null>(injected ? Promise.resolve(injected) : null);
  const getAdapter = useCallback(() => {
    adapterRef.current ??= createKitAdapter(NETWORK.passphrase);
    return adapterRef.current;
  }, []);

  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletNet, setWalletNet] = useState<string | null>(null);

  const recheckNetwork = useCallback(async () => {
    const a = await getAdapter();
    setWalletNet(await a.getNetworkPassphrase());
  }, [getAdapter]);

  // Restore a previous session.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    let cancelled = false;
    (async () => {
      const a = await getAdapter();
      const addr = await a.reconnect(saved.walletId);
      if (cancelled) return;
      if (addr) {
        setAddress(addr);
        setWalletNet(await a.getNetworkPassphrase());
      } else {
        save(null);
      }
    })().catch(() => save(null));
    return () => {
      cancelled = true;
    };
  }, [getAdapter]);

  // Wallets can switch network or account at any time; re-check on focus.
  useEffect(() => {
    if (!address) return;
    const onFocus = () => void recheckNetwork().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    const t = setInterval(onFocus, 15_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [address, recheckNetwork]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await getAdapter();
      const { address: addr, walletId } = await a.connect();
      setAddress(addr);
      save({ walletId });
      setWalletNet(await a.getNetworkPassphrase());
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, [getAdapter]);

  const disconnect = useCallback(async () => {
    const a = await getAdapter();
    await a.disconnect();
    save(null);
    setAddress(null);
    setWalletNet(null);
  }, [getAdapter]);

  const sign = useCallback(
    async (tx: Transaction) => {
      if (!address) throw new Error("Connect a wallet first.");
      const a = await getAdapter();
      let signed: string;
      try {
        signed = await a.signTransaction(tx.toXDR(), { address, networkPassphrase: NETWORK.passphrase });
      } catch (e) {
        throw new Error(walletErrorMessage(e));
      }
      return assertSignedFor(signed, address);
    },
    [address, getAdapter],
  );

  const network: NetworkState =
    walletNet === null ? "unknown" : walletNet === NETWORK.passphrase ? "ok" : "mismatch";

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      connecting,
      error,
      network,
      walletNetworkPassphrase: walletNet,
      connect,
      disconnect,
      sign,
      recheckNetwork,
    }),
    [address, connecting, error, network, walletNet, connect, disconnect, sign, recheckNetwork],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
