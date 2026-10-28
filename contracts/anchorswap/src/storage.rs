//! Ledger storage layout and TTL handling.
//!
//! | Key                    | Tier       | Why                                            |
//! |------------------------|------------|------------------------------------------------|
//! | `Admin`, `Paused`      | Instance   | Tiny, read on most calls                       |
//! | `Pairs`                | Persistent | List of pairs for the UI, capped at MAX_PAIRS  |
//! | `Pair(key)`            | Persistent | Reserves + share supply of one pair            |
//! | `Shares(key, user)`    | Persistent | One LP position                                |
//!
//! Per-pair data is persistent (not instance) so that adding pairs does not
//! make every call load a bigger instance entry. Every entry we touch has its
//! TTL extended, so active pools and positions do not get archived.

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Env, Vec};

const DAY_IN_LEDGERS: u32 = 17_280; // ~5 s ledgers
pub const INSTANCE_TTL: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL: u32 = 60 * DAY_IN_LEDGERS;
const THRESHOLD_GAP: u32 = 7 * DAY_IN_LEDGERS;

/// Upper bound on registered pairs so `get_pairs` stays cheap to read.
pub const MAX_PAIRS: u32 = 100;

/// Two token addresses in canonical order (sorted by XDR bytes), so
/// `(A, B)` and `(B, A)` resolve to the same pool.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairKey {
    pub token_a: Address,
    pub token_b: Address,
}

/// State of one pool. `reserve_a` belongs to `PairKey::token_a`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairState {
    pub reserve_a: i128,
    pub reserve_b: i128,
    pub total_shares: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    Pairs,
    Pair(PairKey),
    Shares(PairKey, Address),
}

/// Returns the canonical key and whether the inputs were already in order.
pub fn canonical(e: &Env, x: &Address, y: &Address) -> (PairKey, bool) {
    if x.clone().to_xdr(e) <= y.clone().to_xdr(e) {
        (
            PairKey {
                token_a: x.clone(),
                token_b: y.clone(),
            },
            true,
        )
    } else {
        (
            PairKey {
                token_a: y.clone(),
                token_b: x.clone(),
            },
            false,
        )
    }
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL - THRESHOLD_GAP, INSTANCE_TTL);
}

fn bump_persistent(e: &Env, key: &DataKey) {
    e.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL - THRESHOLD_GAP, PERSISTENT_TTL);
}

pub fn get_admin(e: &Env) -> Address {
    // Set in the constructor, so it always exists.
    e.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn is_paused(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(e: &Env, paused: bool) {
    e.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn get_pairs(e: &Env) -> Vec<PairKey> {
    let key = DataKey::Pairs;
    match e.storage().persistent().get(&key) {
        Some(v) => {
            bump_persistent(e, &key);
            v
        }
        None => Vec::new(e),
    }
}

pub fn set_pairs(e: &Env, pairs: &Vec<PairKey>) {
    let key = DataKey::Pairs;
    e.storage().persistent().set(&key, pairs);
    bump_persistent(e, &key);
}

pub fn get_pair(e: &Env, pair: &PairKey) -> Option<PairState> {
    let key = DataKey::Pair(pair.clone());
    let state = e.storage().persistent().get(&key);
    if state.is_some() {
        bump_persistent(e, &key);
    }
    state
}

pub fn set_pair(e: &Env, pair: &PairKey, state: &PairState) {
    let key = DataKey::Pair(pair.clone());
    e.storage().persistent().set(&key, state);
    bump_persistent(e, &key);
}

pub fn get_shares(e: &Env, pair: &PairKey, user: &Address) -> i128 {
    let key = DataKey::Shares(pair.clone(), user.clone());
    match e.storage().persistent().get(&key) {
        Some(v) => {
            bump_persistent(e, &key);
            v
        }
        None => 0,
    }
}

pub fn set_shares(e: &Env, pair: &PairKey, user: &Address, amount: i128) {
    let key = DataKey::Shares(pair.clone(), user.clone());
    if amount == 0 {
        // Free the ledger entry once a position is fully withdrawn.
        e.storage().persistent().remove(&key);
    } else {
        e.storage().persistent().set(&key, &amount);
        bump_persistent(e, &key);
    }
}
