import { Networks, StrKey } from "@stellar/stellar-sdk";
import deployment from "@/config/testnet.json";

/**
 * Network settings. Everything defaults to Stellar Testnet and the contract
 * IDs written by `scripts/deploy_testnet.sh`; env vars override them.
 */
export const NETWORK = {
  name: "Testnet",
  passphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet",
  friendbotUrl: "https://friendbot.stellar.org",
} as const;

export const AMM_CONTRACT: string =
  process.env.NEXT_PUBLIC_ANCHORSWAP_CONTRACT ?? deployment.anchorswap;

if (!StrKey.isValidContract(AMM_CONTRACT)) {
  throw new Error(`Invalid AnchorSwap contract ID: ${AMM_CONTRACT}`);
}

export const DEPLOYMENT = deployment;

/** Default and maximum slippage the UI allows, in basis points. */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 500;
/** Price impact (bps) that shows a warning, and that blocks the swap. */
export const PRICE_IMPACT_WARN_BPS = 300;
export const PRICE_IMPACT_BLOCK_BPS = 1500;
/** How long a signed transaction stays valid, in seconds. */
export const TX_TIMEOUT_SECONDS = 180;

export const explorerTx = (hash: string) => `${NETWORK.explorerUrl}/tx/${hash}`;
export const explorerAccount = (id: string) => `${NETWORK.explorerUrl}/account/${id}`;
export const explorerContract = (id: string) => `${NETWORK.explorerUrl}/contract/${id}`;
