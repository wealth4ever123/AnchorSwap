//! AnchorSwap integration tests.
//!
//! Run with:
//!   cargo test --features testutils
//!
//! Each test deploys fresh contract instances via the Soroban test environment
//! so they are fully isolated.

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ──────────────────────────────────────────────────────────────────────────────
// Pull in the contracts we need to register
// ──────────────────────────────────────────────────────────────────────────────

// Our AMM contract (defined in this crate).
use crate::{AnchorSwap, AnchorSwapClient};

// The sibling token contract registered natively (no WASM required).
// The SDK generates `TokenContractClient` from `#[contract] pub struct TokenContract`.
use soroban_token_contract::{TokenContract, TokenContractClient};

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Deploy the token contract, initialise it, and return its address + client.
fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, TokenContractClient<'a>) {
    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(env, &id);
    client.initialize(
        admin,
        &7_u32,
        &String::from_str(env, "TestToken"),
        &String::from_str(env, "TT"),
    );
    (id, client)
}

/// Deploy AnchorSwap, initialise it, and return its address + client.
fn create_amm(env: &Env, admin: &Address) -> (Address, AnchorSwapClient) {
    let id = env.register_contract(None, AnchorSwap);
    let client = AnchorSwapClient::new(env, &id);
    client.initialize(admin);
    (id, client)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

/// Test 1: `init_pair` succeeds and reserves start at zero.
#[test]
fn pair_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_a_id, _) = create_token(&env, &admin);
    let (token_b_id, _) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    amm.init_pair(&token_a_id, &token_b_id);

    let (ra, rb) = amm.get_reserves(&token_a_id, &token_b_id);
    assert_eq!(ra, 0);
    assert_eq!(rb, 0);
    assert_eq!(amm.total_shares(&token_a_id, &token_b_id), 0);
}

/// Test 2: A second `init_pair` for the same pair must panic.
#[test]
#[should_panic(expected = "anchorswap: pair already exists")]
fn duplicate_pair_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_a_id, _) = create_token(&env, &admin);
    let (token_b_id, _) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    amm.init_pair(&token_a_id, &token_b_id);
    // Second call with same pair should panic.
    amm.init_pair(&token_a_id, &token_b_id);
}

/// Test 3: First LP receives `isqrt(a * b)` shares.
///
/// With `amount_a = 100` and `amount_b = 400`, expected shares = isqrt(40 000) = 200.
#[test]
fn first_lp_gets_sqrt_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider, &1_000_i128);
    token_b.mint(&provider, &1_000_i128);

    amm.init_pair(&token_a_id, &token_b_id);

    let (shares, new_ra, new_rb) = amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &100_i128,
        &400_i128,
        &1_i128,
        &provider,
    );

    assert_eq!(shares, 200, "expected isqrt(100*400) = 200");
    // Canonical order may flip the amounts, but their sum must equal 500.
    assert_eq!(new_ra + new_rb, 500, "total reserves should be 500");
    assert_eq!(amm.total_shares(&token_a_id, &token_b_id), 200);
    assert_eq!(amm.get_share(&token_a_id, &token_b_id, &provider), 200);
}

/// Test 4: A second LP deposit must be proportional to the existing reserves.
#[test]
fn proportional_lp() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider1, &10_000_i128);
    token_b.mint(&provider1, &10_000_i128);
    token_a.mint(&provider2, &10_000_i128);
    token_b.mint(&provider2, &10_000_i128);

    amm.init_pair(&token_a_id, &token_b_id);

    // First LP: 1 000 / 1 000 → 1 000 shares.
    let (shares1, _, _) = amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &1_000_i128,
        &1_000_i128,
        &1_i128,
        &provider1,
    );
    assert_eq!(shares1, 1_000);

    // Second LP deposits the same ratio.
    let (shares2, _, _) = amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &1_000_i128,
        &1_000_i128,
        &1_i128,
        &provider2,
    );

    // shares2 = min(1 000 * 1 000 / 1 000, 1 000 * 1 000 / 1 000) = 1 000
    assert_eq!(shares2, 1_000, "second LP should receive proportional shares");
    assert_eq!(amm.total_shares(&token_a_id, &token_b_id), 2_000);
}

/// Test 5: After a swap the constant-product invariant k = ra * rb must not
/// decrease (the fee strictly increases it).
#[test]
fn swap_price_impact() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&swapper, &10_000_i128);

    amm.init_pair(&token_a_id, &token_b_id);
    amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &10_000_i128,
        &10_000_i128,
        &1_i128,
        &provider,
    );

    let (ra_before, rb_before) = amm.get_reserves(&token_a_id, &token_b_id);
    let k_before = ra_before * rb_before;

    let amount_out =
        amm.swap_exact_in(&token_a_id, &token_b_id, &1_000_i128, &1_i128, &swapper);
    assert!(amount_out > 0, "should receive some token_b");

    let (ra_after, rb_after) = amm.get_reserves(&token_a_id, &token_b_id);
    let k_after = ra_after * rb_after;

    assert!(
        k_after >= k_before,
        "constant product must not decrease: k_before={k_before}, k_after={k_after}"
    );

    // Swapper received token_b (or token_a depending on canonical order).
    // At minimum they received something from the output token.
    let _ = amount_out; // verified non-zero above
}

/// Test 6: A swap that would produce less than `min_out` must panic.
#[test]
#[should_panic(expected = "anchorswap: insufficient output amount")]
fn slippage_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&swapper, &1_000_i128);

    amm.init_pair(&token_a_id, &token_b_id);
    amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &10_000_i128,
        &10_000_i128,
        &1_i128,
        &provider,
    );

    // Request unrealistically high min_out → should panic.
    amm.swap_exact_in(&token_a_id, &token_b_id, &100_i128, &9_999_i128, &swapper);
}

/// Test 7: Removing liquidity returns proportional tokens and burns shares.
#[test]
fn remove_liquidity_test() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider, &10_000_i128);
    token_b.mint(&provider, &10_000_i128);

    amm.init_pair(&token_a_id, &token_b_id);

    let (shares, _, _) = amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &1_000_i128,
        &1_000_i128,
        &1_i128,
        &provider,
    );
    assert_eq!(shares, 1_000);

    let bal_a_before = token_a.balance(&provider);
    let bal_b_before = token_b.balance(&provider);

    // Remove half the shares.
    let (out_a, out_b) = amm.remove_liquidity(
        &token_a_id,
        &token_b_id,
        &500_i128,
        &1_i128,
        &1_i128,
        &provider,
    );

    // Should recover exactly half of each token.
    assert_eq!(out_a + out_b, 1_000, "should recover half the liquidity");

    // Shares halved.
    assert_eq!(amm.get_share(&token_a_id, &token_b_id, &provider), 500);
    assert_eq!(amm.total_shares(&token_a_id, &token_b_id), 500);

    // Token balances increased by the withdrawn amounts.
    assert_eq!(token_a.balance(&provider), bal_a_before + out_a);
    assert_eq!(token_b.balance(&provider), bal_b_before + out_b);
}

/// Test 8: Full lifecycle — create pair → add liquidity → swap → remove liquidity.
#[test]
fn full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (token_a_id, token_a) = create_token(&env, &admin);
    let (token_b_id, token_b) = create_token(&env, &admin);
    let (_, amm) = create_amm(&env, &admin);

    token_a.mint(&provider, &50_000_i128);
    token_b.mint(&provider, &50_000_i128);
    token_a.mint(&swapper, &5_000_i128);

    // ── Step 1: create pair ───────────────────────────────────────────────────
    amm.init_pair(&token_a_id, &token_b_id);
    let (ra, rb) = amm.get_reserves(&token_a_id, &token_b_id);
    assert_eq!((ra, rb), (0, 0));

    // ── Step 2: add liquidity ─────────────────────────────────────────────────
    let (shares, new_ra, new_rb) = amm.add_liquidity(
        &token_a_id,
        &token_b_id,
        &10_000_i128,
        &10_000_i128,
        &1_i128,
        &provider,
    );
    assert_eq!(shares, 10_000);
    assert_eq!(new_ra + new_rb, 20_000);

    // ── Step 3: swap ──────────────────────────────────────────────────────────
    let amount_out =
        amm.swap_exact_in(&token_a_id, &token_b_id, &1_000_i128, &1_i128, &swapper);
    assert!(amount_out > 0, "should receive tokens from swap");

    let (ra2, rb2) = amm.get_reserves(&token_a_id, &token_b_id);
    assert!(
        ra2 * rb2 >= new_ra * new_rb,
        "constant product must not decrease"
    );

    // ── Step 4: remove all liquidity ─────────────────────────────────────────
    let (out_a, out_b) = amm.remove_liquidity(
        &token_a_id,
        &token_b_id,
        &shares,
        &1_i128,
        &1_i128,
        &provider,
    );

    assert!(out_a > 0 && out_b > 0, "provider should receive tokens");
    assert_eq!(amm.total_shares(&token_a_id, &token_b_id), 0);
    assert_eq!(amm.get_share(&token_a_id, &token_b_id, &provider), 0);

    let (final_ra, final_rb) = amm.get_reserves(&token_a_id, &token_b_id);
    assert!(
        final_ra < 10,
        "pool should be nearly empty, got ra={final_ra}"
    );
    assert!(
        final_rb < 10,
        "pool should be nearly empty, got rb={final_rb}"
    );
}

/// Test 9: isqrt correctness for known values.
#[test]
fn isqrt_correctness() {
    use crate::isqrt;

    assert_eq!(isqrt(0), 0);
    assert_eq!(isqrt(1), 1);
    assert_eq!(isqrt(4), 2);
    assert_eq!(isqrt(9), 3);
    assert_eq!(isqrt(40_000), 200);
    assert_eq!(isqrt(99), 9);
    assert_eq!(isqrt(100), 10);
    assert_eq!(isqrt(1_000_000_000_000_i128), 1_000_000_i128);
}
