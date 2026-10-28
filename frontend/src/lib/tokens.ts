import { Asset } from "@stellar/stellar-sdk";
import { DEPLOYMENT, NETWORK } from "./config";

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  /** Classic Stellar asset (used for balances, trustlines and the DEX). */
  asset: Asset;
  /** Stellar Asset Contract ID (used by the AnchorSwap contract). */
  contract: string;
}

function parseAsset(id: string): Asset {
  if (id === "native") return Asset.native();
  const [code, issuer] = id.split(":");
  return new Asset(code, issuer);
}

function makeToken(symbol: string, name: string, assetId: string, expectedContract?: string): Token {
  const asset = parseAsset(assetId);
  const contract = asset.contractId(NETWORK.passphrase);
  // The contract ID is derived from the asset, so a mismatch means the
  // config was edited by hand or points at another network.
  if (expectedContract && expectedContract !== contract) {
    throw new Error(`Token ${symbol}: configured contract ${expectedContract} does not match asset ${assetId}`);
  }
  return { symbol, name, decimals: 7, asset, contract };
}

/** Circle's USDC issuer on Testnet. */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * The only tokens the app will trade. Users cannot paste arbitrary assets,
 * which rules out look-alike or malicious tokens.
 */
export const TOKENS: Token[] = [
  makeToken("XLM", "Stellar Lumens", "native", DEPLOYMENT.tokens.XLM.contract),
  makeToken("ANC", "AnchorSwap Test Token", DEPLOYMENT.tokens.ANC.asset, DEPLOYMENT.tokens.ANC.contract),
  makeToken("USDC", "USD Coin (Circle testnet)", `USDC:${TESTNET_USDC_ISSUER}`),
];

export function tokenBySymbol(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol === symbol);
}

export function tokenByContract(contract: string): Token | undefined {
  return TOKENS.find((t) => t.contract === contract);
}

/** Stable key for a classic asset, matching Horizon's balance format. */
export function assetKey(asset: Asset): string {
  return asset.isNative() ? "native" : `${asset.getCode()}:${asset.getIssuer()}`;
}
