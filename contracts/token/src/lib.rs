//! Soroban SEP-41 Token Contract
//! A standard fungible token implementation used as a test fixture and
//! standalone deployable token for the AnchorSwap ecosystem.
//!
//! The public ABI is exposed via `soroban_sdk::token::Interface` so that
//! `soroban_sdk::token::Client` can be used to call this contract from
//! other contracts (e.g. the AnchorSwap AMM).

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

// ──────────────────────────────────────────────────────────────────────────────
// Storage keys
// ──────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    Balance(Address),
    Allowance(AllowanceKey),
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

// ──────────────────────────────────────────────────────────────────────────────
// Allowance record
// ──────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal storage helpers
// ──────────────────────────────────────────────────────────────────────────────

fn get_balance(e: &Env, id: &Address) -> i128 {
    e.storage()
        .persistent()
        .get(&DataKey::Balance(id.clone()))
        .unwrap_or(0_i128)
}

fn set_balance(e: &Env, id: &Address, amount: i128) {
    e.storage()
        .persistent()
        .set(&DataKey::Balance(id.clone()), &amount);
}

fn get_allowance(e: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or(AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        })
}

fn set_allowance(e: &Env, from: &Address, spender: &Address, value: &AllowanceValue) {
    let key = DataKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    e.storage().persistent().set(&key, value);
}

fn require_admin(e: &Env) {
    let admin: Address = e
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("token: not initialized");
    admin.require_auth();
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal transfer / burn
// ──────────────────────────────────────────────────────────────────────────────

fn do_transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    let from_balance = get_balance(e, from);
    let new_from = from_balance
        .checked_sub(amount)
        .expect("token: insufficient balance");
    let to_balance = get_balance(e, to);
    let new_to = to_balance
        .checked_add(amount)
        .expect("token: transfer overflow");
    set_balance(e, from, new_from);
    set_balance(e, to, new_to);
    e.events().publish(
        (symbol_short!("transfer"), from.clone(), to.clone()),
        amount,
    );
}

fn do_burn(e: &Env, from: &Address, amount: i128) {
    let balance = get_balance(e, from);
    let new_balance = balance
        .checked_sub(amount)
        .expect("token: insufficient balance to burn");
    set_balance(e, from, new_balance);
    e.events()
        .publish((symbol_short!("burn"), from.clone()), amount);
}

fn check_and_spend_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
    let rec = get_allowance(e, from, spender);
    if rec.expiration_ledger > 0 && e.ledger().sequence() > rec.expiration_ledger {
        panic!("token: allowance expired");
    }
    let new_amount = rec
        .amount
        .checked_sub(amount)
        .expect("token: insufficient allowance");
    set_allowance(
        e,
        from,
        spender,
        &AllowanceValue {
            amount: new_amount,
            expiration_ledger: rec.expiration_ledger,
        },
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Contract – exposes soroban_sdk::token::Interface ABI
// ──────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenContract;

/// Extra admin-only functions (not part of SEP-41 core).
#[contractimpl]
impl TokenContract {
    /// One-time initialization.
    pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic!("token: already initialized");
        }
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Decimals, &decimal);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);
    }

    /// Mint new tokens. Admin only.
    pub fn mint(e: Env, to: Address, amount: i128) {
        require_admin(&e);
        assert!(amount > 0, "token: mint amount must be positive");
        let balance = get_balance(&e, &to);
        let new_balance = balance
            .checked_add(amount)
            .expect("token: mint overflow");
        set_balance(&e, &to, new_balance);
        e.events()
            .publish((symbol_short!("mint"), to.clone()), amount);
    }

    /// Transfer admin rights.
    pub fn set_admin(e: Env, new_admin: Address) {
        require_admin(&e);
        e.storage().instance().set(&DataKey::Admin, &new_admin);
    }
}

/// SEP-41 / soroban_sdk::token::Interface implementation.
/// This is the standard ABI consumed by `soroban_sdk::token::Client`.
#[contractimpl]
impl token::Interface for TokenContract {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        let rec = get_allowance(&e, &from, &spender);
        if rec.expiration_ledger > 0 && e.ledger().sequence() > rec.expiration_ledger {
            return 0;
        }
        rec.amount
    }

    fn approve(
        e: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        assert!(amount >= 0, "token: approve amount must be non-negative");
        set_allowance(
            &e,
            &from,
            &spender,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        e.events().publish(
            (symbol_short!("approve"), from.clone(), spender.clone()),
            (amount, expiration_ledger),
        );
    }

    fn balance(e: Env, id: Address) -> i128 {
        get_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "token: transfer amount must be positive");
        do_transfer(&e, &from, &to, amount);
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        assert!(amount > 0, "token: transfer_from amount must be positive");
        check_and_spend_allowance(&e, &from, &spender, amount);
        do_transfer(&e, &from, &to, amount);
    }

    fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "token: burn amount must be positive");
        do_burn(&e, &from, amount);
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        assert!(amount > 0, "token: burn_from amount must be positive");
        check_and_spend_allowance(&e, &from, &spender, amount);
        do_burn(&e, &from, amount);
    }

    fn decimals(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::Decimals)
            .expect("token: not initialized")
    }

    fn name(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Name)
            .expect("token: not initialized")
    }

    fn symbol(e: Env) -> String {
        e.storage()
            .instance()
            .get(&DataKey::Symbol)
            .expect("token: not initialized")
    }
}
