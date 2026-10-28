//! AnchorSwap: a constant-product (x·y=k) AMM for Stellar / Soroban.
//!
//! * One contract holds many pools. A pool is identified by its two token
//!   addresses in canonical (sorted) order.
//! * 0.30 % swap fee, kept in the pool for liquidity providers.
//! * Pools are created by the admin only, so the UI never lists a pool
//!   built on a malicious token contract.
//! * The admin can pause swaps and deposits. Withdrawals always work, so
//!   users can exit even while paused.
//! * Every state-changing call takes a `deadline` (ledger timestamp) and a
//!   minimum output, so a delayed or front-run transaction fails instead of
//!   executing at a bad price.
//! * Soroban forbids a contract from being re-entered while it is on the
//!   call stack, so no manual re-entrancy lock is needed.

#![no_std]

mod error;
mod math;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractevent, contractimpl, token, Address, BytesN, ContractExecutable, Env, Vec,
};

pub use error::Error;
pub use math::{FEE_BPS, MINIMUM_LIQUIDITY};
pub use storage::{PairKey, PairState};

// ── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairCreated {
    #[topic]
    pub token_a: Address,
    #[topic]
    pub token_b: Address,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiquidityAdded {
    #[topic]
    pub provider: Address,
    pub token_a: Address,
    pub token_b: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiquidityRemoved {
    #[topic]
    pub provider: Address,
    pub token_a: Address,
    pub token_b: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Swap {
    #[topic]
    pub user: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PausedChanged {
    pub paused: bool,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminChanged {
    pub admin: Address,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn check_deadline(e: &Env, deadline: u64) -> Result<(), Error> {
    if e.ledger().timestamp() > deadline {
        return Err(Error::DeadlineExpired);
    }
    Ok(())
}

fn check_not_paused(e: &Env) -> Result<(), Error> {
    if storage::is_paused(e) {
        return Err(Error::Paused);
    }
    Ok(())
}

fn load_pair(e: &Env, x: &Address, y: &Address) -> Result<(PairKey, bool, PairState), Error> {
    if x == y {
        return Err(Error::IdenticalTokens);
    }
    let (key, in_order) = storage::canonical(e, x, y);
    let state = storage::get_pair(e, &key).ok_or(Error::PairNotFound)?;
    Ok((key, in_order, state))
}

/// Swap a pair of values between caller order and canonical order.
fn order<T>(in_order: bool, first: T, second: T) -> (T, T) {
    if in_order {
        (first, second)
    } else {
        (second, first)
    }
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct AnchorSwap;

#[contractimpl]
impl AnchorSwap {
    /// Runs once, atomically with deployment, so nobody can front-run
    /// initialisation and take over the admin role.
    pub fn __constructor(e: Env, admin: Address) {
        storage::set_admin(&e, &admin);
        storage::bump_instance(&e);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// Register a new pool. Admin only.
    pub fn create_pair(e: Env, token_a: Address, token_b: Address) -> Result<PairKey, Error> {
        storage::get_admin(&e).require_auth();
        storage::bump_instance(&e);
        if token_a == token_b {
            return Err(Error::IdenticalTokens);
        }
        let (key, _) = storage::canonical(&e, &token_a, &token_b);
        if storage::get_pair(&e, &key).is_some() {
            return Err(Error::PairAlreadyExists);
        }
        let mut pairs = storage::get_pairs(&e);
        if pairs.len() >= storage::MAX_PAIRS {
            return Err(Error::TooManyPairs);
        }
        // Calling `decimals()` fails for addresses that are not token
        // contracts, so a typo cannot create a dead pool.
        token::TokenClient::new(&e, &key.token_a).decimals();
        token::TokenClient::new(&e, &key.token_b).decimals();

        storage::set_pair(
            &e,
            &key,
            &PairState {
                reserve_a: 0,
                reserve_b: 0,
                total_shares: 0,
            },
        );
        pairs.push_back(key.clone());
        storage::set_pairs(&e, &pairs);

        PairCreated {
            token_a: key.token_a.clone(),
            token_b: key.token_b.clone(),
        }
        .publish(&e);
        Ok(key)
    }

    /// Pause or resume swaps and deposits. Admin only.
    pub fn set_paused(e: Env, paused: bool) {
        storage::get_admin(&e).require_auth();
        storage::bump_instance(&e);
        storage::set_paused(&e, paused);
        PausedChanged { paused }.publish(&e);
    }

    /// Hand the admin role to `new_admin`. Both the current and the new admin
    /// must sign, so the role cannot be sent to a mistyped address.
    pub fn set_admin(e: Env, new_admin: Address) {
        storage::get_admin(&e).require_auth();
        new_admin.require_auth();
        storage::bump_instance(&e);
        storage::set_admin(&e, &new_admin);
        AdminChanged { admin: new_admin }.publish(&e);
    }

    /// Replace the contract code. Admin only.
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        storage::get_admin(&e).require_auth();
        e.deployer()
            .update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }

    // ── Liquidity ────────────────────────────────────────────────────────────

    /// Deposit up to `amount_a_desired` / `amount_b_desired` and receive LP
    /// shares. Only the amounts that match the pool's current ratio are
    /// taken. Returns `(amount_a, amount_b, shares)` in the caller's order.
    #[allow(clippy::too_many_arguments)]
    pub fn add_liquidity(
        e: Env,
        provider: Address,
        token_a: Address,
        token_b: Address,
        amount_a_desired: i128,
        amount_b_desired: i128,
        amount_a_min: i128,
        amount_b_min: i128,
        deadline: u64,
    ) -> Result<(i128, i128, i128), Error> {
        provider.require_auth();
        storage::bump_instance(&e);
        check_deadline(&e, deadline)?;
        check_not_paused(&e)?;
        let (key, in_order, mut state) = load_pair(&e, &token_a, &token_b)?;

        let (a_des, b_des) = order(in_order, amount_a_desired, amount_b_desired);
        let (a_min, b_min) = order(in_order, amount_a_min, amount_b_min);
        let d = math::deposit(
            a_des,
            b_des,
            a_min,
            b_min,
            state.reserve_a,
            state.reserve_b,
            state.total_shares,
        )?;

        let this = e.current_contract_address();
        token::TokenClient::new(&e, &key.token_a).transfer(&provider, &this, &d.amount_a);
        token::TokenClient::new(&e, &key.token_b).transfer(&provider, &this, &d.amount_b);

        state.reserve_a = state
            .reserve_a
            .checked_add(d.amount_a)
            .ok_or(Error::Overflow)?;
        state.reserve_b = state
            .reserve_b
            .checked_add(d.amount_b)
            .ok_or(Error::Overflow)?;
        state.total_shares = state
            .total_shares
            .checked_add(d.shares + d.locked)
            .ok_or(Error::Overflow)?;
        storage::set_pair(&e, &key, &state);

        let held = storage::get_shares(&e, &key, &provider);
        storage::set_shares(
            &e,
            &key,
            &provider,
            held.checked_add(d.shares).ok_or(Error::Overflow)?,
        );

        LiquidityAdded {
            provider,
            token_a: key.token_a,
            token_b: key.token_b,
            amount_a: d.amount_a,
            amount_b: d.amount_b,
            shares: d.shares,
        }
        .publish(&e);

        let (out_a, out_b) = order(in_order, d.amount_a, d.amount_b);
        Ok((out_a, out_b, d.shares))
    }

    /// Burn `shares` and withdraw the matching part of both reserves.
    /// Works even while paused. Returns `(amount_a, amount_b)` in the
    /// caller's order.
    #[allow(clippy::too_many_arguments)]
    pub fn remove_liquidity(
        e: Env,
        provider: Address,
        token_a: Address,
        token_b: Address,
        shares: i128,
        amount_a_min: i128,
        amount_b_min: i128,
        deadline: u64,
    ) -> Result<(i128, i128), Error> {
        provider.require_auth();
        storage::bump_instance(&e);
        check_deadline(&e, deadline)?;
        let (key, in_order, mut state) = load_pair(&e, &token_a, &token_b)?;

        let held = storage::get_shares(&e, &key, &provider);
        if shares <= 0 {
            return Err(Error::InvalidAmount);
        }
        if shares > held {
            return Err(Error::InsufficientShares);
        }
        let (amount_a, amount_b) =
            math::withdraw(shares, state.reserve_a, state.reserve_b, state.total_shares)?;

        let (a_min, b_min) = order(in_order, amount_a_min, amount_b_min);
        if amount_a < a_min || amount_b < b_min {
            return Err(Error::SlippageExceeded);
        }
        if amount_a == 0 && amount_b == 0 {
            return Err(Error::InsufficientLiquidity);
        }

        // Update state before the outgoing transfers.
        storage::set_shares(&e, &key, &provider, held - shares);
        state.total_shares -= shares;
        state.reserve_a -= amount_a;
        state.reserve_b -= amount_b;
        storage::set_pair(&e, &key, &state);

        let this = e.current_contract_address();
        if amount_a > 0 {
            token::TokenClient::new(&e, &key.token_a).transfer(&this, &provider, &amount_a);
        }
        if amount_b > 0 {
            token::TokenClient::new(&e, &key.token_b).transfer(&this, &provider, &amount_b);
        }

        LiquidityRemoved {
            provider,
            token_a: key.token_a,
            token_b: key.token_b,
            amount_a,
            amount_b,
            shares,
        }
        .publish(&e);

        Ok(order(in_order, amount_a, amount_b))
    }

    // ── Swap ─────────────────────────────────────────────────────────────────

    /// Sell exactly `amount_in` of `token_in` for at least `min_out` of
    /// `token_out`. Returns the amount received.
    pub fn swap_exact_in(
        e: Env,
        user: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_out: i128,
        deadline: u64,
    ) -> Result<i128, Error> {
        user.require_auth();
        storage::bump_instance(&e);
        check_deadline(&e, deadline)?;
        check_not_paused(&e)?;
        if min_out < 0 {
            return Err(Error::InvalidAmount);
        }
        let (key, in_is_a, mut state) = load_pair(&e, &token_in, &token_out)?;

        let (reserve_in, reserve_out) = order(in_is_a, state.reserve_a, state.reserve_b);
        let amount_out = math::amount_out(amount_in, reserve_in, reserve_out)?;
        if amount_out == 0 {
            return Err(Error::InsufficientLiquidity);
        }
        if amount_out < min_out {
            return Err(Error::SlippageExceeded);
        }

        let new_in = reserve_in.checked_add(amount_in).ok_or(Error::Overflow)?;
        let new_out = reserve_out - amount_out; // amount_out < reserve_out by construction
        let (ra, rb) = order(in_is_a, new_in, new_out);
        state.reserve_a = ra;
        state.reserve_b = rb;
        storage::set_pair(&e, &key, &state);

        let this = e.current_contract_address();
        token::TokenClient::new(&e, &token_in).transfer(&user, &this, &amount_in);
        token::TokenClient::new(&e, &token_out).transfer(&this, &user, &amount_out);

        Swap {
            user,
            token_in,
            token_out,
            amount_in,
            amount_out,
        }
        .publish(&e);
        Ok(amount_out)
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// Exact output `swap_exact_in` would give right now (fee included).
    pub fn get_amount_out(
        e: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
    ) -> Result<i128, Error> {
        let (_, in_is_a, state) = load_pair(&e, &token_in, &token_out)?;
        let (reserve_in, reserve_out) = order(in_is_a, state.reserve_a, state.reserve_b);
        math::amount_out(amount_in, reserve_in, reserve_out)
    }

    /// Reserves in the caller's token order: `(reserve_of_a, reserve_of_b)`.
    pub fn get_reserves(e: Env, token_a: Address, token_b: Address) -> Result<(i128, i128), Error> {
        let (_, in_order, state) = load_pair(&e, &token_a, &token_b)?;
        Ok(order(in_order, state.reserve_a, state.reserve_b))
    }

    /// Full pool state in canonical order.
    pub fn get_pair(e: Env, token_a: Address, token_b: Address) -> Result<PairState, Error> {
        Ok(load_pair(&e, &token_a, &token_b)?.2)
    }

    pub fn get_pairs(e: Env) -> Vec<PairKey> {
        storage::get_pairs(&e)
    }

    pub fn get_shares(
        e: Env,
        token_a: Address,
        token_b: Address,
        user: Address,
    ) -> Result<i128, Error> {
        let (key, _, _) = load_pair(&e, &token_a, &token_b)?;
        Ok(storage::get_shares(&e, &key, &user))
    }

    pub fn admin(e: Env) -> Address {
        storage::get_admin(&e)
    }

    pub fn is_paused(e: Env) -> bool {
        storage::is_paused(&e)
    }

    pub fn fee_bps(_e: Env) -> i128 {
        FEE_BPS
    }
}
