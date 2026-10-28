# Design decisions

Each entry records what was chosen, why, and what it costs.

## Contract

**One contract, many pools.** One deployment serves every pair, so there is
no factory and only one contract ID for the UI to trust. The cost is that a
bug affects all pools at once. Per-pool accounting keeps one pool's tokens
from paying out another's.

**Admin-created pools.** Anyone creating pools would mean anyone could pair
a malicious token contract with XLM and have it appear in the app.
`create_pair` also calls `decimals()` on both tokens, so a typo or a
non-token address fails. The cost is that listing a pool needs the admin.

**Constructor instead of `initialize`.** Soroban constructors run inside the
deploy transaction, so nobody can initialise the contract first and become
admin.

**Minimum outputs and deadlines on every write.** `min_out` /
`amount_*_min` stop sandwich attacks and price drift; `deadline` stops a
transaction that sat in a wallet from executing much later. Both are
checked on-chain, not just in the UI.

**Locked minimum liquidity (1,000 shares).** Without it, the first
depositor could make a share so expensive that later deposits round down to
zero shares (the "inflation attack").

**Deposits follow the pool ratio.** The original code took both full
amounts and minted shares on the smaller side, silently donating the excess
to the pool. Now only the matching amount is taken, as in Uniswap v2's
router.

**Rounding always favours the pool.** Swap outputs, withdrawals and minted
shares round down. That keeps `reserve_a × reserve_b` from decreasing,
which a randomized test checks.

**Typed errors instead of panics.** Clients get a stable error code to show
a clear message, rather than a generic trap.

**Withdrawals ignore pause.** A pause is meant for incidents. Locking users'
funds during one would make the admin a custodian.

**No re-entrancy lock.** The Soroban host refuses to re-enter a contract
already on the call stack, so the old lock was dead code that cost two
storage writes per call. Reserves are also updated before outgoing
transfers.

**Persistent storage for pools.** Keeping every pool in instance storage
(the original design) loads every pool on every call and grows without
limit. Each pool is now its own persistent entry, and the pool list is
capped at 100.

**Stellar Asset Contracts in tests.** Tests use the real token
implementation that XLM and classic assets use on-chain, instead of a
hand-written mock token.

## Frontend

**Two venues, best price.** AnchorSwap pools only cover pairs someone has
seeded. Adding the Stellar DEX gives users real liquidity for pairs like
XLM/USDC and an honest benchmark for the AMM's price.

**Quotes come from the chain.** The AnchorSwap quote is a simulation of the
contract's own `get_amount_out`, and the DEX quote is Horizon's path
finder, so the UI cannot drift from what actually executes. Local math
(`amountOut` in `amm.ts`) mirrors the contract and is only tested against
it, never used for a quote.

**Simulate, then sign.** Soroban transactions are simulated with the user's
exact minimum before the wallet opens. A trade that would fail never asks
for a signature.

**Signature check against the network.** Wallets may report their network
wrongly, late, or not at all. Checking the returned signature against the
Testnet network hash detects a wallet set to another network in every case,
before anything is sent.

**Success only from the ledger.** Sending a transaction is not success.
The UI waits for RPC's final status and never turns a timeout into success.
Pending items are re-checked against Horizon, which is a separate service.

**Fixed token list, IDs derived at startup.** Contract IDs in the config
are compared with IDs computed from the asset code and issuer; any mismatch
stops the app. This stops look-alike or mistyped tokens.

**Exact amounts.** All amounts are `bigint` in stroops. Input is parsed with
a strict pattern (no floats, no scientific notation, at most 7 decimals).

**Slippage cap of 5%.** Higher tolerances mostly help attackers. Users who
need more can split the trade.

**Wallet behind an interface.** `WalletAdapter` lets tests run the whole
swap flow with an in-memory wallet. The real app uses Stellar Wallets Kit
with the extension and web wallets that need no extra setup.

**No backend.** Everything talks to public Stellar endpoints, so there is
no server to secure. The cost is that history is per browser; Stellar
Expert provides the full account history.
