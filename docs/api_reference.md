# AnchorSwap – API Reference

## Contract Functions

All functions are exposed via the `AnchorSwap` Soroban contract. Parameters are
passed as `ScVal` via the Stellar SDK. The JavaScript helpers in
`frontend/src/lib/soroban.ts` wrap these calls for frontend consumption.

---

### `initialize(admin: Address)`

One-time setup. Sets the contract administrator.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Stellar account that may later call `upgrade()` |

**Panics:** `"anchorswap: already initialized"` if called a second time.

---

### `init_pair(token_a: Address, token_b: Address)`

Register a new liquidity pair. Permissionless — anyone may call this.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token_a` | `Address` | First SEP-41 token contract address |
| `token_b` | `Address` | Second SEP-41 token contract address |

**Notes:**
- Addresses are canonically sorted (XDR byte order) before storage.
  Calling `init_pair(A, B)` and `init_pair(B, A)` refer to the same pair.
- Emits the `PairCrtd` event.

**Panics:**
- `"anchorswap: identical token addresses"` — if `token_a == token_b`
- `"anchorswap: pair already exists"` — if the canonical pair was already created

---

### `add_liquidity(token_a, token_b, amount_a_desired, amount_b_desired, min_share, provider) → (i128, i128, i128)`

Deposit tokens into a pool and receive LP shares.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token_a` | `Address` | First token address |
| `token_b` | `Address` | Second token address |
| `amount_a_desired` | `i128` | Amount of `token_a` caller wishes to deposit |
| `amount_b_desired` | `i128` | Amount of `token_b` caller wishes to deposit |
| `min_share` | `i128` | Minimum acceptable LP shares (slippage guard) |
| `provider` | `Address` | Account providing liquidity (must sign the transaction) |

**Returns:** `(shares_minted: i128, new_reserve_a: i128, new_reserve_b: i128)`

**Share minting formula:**

```
First deposit (total_shares == 0):
  shares = isqrt(amount_a × amount_b)

Subsequent deposits:
  shares = min(
    amount_a × total_shares / reserve_a,
    amount_b × total_shares / reserve_b
  )
```

**Panics:**
- `"anchorswap: amount_a must be > 0"` / `"anchorswap: amount_b must be > 0"`
- `"anchorswap: pair does not exist"` — call `init_pair` first
- `"anchorswap: insufficient shares minted"` — slippage check failed
- `"anchorswap: re-entrant call"` — should never happen in normal usage

**Emits:** `LiqAdded(token_a, token_b, amount_a, amount_b, shares, provider)`

---

### `remove_liquidity(token_a, token_b, share_amount, min_a, min_b, provider) → (i128, i128)`

Burn LP shares and withdraw proportional tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token_a` | `Address` | First token address |
| `token_b` | `Address` | Second token address |
| `share_amount` | `i128` | Number of LP shares to burn |
| `min_a` | `i128` | Minimum `token_a` to receive (slippage guard) |
| `min_b` | `i128` | Minimum `token_b` to receive (slippage guard) |
| `provider` | `Address` | LP account (must sign the transaction) |

**Returns:** `(amount_a_out: i128, amount_b_out: i128)` — amounts in the caller's
token order (same order as `token_a` / `token_b` parameters, not necessarily
canonical order).

**Withdrawal formula:**

```
amount_a = share_amount × reserve_a / total_shares
amount_b = share_amount × reserve_b / total_shares
```

**Panics:**
- `"anchorswap: share_amount must be > 0"`
- `"anchorswap: pair does not exist"`
- `"anchorswap: empty pool"` — total_shares is 0
- `"anchorswap: insufficient shares"` — provider owns fewer shares than requested
- `"anchorswap: amount_a below minimum"` / `"anchorswap: amount_b below minimum"`

**Emits:** `LiqRmvd(token_a, token_b, amount_a, amount_b, share_amount, provider)`

---

### `swap_exact_in(token_in, token_out, amount_in, min_out, user) → i128`

Swap an exact input amount for at least `min_out` of the output token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token_in` | `Address` | Token to sell |
| `token_out` | `Address` | Token to buy |
| `amount_in` | `i128` | Exact amount to sell (in raw i128 units, e.g. stroops) |
| `min_out` | `i128` | Minimum acceptable output (slippage guard) |
| `user` | `Address` | Trader's account (must sign the transaction) |

**Returns:** `amount_out: i128` — actual tokens received.

**Fee:** 0.3 % is retained in the pool (accrues to LPs).

**Constant-product formula (Uniswap v2):**

```
amount_in_with_fee = amount_in × 997
numerator          = amount_in_with_fee × reserve_out
denominator        = reserve_in × 1000 + amount_in_with_fee
amount_out         = numerator / denominator
```

**Panics:**
- `"anchorswap: amount_in must be > 0"`
- `"anchorswap: pair does not exist"`
- `"anchorswap: empty pool"`
- `"anchorswap: insufficient output amount"` — slippage check failed
- `"anchorswap: zero output amount"` — input too small relative to reserves

**Emits:** `Swapped(token_in, token_out, amount_in, amount_out, user)`

---

### `get_reserves(token_a: Address, token_b: Address) → (i128, i128)`

Read-only. Returns `(reserve_a, reserve_b)` in **canonical** order.

---

### `total_shares(token_a: Address, token_b: Address) → i128`

Read-only. Returns total LP-share supply for a pair.

---

### `get_share(token_a: Address, token_b: Address, user: Address) → i128`

Read-only. Returns `user`'s LP-share balance for a pair.

---

### `upgrade(new_wasm_hash: BytesN<32>)`

Replace the contract WASM. **Admin only** (requires admin auth).

---

## Custom Error Codes

| Code | Variant | Trigger condition |
|------|---------|------------------|
| 1 | `PairAlreadyExists` | `init_pair` called for an existing canonical pair |
| 2 | `PairNotFound` | State-mutating call for an uninitialised pair |
| 3 | `InvalidLiquidityAmount` | Zero or negative deposit amounts; zero initial shares |
| 4 | `SlippageExceeded` | Output or share below caller's minimum |
| 5 | `InsufficientLiquidity` | Pool empty or user over-withdrawing |
| 6 | `ReentrancyGuardTriggered` | Re-entrant call detected via `Locked` flag |
| 7 | `InvalidTokenOrder` | Identical token addresses passed to `init_pair` |
| 8 | `ZeroAmount` | Required numeric argument is zero |

> Note: The current implementation uses `assert!(…, "message")` panics rather
> than returning `Result<T, ContractError>`. The `ContractError` enum is defined
> in `error.rs` for future migration to typed returns and for use by tooling
> that reads contract ABI metadata.

---

## Contract Events

Events are published via `e.events().publish(topics, data)`.

| Event topic symbol | Data fields | Description |
|-------------------|-------------|-------------|
| `PairCrtd` | `(token_a: Address, token_b: Address)` | Emitted by `init_pair` |
| `LiqAdded` | `(token_a, token_b, amount_a, amount_b, shares, provider)` | Emitted by `add_liquidity` |
| `LiqRmvd` | `(token_a, token_b, amount_a, amount_b, shares, provider)` | Emitted by `remove_liquidity` |
| `Swapped` | `(token_in, token_out, amount_in, amount_out, user)` | Emitted by `swap_exact_in` |

---

## JavaScript SDK Helpers (`frontend/src/lib/soroban.ts`)

| Function | Description |
|----------|-------------|
| `getReserves(tokenA, tokenB)` | Simulate `get_reserves`; returns `{reserveA, reserveB}` |
| `getTotalShares(tokenA, tokenB)` | Simulate `total_shares` |
| `getUserShare(tokenA, tokenB, user)` | Simulate `get_share` |
| `computeSwapOut(amountIn, reserveIn, reserveOut)` | Local constant-product calculation |
| `buildSwapTx(user, tokenIn, tokenOut, amountIn, minOut)` | Returns prepared XDR string |
| `buildAddLiquidityTx(user, tokenA, tokenB, amountA, amountB, minShare)` | Returns prepared XDR string |
| `buildRemoveLiquidityTx(user, tokenA, tokenB, shareAmount, minA, minB)` | Returns prepared XDR string |
| `submitSignedTx(signedXdr)` | Submit to RPC; returns transaction hash |
| `formatAmount(raw, decimals)` | Convert raw i128 stroops → human-readable string |
| `parseAmount(value, decimals)` | Convert human-readable string → raw i128 bigint |
