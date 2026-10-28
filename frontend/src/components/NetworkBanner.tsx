"use client";

import { useWallet } from "@/lib/wallet";
import { NETWORK } from "@/lib/config";
import { Alert } from "./ui";

/** Warns when the wallet is on the wrong network or its network is unknown. */
export default function NetworkBanner({ accountExists }: { accountExists: boolean | null }) {
  const { address, network, error, recheckNetwork } = useWallet();

  return (
    <div className="mb-4 space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      {address && network === "mismatch" && (
        <Alert tone="error">
          <div className="font-semibold">Wrong network</div>
          Your wallet is not on Stellar {NETWORK.name}. Switch networks in your wallet, then{" "}
          <button className="underline" onClick={() => void recheckNetwork()}>
            check again
          </button>
          .
        </Alert>
      )}
      {address && network === "unknown" && (
        <Alert tone="warn">
          Your wallet can&apos;t report which network it uses. Make sure it is set to {NETWORK.name}. Signatures for any
          other network are detected and rejected before sending.
        </Alert>
      )}
      {address && accountExists === false && (
        <Alert tone="warn">
          This account isn&apos;t funded on {NETWORK.name} yet. Get free test XLM from{" "}
          <a
            className="underline"
            href={`${NETWORK.friendbotUrl}/?addr=${address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Friendbot ↗
          </a>
          , then refresh.
        </Alert>
      )}
    </div>
  );
}
