import { describe, expect, it } from "vitest";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";
import { AMM_CONTRACT, NETWORK, explorerTx } from "@/lib/config";
import { TOKENS, TESTNET_USDC_ISSUER, assetKey, tokenByContract, tokenBySymbol } from "@/lib/tokens";

describe("config", () => {
  it("defaults to testnet", () => {
    expect(NETWORK.passphrase).toBe(Networks.TESTNET);
    expect(StrKey.isValidContract(AMM_CONTRACT)).toBe(true);
    expect(explorerTx("abc")).toBe("https://stellar.expert/explorer/testnet/tx/abc");
  });
});

describe("token list", () => {
  it("derives every contract ID from its asset on this network", () => {
    for (const t of TOKENS) {
      expect(t.asset.contractId(Networks.TESTNET)).toBe(t.contract);
      expect(t.decimals).toBe(7);
    }
  });

  it("uses the known testnet XLM and USDC contracts", () => {
    expect(tokenBySymbol("XLM")!.contract).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    expect(tokenBySymbol("USDC")!.contract).toBe("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
    expect(tokenBySymbol("USDC")!.asset.getIssuer()).toBe(TESTNET_USDC_ISSUER);
  });

  it("has unique symbols and contracts", () => {
    expect(new Set(TOKENS.map((t) => t.symbol)).size).toBe(TOKENS.length);
    expect(new Set(TOKENS.map((t) => t.contract)).size).toBe(TOKENS.length);
  });

  it("looks tokens up and builds Horizon balance keys", () => {
    const xlm = tokenBySymbol("XLM")!;
    expect(tokenByContract(xlm.contract)).toBe(xlm);
    expect(tokenByContract("CXXX")).toBeUndefined();
    expect(assetKey(Asset.native())).toBe("native");
    expect(assetKey(new Asset("USDC", TESTNET_USDC_ISSUER))).toBe(`USDC:${TESTNET_USDC_ISSUER}`);
  });
});
