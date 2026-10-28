"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { explorerAccount } from "@/lib/config";
import { Spinner, shortAddress } from "./ui";

export default function WalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  if (!address) {
    return (
      <button onClick={connect} disabled={connecting} className="btn-primary px-4 py-2 text-sm">
        {connecting ? (
          <span className="flex items-center gap-2">
            <Spinner /> Connecting…
          </span>
        ) : (
          "Connect wallet"
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass-card glass-card-hover flex items-center gap-2 px-4 py-2 text-sm font-medium"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono">{shortAddress(address)}</span>
      </button>
      {open && (
        <div role="menu" className="glass-card absolute right-0 z-20 mt-2 w-56 p-2 text-sm" onMouseLeave={() => setOpen(false)}>
          <button
            role="menuitem"
            className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
            onClick={() => {
              void navigator.clipboard?.writeText(address);
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <a
            role="menuitem"
            className="block rounded-lg px-3 py-2 hover:bg-white/10"
            href={explorerAccount(address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on explorer ↗
          </a>
          <button
            role="menuitem"
            className="w-full rounded-lg px-3 py-2 text-left text-red-300 hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
