# AnchorSwap – Design Decisions

This document explains the key choices made in AnchorSwap's architecture,
mathematics, and storage model. Every decision is justified with the
tradeoffs considered.

---

## 1. Constant-Product AMM formula (x·y = k)

**Choice:** Uniswap v2-style constant-product formula.

**Formula:**

```
reserve_in × reserve_out = k   (constant product invariant)

Swap output (with 0.3 % fee):

  amount_in_with_fee = amount_in × 997
  numerator          = amount_in_with_fee × reserve_out
  denominator        = reserve_in × 1000 + amount_in_with_fee
  amount_out         = floor(numerator / denominator)
```

**Why integer arithmetic:**
Soroban does not have native floating-point. All amounts use `i128` (128-bit
signed integers) denominated in the token's smallest unit (stroops, 10⁻⁷ for
most Stellar assets). The factor-of-1000 fee encoding avoids floating-point
entirely while keeping the fee at exactly 0.3 % (997/1000).

**Why the fee is left in the pool:**
Retaining the fee in reserves (rather than minting fee tokens) is the
simplest mechanism that automatically compounds LP returns. Every swap
increases `k`, so LP shares become worth more over time without any
additional bookkeeping.

**Why not StableSwap (Curve-style):**
StableSwap is more capital-efficient for correlated assets but requires a
more complex invariant (`A·n^n·Σx + D = A·D·n^n + D^(n+1)/(n^n·Πx)`) and
an iterative Newton's-method solver. The added complexity increases attack
surface for a v1 protocol. Constant-product is well-understood, battle-tested,
and provides a clean baseline.

---

## 2. Canonical token address sorting

**Choice:** Sort token addresses by XDR byte-order comparison.

```rust
fn canonical_pair(e: &Env, a: Address, b: Address) -> PairKey {
    let bytes_a: Bytes = a.clone().to_xdr(e);
    let bytes_b: Bytes = b.clone().to_xdr(e);
    if bytes_a <= bytes_b { (a, b) } else { (b, a) }
}
```

**Why XDR encoding:**
Soroban `Address` is not directly comparable with `<` / `>` operators in a
Rust `no_std` context. XDR serialisation produces a deterministic byte
representation for every address type (account IDs and contract IDs), making
lexicographic comparison stable across all address variants.

**Why not hash-based sorting:**
A hash (e.g. SHA-256 of the address) would also be deterministic, but it
adds an extra computation step and is harder to reason about when auditing.
XDR byte comparison is transparent and matches the ordering used elsewhere
in the Stellar protocol.

**Benefit:**
Regardless of the order in which a caller passes `(A, B)` or `(B, A)`, the
canonical form is always `(min, max)`. This means:
- Only one storage slot per pair.
- No duplicate pair attacks (registering `(A, B)` and `(B, A)` as two
  different pools).
- Frontend can query reserves with either token order.

---

## 3. LP share minting

**First deposit — geometric mean:**

```
shares = isqrt(amount_a × amount_b)
```

Using the geometric mean as the initial share value:

- Is independent of the initial price ratio chosen by the first LP.
- Anchors the share unit to a value that grows as `sqrt(k)`, making share
  arithmetic consistent across pools with very different reserve sizes.
- Matches the Uniswap v2 design, which has been battle-tested in production.

`isqrt` is implemented via Newton's method (converges in O(log n) iterations):

```rust
pub fn isqrt(n: i128) -> i128 {
    if n <= 0 { return 0; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x { x = y; y = (x + n / x) / 2; }
    x
}
```

**Subsequent deposits — proportional minimum:**

```
shares = min(
  amount_a × total_shares / reserve_a,
  amount_b × total_shares / reserve_b
)
```

Taking the minimum disincentivises LPs from providing a skewed ratio: only
the proportional amount of the "bottleneck" token earns shares. Any excess
of the other token remains in the caller's wallet (not deposited). A stricter
implementation would refund the excess; the current version relies on callers
computing the correct ratio off-chain (matching the existing pool price).

---

## 4. Storage tier allocation

| Key | Tier | Justification |
|-----|------|---------------|
| `Admin`, `Locked` | Instance | Accessed on every guarded call. Instance storage is cheapest per-read and is always available while the contract is live. |
| `ReserveA`, `ReserveB`, `TotalShares` | Instance | Accessed on every swap and liquidity operation. Instance storage avoids per-read TTL checks. |
| `ShareBalance(pair, user)` | Persistent | Per-user data. Only accessed when that specific user interacts. Persistent storage supports explicit TTL management so balances are retained for ~1 year regardless of contract activity. |

**TTL constants:**

```rust
pub const PERSISTENT_TTL_LEDGERS: u32 = 6_307_200;   // ≈ 1 year
pub const PERSISTENT_TTL_THRESHOLD: u32 = 3_153_600; // bump when < 6 months left
```

At a 5-second Stellar ledger close time: 365 days × 24 h × 60 min × 12 ledgers/min = 6,307,200 ledgers.

The threshold-based bump strategy (extend only when the TTL falls below half)
avoids an expensive storage update on every read while still ensuring
long-lived positions are never evicted.

---

## 5. Re-entrancy guard

**Choice:** Simple boolean lock in instance storage.

```rust
fn require_not_locked(e: &Env) {
    if e.storage().instance().get::<StorageKey, bool>(&StorageKey::Locked)
        .unwrap_or(false) {
        panic!("anchorswap: re-entrant call");
    }
}
```

**Why a storage-based lock instead of a Rust `Mutex`:**
Soroban contracts are `no_std` and run in a sandboxed WASM environment.
Cross-contract calls can re-enter the same contract if an intermediate token
contract calls back into AnchorSwap. A storage flag survives across
cross-contract call boundaries; a Rust-level mutex does not.

**Why instance storage:**
Instance storage reads have no TTL overhead and are the fastest available
storage tier. Since the lock is set and cleared within a single transaction,
there is no risk of it persisting across ledgers.

---

## 6. Admin and upgradeability

**Choice:** A single admin key stored in instance storage, required only for
`upgrade()`.

All other operations — pair creation, swaps, liquidity — are fully
permissionless. The admin key is kept minimal to reduce governance risk.

In a future version, the admin role could be replaced with a multi-sig or a
DAO governance contract. The `upgrade()` function accepts a `BytesN<32>` WASM
hash, following Soroban's recommended upgrade pattern via
`e.deployer().update_current_contract_wasm(hash)`.

---

## 7. Event naming

Soroban `symbol_short!` macros are limited to 9 ASCII characters. AnchorSwap
uses the shortest unambiguous names:

| Symbol | Meaning |
|--------|---------|
| `PairCrtd` | Pair created |
| `LiqAdded` | Liquidity added |
| `LiqRmvd` | Liquidity removed |
| `Swapped` | Swap executed |

---

## 8. Why Soroban instead of Stellar CLOB

Stellar's native DEX uses a Central Limit Order Book (CLOB). AnchorSwap
uses an AMM for the following reasons:

- **Passive liquidity:** LPs do not need to manage orders; liquidity is
  always available at any price within the curve.
- **Composability:** Any Soroban contract can call `swap_exact_in` in a
  single transaction without managing order IDs.
- **Predictable fees:** The 0.3 % fee is hard-coded in the formula; there
  is no bid-ask spread that varies with order book depth.
- **On-chain guarantees:** The constant-product invariant is enforced by the
  contract, not off-chain market makers.
