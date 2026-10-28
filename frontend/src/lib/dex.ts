/** Classic Stellar transactions: DEX path payments and trustlines. */
import { Asset, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { NETWORK, TX_TIMEOUT_SECONDS } from "./config";
import { horizon } from "./horizon";
import { toHorizon } from "./amounts";
import { Token } from "./tokens";

async function builder(user: string) {
  const [account, baseFee] = await Promise.all([horizon().loadAccount(user), horizon().fetchBaseFee()]);
  // A little above the current base fee so the tx lands under light surge.
  const fee = String(Math.max(baseFee, 100) * 2);
  return new TransactionBuilder(account, { fee, networkPassphrase: NETWORK.passphrase });
}

/**
 * Sell exactly `amountIn` of `from` and receive at least `minOut` of `to`
 * through the Stellar DEX. The protocol itself enforces `minOut`.
 */
export async function buildPathPayment(
  user: string,
  from: Token,
  to: Token,
  amountIn: bigint,
  minOut: bigint,
  path: Asset[],
): Promise<Transaction> {
  return (await builder(user))
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: from.asset,
        sendAmount: toHorizon(amountIn),
        destination: user,
        destAsset: to.asset,
        destMin: toHorizon(minOut),
        path,
      }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Let the account hold `token` (required before receiving any classic asset). */
export async function buildTrustline(user: string, token: Token): Promise<Transaction> {
  if (token.asset.isNative()) throw new Error("XLM does not need a trustline");
  return (await builder(user))
    .addOperation(Operation.changeTrust({ asset: token.asset }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}
