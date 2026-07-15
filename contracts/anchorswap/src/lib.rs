//! AnchorSwap – Constant-Product AMM on Stellar / Soroban
//!
//! ## Design summary
//! * Pairs are identified by a *canonical key*: `(min_addr, max_addr)` where
//!   the order is determined by XDR byte-encoding of each `Address`.
//! * Shares represent proportional ownership of a pool's reserves.
//! * A 0.3 % swap fee accrues in the pool, benefiting all LPs.
//! * A simple boolean re-entrancy guard prevents re-entrant calls on all
//!   state-mutating entry points.
//! * All arithmetic is checked; overflows cause an explicit panic message.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, xdr::ToXdr, Address, Bytes,
    BytesN, Env,
};

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/// Canonical pair identifier. Both addresses are stored in lexicographic
/// order of their XDR encoding so that `(A, B)` and `(B, A)` map to the
/// same key.
pub type PairKey = (Address, Address);

/// All persistent/instance storage keys used by the contract.
#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    /// The contract administrator – may call `upgrade`.
    Admin,
    /// Global re-entrancy lock.
    Locked,
    /// Reserve of the *first* token in the canonical pair.
    ReserveA(PairKey),
    /// Reserve of the *second* token in the canonical pair.
    ReserveB(PairKey),
    /// Total LP-share supply for a pair.
    TotalShares(PairKey),
    /// LP-share balance of an individual provider for a pair.
    ShareBalance(PairKey, Address),
}

// ──────────────────────────────────────────────────────────────────────────────
// Math helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Integer square-root via Newton's method (floor).
///
/// Returns `0` for `n <= 0`.
pub fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

// ──────────────────────────────────────────────────────────────────────────────
// Canonical pair ordering
// ──────────────────────────────────────────────────────────────────────────────

/// Return addresses in a stable canonical order by comparing their XDR
/// byte-level encoding. This guarantees that regardless of the call order,
/// the storage key is always the same.
fn canonical_pair(e: &Env, a: Address, b: Address) -> PairKey {
    let bytes_a: Bytes = a.clone().to_xdr(e);
    let bytes_b: Bytes = b.clone().to_xdr(e);
    if bytes_a <= bytes_b {
        (a, b)
    } else {
        (b, a)
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ──────────────────────────────────────────────────────────────────────────────

fn get_reserve_a(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::ReserveA(key.clone()))
        .unwrap_or(0_i128)
}

fn get_reserve_b(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::ReserveB(key.clone()))
        .unwrap_or(0_i128)
}

fn set_reserve_a(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::ReserveA(key.clone()), &val);
}

fn set_reserve_b(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::ReserveB(key.clone()), &val);
}

fn get_total_shares(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::TotalShares(key.clone()))
        .unwrap_or(0_i128)
}

fn set_total_shares(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::TotalShares(key.clone()), &val);
}

fn get_share_balance(e: &Env, key: &PairKey, user: &Address) -> i128 {
    e.storage()
        .persistent()
        .get(&StorageKey::ShareBalance(key.clone(), user.clone()))
        .unwrap_or(0_i128)
}

fn set_share_balance(e: &Env, key: &PairKey, user: &Address, val: i128) {
    e.storage()
        .persistent()
        .set(&StorageKey::ShareBalance(key.clone(), user.clone()), &val);
}

fn pair_exists(e: &Env, key: &PairKey) -> bool {
    // A pair is considered initialised once TotalShares key is present
    // (set to 0 on init_pair).
    e.storage()
        .instance()
        .has(&StorageKey::TotalShares(key.clone()))
}

fn require_not_locked(e: &Env) {
    if e.storage()
        .instance()
        .get::<StorageKey, bool>(&StorageKey::Locked)
        .unwrap_or(false)
    {
        panic!("anchorswap: re-entrant call");
    }
}

fn lock(e: &Env) {
    e.storage().instance().set(&StorageKey::Locked, &true);
}

fn unlock(e: &Env) {
    e.storage().instance().set(&StorageKey::Locked, &false);
}

fn require_admin(e: &Env) {
    let admin: Address = e
        .storage()
        .instance()
        .get(&StorageKey::Admin)
        .expect("anchorswap: not initialized");
    admin.require_auth();
}

// ──────────────────────────────────────────────────────────────────────────────
// Contract
// ──────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct AnchorSwap;

#[contractimpl]
impl AnchorSwap {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time contract initialization. Sets the admin address.
    pub fn initialize(e: Env, admin: Address) {
        if e.storage().instance().has(&StorageKey::Admin) {
            panic!("anchorswap: already initialized");
        }
        e.storage().instance().set(&StorageKey::Admin, &admin);
    }

    // ── Pair creation ─────────────────────────────────────────────────────────

    /// Create a new liquidity pair for `token_a` / `token_b`.
    ///
    /// The addresses are reordered into canonical form internally; calling
    /// with `(A, B)` or `(B, A)` both refer to the same pair.
    /// Panics if the pair already exists.
    pub fn init_pair(e: Env, token_a: Address, token_b: Address) {
        assert!(
            token_a != token_b,
            "anchorswap: identical token addresses"
        );
        let key = canonical_pair(&e, token_a.clone(), token_b.clone());
        assert!(!pair_exists(&e, &key), "anchorswap: pair already exists");

        // Mark pair as existing by writing TotalShares = 0.
        set_total_shares(&e, &key, 0);
        set_reserve_a(&e, &key, 0);
        set_reserve_b(&e, &key, 0);

        e.events().publish(
            (symbol_short!("PairCrtd"),),
            (key.0.clone(), key.1.clone()),
        );
    }

    // ── Add liquidity ─────────────────────────────────────────────────────────

    /// Deposit tokens into a pool and receive LP shares.
    ///
    /// First deposit: shares = isqrt(amount_a * amount_b).
    /// Subsequent deposits: shares = min(amount_a * total / ra, amount_b * total / rb).
    ///
    /// Returns `(shares_minted, actual_amount_a, actual_amount_b)`.
    pub fn add_liquidity(
        e: Env,
        token_a: Address,
        token_b: Address,
        amount_a_desired: i128,
        amount_b_desired: i128,
        min_share: i128,
        provider: Address,
    ) -> (i128, i128, i128) {
        provider.require_auth();
        require_not_locked(&e);
        lock(&e);

        assert!(amount_a_desired > 0, "anchorswap: amount_a must be > 0");
        assert!(amount_b_desired > 0, "anchorswap: amount_b must be > 0");

        let key = canonical_pair(&e, token_a.clone(), token_b.clone());
        assert!(pair_exists(&e, &key), "anchorswap: pair does not exist");

        let ra = get_reserve_a(&e, &key);
        let rb = get_reserve_b(&e, &key);
        let total = get_total_shares(&e, &key);

        // Map caller-supplied amounts to canonical (a, b) order.
        let bytes_a: Bytes = token_a.clone().to_xdr(&e);
        let bytes_b: Bytes = token_b.clone().to_xdr(&e);
        let (amount_a, amount_b) = if bytes_a <= bytes_b {
            (amount_a_desired, amount_b_desired)
        } else {
            (amount_b_desired, amount_a_desired)
        };

        // Calculate shares.
        let shares = if total == 0 {
            // First LP: geometric mean
            let product = amount_a
                .checked_mul(amount_b)
                .expect("anchorswap: overflow computing initial shares");
            let s = isqrt(product);
            assert!(s > 0, "anchorswap: initial share amount is zero");
            s
        } else {
            // Proportional to existing reserves
            let s_a = amount_a
                .checked_mul(total)
                .expect("anchorswap: overflow s_a numerator")
                / ra;
            let s_b = amount_b
                .checked_mul(total)
                .expect("anchorswap: overflow s_b numerator")
                / rb;
            s_a.min(s_b)
        };

        assert!(shares >= min_share, "anchorswap: insufficient shares minted");

        // Transfer tokens from provider to contract.
        let contract_addr = e.current_contract_address();
        token::Client::new(&e, &key.0).transfer(&provider, &contract_addr, &amount_a);
        token::Client::new(&e, &key.1).transfer(&provider, &contract_addr, &amount_b);

        // Update reserves and share balances.
        let new_ra = ra
            .checked_add(amount_a)
            .expect("anchorswap: reserve_a overflow");
        let new_rb = rb
            .checked_add(amount_b)
            .expect("anchorswap: reserve_b overflow");
        set_reserve_a(&e, &key, new_ra);
        set_reserve_b(&e, &key, new_rb);

        let new_total = total
            .checked_add(shares)
            .expect("anchorswap: total shares overflow");
        set_total_shares(&e, &key, new_total);

        let prev_share = get_share_balance(&e, &key, &provider);
        let new_share = prev_share
            .checked_add(shares)
            .expect("anchorswap: share balance overflow");
        set_share_balance(&e, &key, &provider, new_share);

        e.events().publish(
            (symbol_short!("LiqAdded"),),
            (
                key.0.clone(),
                key.1.clone(),
                amount_a,
                amount_b,
                shares,
                provider.clone(),
            ),
        );

        unlock(&e);
        (shares, new_ra, new_rb)
    }

    // ── Remove liquidity ──────────────────────────────────────────────────────

    /// Burn LP shares and withdraw proportional tokens from the pool.
    ///
    /// Returns `(amount_a_out, amount_b_out)` in canonical token order.
    pub fn remove_liquidity(
        e: Env,
        token_a: Address,
        token_b: Address,
        share_amount: i128,
        min_a: i128,
        min_b: i128,
        provider: Address,
    ) -> (i128, i128) {
        provider.require_auth();
        require_not_locked(&e);
        lock(&e);

        assert!(share_amount > 0, "anchorswap: share_amount must be > 0");

        let key = canonical_pair(&e, token_a.clone(), token_b.clone());
        assert!(pair_exists(&e, &key), "anchorswap: pair does not exist");

        let ra = get_reserve_a(&e, &key);
        let rb = get_reserve_b(&e, &key);
        let total = get_total_shares(&e, &key);

        assert!(total > 0, "anchorswap: empty pool");

        let user_shares = get_share_balance(&e, &key, &provider);
        assert!(user_shares >= share_amount, "anchorswap: insufficient shares");

        // Proportional withdrawal.
        let amount_a = share_amount
            .checked_mul(ra)
            .expect("anchorswap: overflow amount_a")
            / total;
        let amount_b = share_amount
            .checked_mul(rb)
            .expect("anchorswap: overflow amount_b")
            / total;

        // Map canonical amounts back to caller-supplied token order.
        let bytes_a: Bytes = token_a.clone().to_xdr(&e);
        let bytes_b: Bytes = token_b.clone().to_xdr(&e);
        let (out_a_for_caller, out_b_for_caller) = if bytes_a <= bytes_b {
            (amount_a, amount_b)
        } else {
            (amount_b, amount_a)
        };

        assert!(
            out_a_for_caller >= min_a,
            "anchorswap: amount_a below minimum"
        );
        assert!(
            out_b_for_caller >= min_b,
            "anchorswap: amount_b below minimum"
        );

        // Burn shares.
        let new_user_shares = user_shares
            .checked_sub(share_amount)
            .expect("anchorswap: share underflow");
        set_share_balance(&e, &key, &provider, new_user_shares);

        let new_total = total
            .checked_sub(share_amount)
            .expect("anchorswap: total shares underflow");
        set_total_shares(&e, &key, new_total);

        // Update reserves.
        let new_ra = ra
            .checked_sub(amount_a)
            .expect("anchorswap: reserve_a underflow");
        let new_rb = rb
            .checked_sub(amount_b)
            .expect("anchorswap: reserve_b underflow");
        set_reserve_a(&e, &key, new_ra);
        set_reserve_b(&e, &key, new_rb);

        // Transfer tokens back to the provider.
        let contract_addr = e.current_contract_address();
        token::Client::new(&e, &key.0).transfer(&contract_addr, &provider, &amount_a);
        token::Client::new(&e, &key.1).transfer(&contract_addr, &provider, &amount_b);

        e.events().publish(
            (symbol_short!("LiqRmvd"),),
            (
                key.0.clone(),
                key.1.clone(),
                amount_a,
                amount_b,
                share_amount,
                provider.clone(),
            ),
        );

        unlock(&e);
        (out_a_for_caller, out_b_for_caller)
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// Swap an exact amount of `token_in` for at least `min_out` of `token_out`.
    ///
    /// Fee: 0.3 % retained in the pool (standard Uniswap v2 formula).
    ///
    /// Returns the actual amount of `token_out` received.
    pub fn swap_exact_in(
        e: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_out: i128,
        user: Address,
    ) -> i128 {
        user.require_auth();
        require_not_locked(&e);
        lock(&e);

        assert!(amount_in > 0, "anchorswap: amount_in must be > 0");

        let key = canonical_pair(&e, token_in.clone(), token_out.clone());
        assert!(pair_exists(&e, &key), "anchorswap: pair does not exist");

        // Determine which canonical slot is `in` and which is `out`.
        let bytes_in: Bytes = token_in.clone().to_xdr(&e);
        let bytes_key0: Bytes = key.0.clone().to_xdr(&e);
        let (reserve_in, reserve_out, in_is_a) = if bytes_in == bytes_key0 {
            (get_reserve_a(&e, &key), get_reserve_b(&e, &key), true)
        } else {
            (get_reserve_b(&e, &key), get_reserve_a(&e, &key), false)
        };

        assert!(reserve_in > 0 && reserve_out > 0, "anchorswap: empty pool");

        // Uniswap v2 formula with 0.3 % fee.
        let amount_in_with_fee = amount_in
            .checked_mul(997)
            .expect("anchorswap: overflow amount_in_with_fee");
        let numerator = amount_in_with_fee
            .checked_mul(reserve_out)
            .expect("anchorswap: overflow numerator");
        let denominator = reserve_in
            .checked_mul(1000)
            .expect("anchorswap: overflow denominator base")
            .checked_add(amount_in_with_fee)
            .expect("anchorswap: overflow denominator");
        let amount_out = numerator / denominator;

        assert!(amount_out >= min_out, "anchorswap: insufficient output amount");
        assert!(amount_out > 0, "anchorswap: zero output amount");

        // Transfer token_in from user to contract.
        let contract_addr = e.current_contract_address();
        token::Client::new(&e, &token_in).transfer(&user, &contract_addr, &amount_in);

        // Transfer token_out from contract to user.
        token::Client::new(&e, &token_out).transfer(&contract_addr, &user, &amount_out);

        // Update reserves.
        let (new_ra, new_rb) = if in_is_a {
            (
                reserve_in
                    .checked_add(amount_in)
                    .expect("anchorswap: reserve_in overflow"),
                reserve_out
                    .checked_sub(amount_out)
                    .expect("anchorswap: reserve_out underflow"),
            )
        } else {
            (
                reserve_out
                    .checked_sub(amount_out)
                    .expect("anchorswap: reserve_out underflow"),
                reserve_in
                    .checked_add(amount_in)
                    .expect("anchorswap: reserve_in overflow"),
            )
        };
        set_reserve_a(&e, &key, new_ra);
        set_reserve_b(&e, &key, new_rb);

        e.events().publish(
            (symbol_short!("Swapped"),),
            (
                token_in.clone(),
                token_out.clone(),
                amount_in,
                amount_out,
                user.clone(),
            ),
        );

        unlock(&e);
        amount_out
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    /// Return `(reserve_a, reserve_b)` in canonical order for the pair.
    pub fn get_reserves(e: Env, token_a: Address, token_b: Address) -> (i128, i128) {
        let key = canonical_pair(&e, token_a, token_b);
        (get_reserve_a(&e, &key), get_reserve_b(&e, &key))
    }

    /// Return the total LP-share supply for a pair.
    pub fn total_shares(e: Env, token_a: Address, token_b: Address) -> i128 {
        let key = canonical_pair(&e, token_a, token_b);
        get_total_shares(&e, &key)
    }

    /// Return the LP-share balance of `user` for a pair.
    pub fn get_share(e: Env, token_a: Address, token_b: Address, user: Address) -> i128 {
        let key = canonical_pair(&e, token_a, token_b);
        get_share_balance(&e, &key, &user)
    }

    // ── Admin – upgrade ───────────────────────────────────────────────────────

    /// Replace the contract WASM. Admin only.
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        require_admin(&e);
        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ── Module declarations ───────────────────────────────────────────────────────
/// Typed contract error codes (see `error.rs`).
pub mod error;
/// Ledger storage keys and typed helpers (see `storage.rs`).
pub mod storage;

#[cfg(test)]
mod tests;
