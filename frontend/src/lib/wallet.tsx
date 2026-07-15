"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type FreighterAPI = typeof import("@stellar/freighter-api");

interface WalletState {
  address: string | null;
  network: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    network: null,
    connected: false,
    connecting: false,
    error: null,
  });

  const [freighter, setFreighter] = useState<FreighterAPI | null>(null);

  useEffect(() => {
    import("@stellar/freighter-api")
      .then((api) => setFreighter(api))
      .catch((e) => console.warn("Freighter not available:", e));
  }, []);

  useEffect(() => {
    if (!freighter) return;
    freighter.isConnected().then(({ isConnected }) => {
      if (isConnected) {
        freighter
          .getAddress()
          .then(({ address }) => {
            freighter.getNetwork().then(({ network }) => {
              setState((s) => ({ ...s, address, network, connected: true }));
            });
          })
          .catch(() => {});
      }
    });
  }, [freighter]);

  const connect = useCallback(async () => {
    if (!freighter) {
      setState((s) => ({
        ...s,
        error: "Freighter wallet extension not detected. Please install it.",
      }));
      return;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const { address } = await freighter.requestAccess();
      const { network } = await freighter.getNetwork();
      setState({ address, network, connected: true, connecting: false, error: null });
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e instanceof Error ? e.message : "Failed to connect wallet",
      }));
    }
  }, [freighter]);

  const disconnect = useCallback(() => {
    setState({ address: null, network: null, connected: false, connecting: false, error: null });
  }, []);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!freighter) throw new Error("Freighter not available");
      if (!state.network) throw new Error("No network selected");
      const result = await freighter.signTransaction(xdr, {
        networkPassphrase: state.network,
      });
      return result.signedTxXdr;
    },
    [freighter, state.network]
  );

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, signTransaction }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
