//! AnchorSwap – Ledger storage keys and typed access helpers.
//!
//! ## Storage tier decisions
//!
//! | Key                          | Tier       | Rationale                                                  |
//! |------------------------------|------------|------------------------------------------------------------|
//! | `Admin`                      | Instance   | Read on every admin-gated call; cheap to access.           |
//! | `Locked`                     | Instance   | Must be checked/cleared on every state-mutating call.      |
//! | `ReserveA` / `ReserveB`      | Instance   | Accessed on every swap and liquidity operation.            |
//! | `TotalShares`                | Instance   | Needed for every share calculation.                        |
//! | `ShareBalance(pair, user)`   | Persistent | Per-user data; accessed only when that user interacts.     |
//!
//! Instance storage has a fixed TTL tied to the contract instance itself, so
//! reserve and aggregate share data survives as long as the contract is live.
//! Per-user share balances use persistent storage with an explicit TTL bump
//! on every write so they outlive the default ledger window.

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, Env};

// ─── TTL constants ────────────────────────────────────────────────────────────

/// Minimum ledger-entry TTL for persistent user share balances.
/// ~1 year at 5-second ledger close time: 365 * 24 * 60 * 12 = 6_307_200.
pub const PERSISTENT_TTL_LEDGERS: u32 = 6_307_200;

/// Target TTL bump threshold – extend when remaining TTL falls below this.
pub const PERSISTENT_TTL_THRESHOLD: u32 = PERSISTENT_TTL_LEDGERS / 2;

// ─── Canonical pair identifier ────────────────────────────────────────────────

/// A sorted pair of token addresses used as a composite storage key.
///
/// Addresses are always stored in lexicographic order of their XDR encoding,
/// so `Pair(A, B)` and `Pair(B, A)` hash to the same key.
pub type PairKey = (Address, Address);

/// Return `(token_a, token_b)` in a stable canonical order by comparing the
/// XDR byte-level encoding of each address.
///
/// This guarantees that regardless of the order in which the caller supplies
/// the tokens, the same pair always maps to the same storage slot.
pub fn canonical_pair(e: &Env, a: Address, b: Address) -> PairKey {
    let bytes_a: Bytes = a.clone().to_xdr(e);
    let bytes_b: Bytes = b.clone().to_xdr(e);
    if bytes_a <= bytes_b {
        (a, b)
    } else {
        (b, a)
    }
}

// ─── Storage key enum ─────────────────────────────────────────────────────────

/// Every key written to ledger storage by AnchorSwap.
///
/// The `#[contracttype]` attribute causes the Soroban SDK to derive an XDR
/// schema for this enum so that keys are deterministically serialised.
#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    /// The contract administrator address (may call `upgrade`).
    Admin,

    /// Global re-entrancy lock flag.  `true` while any guarded function is
    /// executing; panics if a second entry is attempted.
    Locked,

    /// Reserve of the *first* (canonical-order) token for a pair.
    ReserveA(PairKey),

    /// Reserve of the *second* (canonical-order) token for a pair.
    ReserveB(PairKey),

    /// Total LP-share supply for a pair.  Also serves as the existence flag:
    /// `has(TotalShares(pair))` is `true` iff the pair was initialised.
    TotalShares(PairKey),

    /// LP-share balance of an individual liquidity provider for a specific pair.
    ShareBalance(PairKey, Address),
}

// ─── Instance storage helpers (reserve & aggregate data) ─────────────────────

/// Read reserve A for a pair; returns `0` if not set (new pair).
pub fn get_reserve_a(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::ReserveA(key.clone()))
        .unwrap_or(0_i128)
}

/// Read reserve B for a pair; returns `0` if not set.
pub fn get_reserve_b(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::ReserveB(key.clone()))
        .unwrap_or(0_i128)
}

/// Write reserve A for a pair.
pub fn set_reserve_a(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::ReserveA(key.clone()), &val);
}

/// Write reserve B for a pair.
pub fn set_reserve_b(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::ReserveB(key.clone()), &val);
}

/// Read total LP-share supply for a pair; returns `0` if not initialised.
pub fn get_total_shares(e: &Env, key: &PairKey) -> i128 {
    e.storage()
        .instance()
        .get(&StorageKey::TotalShares(key.clone()))
        .unwrap_or(0_i128)
}

/// Write total LP-share supply for a pair.
pub fn set_total_shares(e: &Env, key: &PairKey, val: i128) {
    e.storage()
        .instance()
        .set(&StorageKey::TotalShares(key.clone()), &val);
}

/// Return `true` if the pair has been initialised (i.e. `TotalShares` key
/// exists in instance storage).
pub fn pair_exists(e: &Env, key: &PairKey) -> bool {
    e.storage()
        .instance()
        .has(&StorageKey::TotalShares(key.clone()))
}

// ─── Persistent storage helpers (per-user data) ──────────────────────────────

/// Read the LP-share balance of `user` in a pair; returns `0` if absent.
///
/// Also bumps the TTL of the entry if it is below the threshold, ensuring
/// user balances are retained for at least [`PERSISTENT_TTL_THRESHOLD`] more
/// ledgers.
pub fn get_share_balance(e: &Env, key: &PairKey, user: &Address) -> i128 {
    let storage_key = StorageKey::ShareBalance(key.clone(), user.clone());
    let val: i128 = e
        .storage()
        .persistent()
        .get(&storage_key)
        .unwrap_or(0_i128);
    // Bump TTL so long-lived positions are not evicted.
    if val > 0 {
        e.storage().persistent().extend_ttl(
            &storage_key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_LEDGERS,
        );
    }
    val
}

/// Write the LP-share balance of `user` in a pair and reset its TTL.
pub fn set_share_balance(e: &Env, key: &PairKey, user: &Address, val: i128) {
    let storage_key = StorageKey::ShareBalance(key.clone(), user.clone());
    e.storage().persistent().set(&storage_key, &val);
    e.storage().persistent().extend_ttl(
        &storage_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_LEDGERS,
    );
}

// ─── Re-entrancy guard helpers ────────────────────────────────────────────────

/// Panic if the contract is already executing a guarded function.
pub fn require_not_locked(e: &Env) {
    if e.storage()
        .instance()
        .get::<StorageKey, bool>(&StorageKey::Locked)
        .unwrap_or(false)
    {
        panic!("anchorswap: re-entrant call");
    }
}

/// Acquire the re-entrancy lock.
pub fn lock(e: &Env) {
    e.storage().instance().set(&StorageKey::Locked, &true);
}

/// Release the re-entrancy lock.
pub fn unlock(e: &Env) {
    e.storage().instance().set(&StorageKey::Locked, &false);
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

/// Require that the transaction was authorised by the stored admin address.
pub fn require_admin(e: &Env) {
    let admin: Address = e
        .storage()
        .instance()
        .get(&StorageKey::Admin)
        .expect("anchorswap: not initialized");
    admin.require_auth();
}
