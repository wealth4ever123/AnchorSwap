//! AnchorSwap – Integration Tests
//!
//! Each test scenario sets up a fresh Soroban environment, deploys both the
//! token contract and the AnchorSwap AMM contract, mints tokens to mock
//! users, and runs complete interaction loops.
//!
//! Run with:
//!   cargo test --features testutils -- integration

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::{AnchorSwap, AnchorSwapClient};
use soroban_token_contract::{TokenContract, TokenContractClient};

// ──────────────────────────────────────────────────────────────────────────────
// Setup helpers
// ──────────────────────────────────────────────────────────────────────────────

/// Deploy the token contract and return its contract address plus a client.
fn deploy_token<'a>(
    env: &'a Env,
    admin: &Address,
    name: &str,
    symbol: &str,
) -> (Address, TokenContractClient<'a>) {
    let id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(env, &id);
    client.initialize(
        admin,
        &7_u32,
        &String::from_str(env, name),
        &String::from_str(env, symbol),
    );
    (id, client)
}

/// Deploy AnchorSwap and return its contract address plus a client.
fn deploy_amm(env: &Env, admin: &Address) -> (Address, AnchorSwapClient) {
    let id = env.register_contract(None, AnchorSwap);
    let client = AnchorSwapClient::new(env, &id);
    client.initialize(admin);
    (id, client)
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: Complete lifecycle
// ──────────────────────────────────────────────────────────────────────────────

/// Full flow: init pair → add liquidity → swap → remove liquidity.
/// Validates all state transitions and final token balance accounting.
#[test]
fn integration_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin, "TokenA", "TKA");
    let (tb, token_b) = deploy_token(&env, &admin, "TokenB", "TKB");
    let (_, amm) = deploy_amm(&env, &admin);

    // ── Mint initial balances ─────────────────────────────────────────────────
    token_a.mint(&provider, &50_000_i128);
    token_b.mint(&provider, &50_000_i128);
    token_a.mint(&swapper, &5_000_i128);

    // ── Step 1: Create the pair ───────────────────────────────────────────────
    amm.init_pair(&ta, &tb);
    let (ra0, rb0) = amm.get_reserves(&ta, &tb);
    assert_eq!((ra0, rb0), (0, 0), "reserves must start at zero");
    assert_eq!(amm.total_shares(&ta, &tb), 0);

    // ── Step 2: Add liquidity ─────────────────────────────────────────────────
    let (shares, new_ra, new_rb) =
        amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &provider);

    // isqrt(10_000 * 10_000) = 10_000
    assert_eq!(shares, 10_000, "first LP shares must equal sqrt(a*b)");
    assert_eq!(new_ra + new_rb, 20_000, "total reserves after deposit");
    assert_eq!(amm.get_share(&ta, &tb, &provider), 10_000);

    // ── Step 3: Swap ──────────────────────────────────────────────────────────
    let swap_amount_in = 1_000_i128;
    let amount_out = amm.swap_exact_in(&ta, &tb, &swap_amount_in, &1_i128, &swapper);

    assert!(amount_out > 0, "swap must yield positive output");

    // Constant-product invariant k must not decrease.
    let (ra_after_swap, rb_after_swap) = amm.get_reserves(&ta, &tb);
    let k_before = new_ra * new_rb;
    let k_after = ra_after_swap * rb_after_swap;
    assert!(k_after >= k_before, "k must not decrease after swap");

    // ── Step 4: Remove all liquidity ─────────────────────────────────────────
    let before_a = token_a.balance(&provider);
    let before_b = token_b.balance(&provider);

    let (out_a, out_b) = amm.remove_liquidity(&ta, &tb, &shares, &1_i128, &1_i128, &provider);

    assert!(out_a > 0 && out_b > 0, "provider must receive both tokens");
    assert_eq!(amm.total_shares(&ta, &tb), 0, "all shares must be burned");
    assert_eq!(amm.get_share(&ta, &tb, &provider), 0);

    // Verify token balances increased by withdrawn amounts.
    assert_eq!(token_a.balance(&provider), before_a + out_a);
    assert_eq!(token_b.balance(&provider), before_b + out_b);

    // Pool should be empty (or nearly so due to fee accumulation rounding).
    let (final_ra, final_rb) = amm.get_reserves(&ta, &tb);
    assert!(final_ra < 10, "pool should be nearly empty, ra={final_ra}");
    assert!(final_rb < 10, "pool should be nearly empty, rb={final_rb}");
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: Multiple liquidity providers
// ──────────────────────────────────────────────────────────────────────────────

/// Two independent LPs add liquidity and then withdraw; fees earned via a
/// swap should be distributed proportionally.
#[test]
fn integration_multiple_lps_earn_fees() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1);

    let admin = Address::generate(&env);
    let lp1 = Address::generate(&env);
    let lp2 = Address::generate(&env);
    let swapper = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin, "TokenA", "TKA");
    let (tb, token_b) = deploy_token(&env, &admin, "TokenB", "TKB");
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&lp1, &50_000_i128);
    token_b.mint(&lp1, &50_000_i128);
    token_a.mint(&lp2, &50_000_i128);
    token_b.mint(&lp2, &50_000_i128);
    token_a.mint(&swapper, &10_000_i128);

    amm.init_pair(&ta, &tb);

    // LP1: 10_000 / 10_000 → 10_000 shares
    let (s1, _, _) = amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &lp1);
    assert_eq!(s1, 10_000);

    // LP2: same ratio → same proportional shares
    let (s2, _, _) = amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &lp2);
    assert_eq!(s2, 10_000);
    assert_eq!(amm.total_shares(&ta, &tb), 20_000);

    // Swap generates fees that accrue in the pool.
    let _ = amm.swap_exact_in(&ta, &tb, &2_000_i128, &1_i128, &swapper);

    // Both LPs remove their shares; each receives proportional reserves.
    let (out_a1, out_b1) = amm.remove_liquidity(&ta, &tb, &s1, &1_i128, &1_i128, &lp1);
    let (out_a2, out_b2) = amm.remove_liquidity(&ta, &tb, &s2, &1_i128, &1_i128, &lp2);

    // Both LPs had equal share (50/50), so withdrawals must be equal.
    assert_eq!(
        out_a1 + out_b1,
        out_a2 + out_b2,
        "equal LPs must receive equal total token amounts"
    );

    assert_eq!(amm.total_shares(&ta, &tb), 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: Price impact grows with swap size
// ──────────────────────────────────────────────────────────────────────────────

/// A larger swap in the same pool produces less output per unit input than a
/// smaller swap — verifying that price impact behaves correctly.
#[test]
fn integration_price_impact_increases_with_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let swapper_small = Address::generate(&env);
    let swapper_large = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin, "TokenA", "TKA");
    let (tb, token_b) = deploy_token(&env, &admin, "TokenB", "TKB");

    // Deploy two identical pools, one for the small swap and one for large.
    // Re-use same pair but run tests on separate pools would require two
    // AMM instances; instead compare effective rates.
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &200_000_i128);
    token_b.mint(&provider, &200_000_i128);
    token_a.mint(&swapper_small, &100_i128);
    token_a.mint(&swapper_large, &5_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &100_000_i128, &100_000_i128, &1_i128, &provider);

    // Small swap
    let out_small = amm.swap_exact_in(&ta, &tb, &100_i128, &1_i128, &swapper_small);
    let rate_small = out_small * 1_000 / 100; // output per 1000 input units

    // After the small swap the pool is slightly imbalanced; large swap from a
    // much bigger pool impact perspective.
    let out_large = amm.swap_exact_in(&ta, &tb, &5_000_i128, &1_i128, &swapper_large);
    let rate_large = out_large * 1_000 / 5_000;

    // Large swap must have a lower effective rate (more price impact).
    assert!(
        rate_large <= rate_small,
        "larger swap must have equal or worse rate: small={rate_small}, large={rate_large}"
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: Swap both directions
// ──────────────────────────────────────────────────────────────────────────────

/// Swapping A→B and then B→A should leave the pool at a slightly higher k
/// (fee accrual), and the trader should receive strictly less than they put in.
#[test]
fn integration_round_trip_swap_loses_to_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let trader = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin, "TokenA", "TKA");
    let (tb, token_b) = deploy_token(&env, &admin, "TokenB", "TKB");
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);
    token_a.mint(&trader, &1_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &50_000_i128, &50_000_i128, &1_i128, &provider);

    // A→B
    let b_received = amm.swap_exact_in(&ta, &tb, &1_000_i128, &1_i128, &trader);
    assert!(b_received > 0);

    // B→A (trader uses the b they received)
    let a_back = amm.swap_exact_in(&tb, &ta, &b_received, &1_i128, &trader);

    // Round-trip must give back less than the original 1_000 (fees eaten twice).
    assert!(
        a_back < 1_000,
        "round-trip must lose to fees: started=1000, got_back={a_back}"
    );
    assert!(a_back > 0, "trader must still receive some tokens back");
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: Ledger sequence advances (TTL handling)
// ──────────────────────────────────────────────────────────────────────────────

/// Operations remain functional after ledger sequence number advances,
/// verifying that TTL extension logic doesn't break normal flows.
#[test]
fn integration_works_after_ledger_advances() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 1_000);

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);

    let (ta, token_a) = deploy_token(&env, &admin, "USDC", "USDC");
    let (tb, token_b) = deploy_token(&env, &admin, "XLM", "XLM");
    let (_, amm) = deploy_amm(&env, &admin);

    token_a.mint(&provider, &100_000_i128);
    token_b.mint(&provider, &100_000_i128);

    amm.init_pair(&ta, &tb);
    amm.add_liquidity(&ta, &tb, &10_000_i128, &10_000_i128, &1_i128, &provider);

    // Advance ledger significantly.
    env.ledger().with_mut(|l| l.sequence_number = 5_000_000);

    // Operations must still work.
    let (ra, rb) = amm.get_reserves(&ta, &tb);
    assert_eq!(ra + rb, 20_000);

    let shares = amm.get_share(&ta, &tb, &provider);
    assert_eq!(shares, 10_000);

    // Remove liquidity still works.
    let (out_a, out_b) = amm.remove_liquidity(&ta, &tb, &5_000_i128, &1_i128, &1_i128, &provider);
    assert!(out_a + out_b > 0);
}
