//! AnchorSwap – Unit Tests
//!
//! These tests exercise individual functions and invariants of the AMM
//! contract using the Soroban test environment with mocked auth.
//!
//! Run with:
//!   cargo test --features testutils -- unit

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

use crate::{isqrt, AnchorSwap, AnchorSwapClient};
use soroban_token_contract::{TokenContract, TokenContractClient};

// ──────────────────────────────────────────────────────────────────────────────
// Setup helpers
// ──────────────────────────────────────────────────────────────────────────────

fn deploy_token<'a>(env: &'a Env, admin: &Address) -> (Address, TokenContractClient<'a>) {
    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(env, &id);
    client.initialize(
        admin,
        &7_u32,
        &soroban_sdk::String::from_str(env, "TestToken"),
        &soroban_sdk::String::from_str(env, "TT"),
    );
    (id, client)
}

fn deploy_amm(env: &Env, admin: &Address) -> (Address, AnchorSwapClient) {
    let id = env.register_contract(None, AnchorSwap);
    let client = AnchorSwapClient::new(env, &id);
    client.initialize(admin);
    (id, client)
}

// ──────────────────────────────────────────────────────────────────────────────
// isqrt unit tests
// ──────────────────────────────────────────────────────────────────────────────

/// Test isqrt correctness for a representative set of values.
#[test]
fn unit_isqrt_known_values() {
    assert_eq!(isqrt(0), 0);
    assert_eq!(isqrt(1), 1);
    assert_eq!(isqrt(4), 2);
    assert_eq!(isqrt(9), 3);
    assert_eq!(isqrt(16), 4);
    assert_eq!(isqrt(25), 5);
    assert_eq!(isqrt(40_000), 200);
    assert_eq!(isqrt(99), 9);
    assert_eq!(isqrt(100), 10);
    assert_eq!(isqrt(101), 10);
    assert_eq!(isqrt(1_000_000), 1_000);
    assert_eq!(isqrt(1_000_000_000_000_i128), 1_000_000_i128);
}

/// isqrt floor property: n >= 0, isqrt(n)^2 <= n < (isqrt(n)+1)^2
#[test]
fn unit_isqrt_floor_property() {
    for n in [2_i128, 7, 15, 50, 99, 1000, 9999, 100_000] {
        let s = isqrt(n);
        assert!(s * s <= n, "floor: s^2 <= n failed for n={n}");
        assert!((s + 1) * (s + 1) > n, "floor: (s+1)^2 > n failed for n={n}");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Canonical address sorting
// ──────────────────────────────────────────────────────────────────────────────

/// `get_reserves(A, B)` and `get_reserves(B, A)` must return the same values,
/// confirming that canonical sorting is applied on both sides.
#[test]
fn unit_canonical_sort_symmetry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let provider = Address::generate(&env);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &1_000_i128);
    token_b.mint(&provider, &1_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &500_i128, &500_i128, &1_i128, &provider);

    let (ra, rb) = amm.get_reserves(&ta, &tb);
    let (ra2, rb2) = amm.get_reserves(&tb, &ta);

    // Canonical reserves must be the same regardless of argument order.
    assert_eq!(ra + rb, ra2 + rb2);
    assert_eq!(ra, ra2);
    assert_eq!(rb, rb2);
}

// ──────────────────────────────────────────────────────────────────────────────
// Pair initialisation
// ──────────────────────────────────────────────────────────────────────────────

/// A freshly created pair has zero reserves and zero total shares.
#[test]
fn unit_pair_creation_initial_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (ta, _) = deploy_token(&env, &admin);
    let (tb, _) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    amm.init_pair(&ta, &tb);

    assert_eq!(amm.get_reserves(&ta, &tb), (0, 0));
    assert_eq!(amm.total_shares(&ta, &tb), 0);
}

/// Calling `init_pair` twice for the same canonical pair must panic.
#[test]
#[should_panic(expected = "anchorswap: pair already exists")]
fn unit_duplicate_pair_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (ta, _) = deploy_token(&env, &admin);
    let (tb, _) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    amm.init_pair(&ta, &tb);
    amm.init_pair(&ta, &tb); // must panic
}

/// Calling `init_pair` with reversed token order for an existing pair must
/// also panic (because canonical sorting maps it to the same key).
#[test]
#[should_panic(expected = "anchorswap: pair already exists")]
fn unit_duplicate_pair_reversed_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (ta, _) = deploy_token(&env, &admin);
    let (tb, _) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    amm.init_pair(&ta, &tb);
    amm.init_pair(&tb, &ta); // reversed order – must still panic
}

// ──────────────────────────────────────────────────────────────────────────────
// Add liquidity – first LP
// ──────────────────────────────────────────────────────────────────────────────

/// First deposit: shares = isqrt(amount_a * amount_b).
#[test]
fn unit_first_lp_shares_are_geometric_mean() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &500_i128);
    token_b.mint(&provider, &500_i128);

    amm.init_pair(&ta, &tb);

    let (shares, _, _) = amm.add_liquidity(&ta, &tb, &100_i128, &400_i128, &1_i128, &provider);

    // isqrt(100 * 400) = isqrt(40_000) = 200
    assert_eq!(shares, 200);
    assert_eq!(amm.total_shares(&ta, &tb), 200);
    assert_eq!(amm.get_share(&ta, &tb, &provider), 200);
}

/// First deposit with equal amounts: shares = amount.
#[test]
fn unit_first_lp_equal_amounts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &5_000_i128);
    token_b.mint(&provider, &5_000_i128);

    amm.init_pair(&ta, &tb);

    let (shares, _, _) =
        amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &provider);

    // isqrt(1_000 * 1_000) = 1_000
    assert_eq!(shares, 1_000);
}

// ──────────────────────────────────────────────────────────────────────────────
// Add liquidity – subsequent LPs
// ──────────────────────────────────────────────────────────────────────────────

/// Second LP deposit with the same ratio receives proportional shares.
#[test]
fn unit_second_lp_proportional_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&p1, &10_000_i128);
    token_b.mint(&p1, &10_000_i128);
    token_a.mint(&p2, &10_000_i128);
    token_b.mint(&p2, &10_000_i128);

    amm.init_pair(&ta, &tb);

    let (s1, _, _) = amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &p1);
    assert_eq!(s1, 1_000);

    // Same ratio as initial deposit → same shares.
    let (s2, _, _) = amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &p2);
    assert_eq!(s2, 1_000);
    assert_eq!(amm.total_shares(&ta, &tb), 2_000);
}

/// `min_share` slippage guard must trigger when expected shares fall short.
#[test]
#[should_panic(expected = "anchorswap: insufficient shares minted")]
fn unit_add_liquidity_min_share_check() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &5_000_i128);
    token_b.mint(&provider, &5_000_i128);

    amm.init_pair(&ta, &tb);

    // isqrt(100 * 100) = 100; demanding min_share = 9_999 must fail.
    amm.add_liquidity(&ta, &tb, &100_i128, &100_i128, &9_999_i128, &provider);
}

// ──────────────────────────────────────────────────────────────────────────────
// Swap
// ──────────────────────────────────────────────────────────────────────────────

/// Swap output must match the Uniswap v2 formula exactly.
#[test]
fn unit_swap_output_matches_formula() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    let reserve = 10_000_i128;
    token_a.mint(&provider, &reserve);
    token_b.mint(&provider, &reserve);
    token_a.mint(&swapper, &1_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &reserve, &reserve, &1_i128, &provider);

    let amount_in = 1_000_i128;

    // Manual Uniswap v2 formula:
    // amount_in_with_fee = 1_000 * 997 = 997_000
    // numerator          = 997_000 * 10_000 = 9_970_000_000
    // denominator        = 10_000 * 1_000 + 997_000 = 10_997_000
    // amount_out         = 9_970_000_000 / 10_997_000 = 906
    let expected = (1_000_i128 * 997 * reserve) / (reserve * 1_000 + 1_000 * 997);

    let out = amm.swap_exact_in(&ta, &tb, &amount_in, &1_i128, &swapper);
    assert_eq!(out, expected, "swap output mismatch");
}

/// After a swap the constant-product k must not decrease.
#[test]
fn unit_swap_constant_product_invariant() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&swapper, &5_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &provider);

    let (ra, rb) = amm.get_reserves(&ta, &tb);
    let k_before = ra * rb;

    amm.swap_exact_in(&ta, &tb, &1_000_i128, &1_i128, &swapper);

    let (ra2, rb2) = amm.get_reserves(&ta, &tb);
    let k_after = ra2 * rb2;

    assert!(k_after >= k_before, "k must not decrease: before={k_before}, after={k_after}");
}

/// Slippage guard: swap must panic when output is below `min_out`.
#[test]
#[should_panic(expected = "anchorswap: insufficient output amount")]
fn unit_swap_slippage_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&swapper, &1_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &provider);

    // Unrealistically high min_out → should panic.
    amm.swap_exact_in(&ta, &tb, &100_i128, &99_999_i128, &swapper);
}

// ──────────────────────────────────────────────────────────────────────────────
// Remove liquidity
// ──────────────────────────────────────────────────────────────────────────────

/// Removing half the shares returns half of each reserve.
#[test]
fn unit_remove_liquidity_proportional() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &10_000_i128);
    token_b.mint(&provider, &10_000_i128);

    amm.init_pair(&ta, &tb);

    let (shares, _, _) =
        amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &provider);
    assert_eq!(shares, 1_000);

    let before_a = token_a.balance(&provider);
    let before_b = token_b.balance(&provider);

    let (out_a, out_b) =
        amm.remove_liquidity(&ta, &tb, &500_i128, &1_i128, &1_i128, &provider);

    // Half shares → half reserves returned.
    assert_eq!(out_a + out_b, 1_000, "total withdrawn must equal half the pool");
    assert_eq!(amm.get_share(&ta, &tb, &provider), 500);
    assert_eq!(amm.total_shares(&ta, &tb), 500);

    assert_eq!(token_a.balance(&provider), before_a + out_a);
    assert_eq!(token_b.balance(&provider), before_b + out_b);
}

/// Attempting to remove more shares than the caller owns must panic.
#[test]
#[should_panic(expected = "anchorswap: insufficient shares")]
fn unit_remove_liquidity_insufficient_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &5_000_i128);
    token_b.mint(&provider, &5_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &provider);

    // Provider only has 1_000 shares; trying to burn 2_000 must panic.
    amm.remove_liquidity(&ta, &tb, &2_000_i128, &1_i128, &1_i128, &provider);
}

/// `min_a` slippage guard in remove_liquidity must be enforced.
#[test]
#[should_panic(expected = "anchorswap: amount_a below minimum")]
fn unit_remove_liquidity_slippage_min_a() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &5_000_i128);
    token_b.mint(&provider, &5_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &1_000_i128, &1_000_i128, &1_i128, &provider);

    // 500 shares worth → 500 token each; demand min_a = 9_999 → revert.
    amm.remove_liquidity(&ta, &tb, &500_i128, &9_999_i128, &1_i128, &provider);
}

// ──────────────────────────────────────────────────────────────────────────────
// Re-entrancy guard
// ──────────────────────────────────────────────────────────────────────────────

/// The lock flag is released after a successful call (no state corruption).
/// Confirmed by doing two sequential swaps successfully.
#[test]
fn unit_reentrancy_lock_released_after_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin);
    let (tb, token_b) = deploy_token(&env, &admin);
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&swapper, &10_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &provider);

    // First swap succeeds → lock is released.
    let out1 = amm.swap_exact_in(&ta, &tb, &100_i128, &1_i128, &swapper);
    assert!(out1 > 0);

    // Second swap also succeeds (lock was properly released).
    let out2 = amm.swap_exact_in(&ta, &tb, &100_i128, &1_i128, &swapper);
    assert!(out2 > 0);
}
