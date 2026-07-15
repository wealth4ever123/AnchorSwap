export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string;
}

/**
 * Well-known Soroban testnet token addresses.
 * Replace with your deployed token contract IDs.
 */
export const KNOWN_TOKENS: Token[] = [
  {
    symbol: "XLM",
    name: "Stellar Lumens",
    address: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    decimals: 7,
    logoUrl: "/tokens/xlm.svg",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    decimals: 7,
    logoUrl: "/tokens/usdc.svg",
  },
  {
    symbol: "ANC",
    name: "AnchorSwap Token",
    address: process.env.NEXT_PUBLIC_ANC_TOKEN ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    decimals: 7,
    logoUrl: "/tokens/anc.svg",
  },
];

export function getToken(address: string): Token | undefined {
  return KNOWN_TOKENS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase()
  );
}

export function formatTokenAmount(raw: bigint, decimals = 7, precision = 4): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, precision)
    .replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
