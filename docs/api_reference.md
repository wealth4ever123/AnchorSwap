# API reference

## Contract: `anchorswap`

Amounts are `i128` in the token's smallest unit (stroops for Stellar
assets: 1 token = 10,000,000). `deadline` is a ledger timestamp in Unix
seconds. Tokens may be passed in either order; returned amounts follow the
order the caller used.

### Admin

| Function | Auth | Description |
|---|---|---|
| `__constructor(admin)` | none (runs once, during deploy) | Sets the admin. There is no separate `initialize`, so it cannot be front-run. |
| `create_pair(token_a, token_b) -> PairKey` | admin | Registers a pool. Fails for identical tokens, duplicates, non-token addresses, or more than 100 pools. |
| `set_paused(paused)` | admin | Pauses swaps and deposits. Withdrawals keep working. |
| `set_admin(new_admin)` | current **and** new admin | Transfers the admin role. |
| `upgrade(new_wasm_hash)` | admin | Replaces the contract code (the WASM must already be uploaded). |

### Liquidity

**`add_liquidity(provider, token_a, token_b, amount_a_desired, amount_b_desired, amount_a_min, amount_b_min, deadline) -> (amount_a, amount_b, shares)`**

Auth: `provider`. Takes at most the desired amounts, but only what matches
the current pool ratio. The leftover stays with the provider.

- First deposit: `shares = sqrt(a × b) − 1000`. The 1,000 shares are locked forever to block the first-depositor inflation attack; the deposit must give more than 1,000.
- Later deposits: `shares = min(a × total / reserve_a, b × total / reserve_b)`.

**`remove_liquidity(provider, token_a, token_b, shares, amount_a_min, amount_b_min, deadline) -> (amount_a, amount_b)`**

Auth: `provider`. Burns shares and returns `shares / total` of each reserve,
rounded down. Works while paused.

### Swap

**`swap_exact_in(user, token_in, token_out, amount_in, min_out, deadline) -> amount_out`**

Auth: `user`. `amount_out = amount_in × 9970 × r_out / (r_in × 10000 + amount_in × 9970)`,
rounded down. The 0.30% fee stays in the pool.

### Views (no auth, free to simulate)

| Function | Returns |
|---|---|
| `get_amount_out(token_in, token_out, amount_in)` | Exact output of a swap right now |
| `get_reserves(token_a, token_b)` | `(reserve_a, reserve_b)` in caller order |
| `get_pair(token_a, token_b)` | `PairState { reserve_a, reserve_b, total_shares }` in canonical order |
| `get_pairs()` | `Vec<PairKey>` of every pool |
| `get_shares(token_a, token_b, user)` | LP shares held by `user` |
| `admin()`, `is_paused()`, `fee_bps()` | Admin address, pause flag, `30` |

### Errors

| Code | Name | Meaning |
|---|---|---|
| 1 | `PairAlreadyExists` | Pool already registered |
| 2 | `PairNotFound` | No pool for these tokens |
| 3 | `IdenticalTokens` | Both tokens are the same |
| 4 | `InvalidAmount` | Zero or negative amount, or negative minimum |
| 5 | `SlippageExceeded` | Result is below the caller's minimum |
| 6 | `InsufficientLiquidity` | Empty pool, zero output, or first deposit too small |
| 7 | `InsufficientShares` | Withdrawing more shares than held |
| 8 | `DeadlineExpired` | `deadline` has passed |
| 9 | `Paused` | Swaps and deposits are paused |
| 10 | `Overflow` | Intermediate value exceeded i128 |
| 11 | `TooManyPairs` | Pool limit (100) reached |

Authorization failures are host errors, not contract errors: the
transaction fails before any state changes.

### Events

| Event (topic name) | Topics | Data |
|---|---|---|
| `pair_created` | `token_a`, `token_b` | none |
| `liquidity_added` | `provider` | `token_a, token_b, amount_a, amount_b, shares` (canonical order) |
| `liquidity_removed` | `provider` | same as above |
| `swap` | `user` | `token_in, token_out, amount_in, amount_out` |
| `paused_changed` | none | `paused` |
| `admin_changed` | none | `admin` |

### Calling it from the CLI

```bash
stellar contract invoke --id <CONTRACT> --source <KEY> --network testnet -- \
  get_amount_out --token_in <XLM_SAC> --token_out <ANC_SAC> --amount_in 10000000
```

## Frontend library (`frontend/src/lib`)

| Function | Module | Description |
|---|---|---|
| `getQuotes(from, to, amountIn)` | `quotes` | Quotes from every venue, sorted best first, plus per-venue errors |
| `ammQuote`, `getPool`, `listPools`, `getShares` | `amm` | Contract views via simulation |
| `buildAmmSwap`, `buildAddLiquidity`, `buildRemoveLiquidity` | `amm` | Simulated and assembled Soroban transactions, ready to sign |
| `buildPathPayment`, `buildTrustline` | `dex` | Classic transactions |
| `loadBalances`, `dexQuote` | `horizon` | Balances (with spendable XLM) and DEX path quotes |
| `assertSignedFor(xdr, address)` | `tx` | Verifies a wallet signature for this network and account |
| `submitAndWait(tx)` | `tx` | Sends and waits for `success` / `failed` / `pending` |
| `verifyOnHorizon(hash)` | `tx` | Independent confirmation |
| `parseAmount`, `formatAmount`, `minWithSlippage`, `priceImpactBps` | `amounts` | Exact bigint helpers |
