//! Contract tests. Tokens are real Stellar Asset Contracts (the same token
//! type used for XLM and classic assets on testnet/mainnet).

extern crate std;

use crate::{AnchorSwap, AnchorSwapClient, Error, PairState, MINIMUM_LIQUIDITY};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Events as _, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, Symbol,
};

const DEADLINE: u64 = 10_000;
const NOW: u64 = 1_000;

struct Setup<'a> {
    env: Env,
    admin: Address,
    amm: AnchorSwapClient<'a>,
    a: TokenClient<'a>,
    b: TokenClient<'a>,
}

fn new_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &sac.address()),
        StellarAssetClient::new(env, &sac.address()),
    )
}

/// AMM with one A/B pair and `user` funded with 1e12 of each token.
fn setup<'a>() -> (Setup<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = NOW);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let (a, a_admin) = new_token(&env, &admin);
    let (b, b_admin) = new_token(&env, &admin);
    a_admin.mint(&user, &1_000_000_000_000);
    b_admin.mint(&user, &1_000_000_000_000);

    let id = env.register(AnchorSwap, (&admin,));
    let amm = AnchorSwapClient::new(&env, &id);
    amm.create_pair(&a.address, &b.address);
    (
        Setup {
            env,
            admin,
            amm,
            a,
            b,
        },
        user,
    )
}

fn fund(s: &Setup, who: &Address, amount: i128) {
    StellarAssetClient::new(&s.env, &s.a.address).mint(who, &amount);
    StellarAssetClient::new(&s.env, &s.b.address).mint(who, &amount);
}

fn seed(s: &Setup, user: &Address, a: i128, b: i128) -> i128 {
    let (_, _, shares) =
        s.amm
            .add_liquidity(user, &s.a.address, &s.b.address, &a, &b, &0, &0, &DEADLINE);
    shares
}

// ── Setup / admin ────────────────────────────────────────────────────────────

#[test]
fn constructor_sets_admin_and_defaults() {
    let (s, _) = setup();
    assert_eq!(s.amm.admin(), s.admin);
    assert!(!s.amm.is_paused());
    assert_eq!(s.amm.fee_bps(), 30);
    assert_eq!(s.amm.get_pairs().len(), 1);
    assert_eq!(
        s.amm.get_pair(&s.a.address, &s.b.address),
        PairState {
            reserve_a: 0,
            reserve_b: 0,
            total_shares: 0
        }
    );
}

#[test]
fn create_pair_requires_admin_auth() {
    let (s, _) = setup();
    let (c, _) = new_token(&s.env, &s.admin);
    s.amm.create_pair(&s.a.address, &c.address);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
    match &auths[0].1.function {
        AuthorizedFunction::Contract((_, name, _)) => {
            assert_eq!(name, &Symbol::new(&s.env, "create_pair"))
        }
        _ => panic!("unexpected auth"),
    }
}

#[test]
fn create_pair_rejects_non_admin() {
    let (s, _) = setup();
    let (c, _) = new_token(&s.env, &s.admin);
    let attacker = Address::generate(&s.env);
    // Only the attacker signs; the admin signature is missing.
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.amm.address,
            fn_name: "create_pair",
            args: (&s.a.address, &c.address).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.amm.try_create_pair(&s.a.address, &c.address).is_err());
    assert_eq!(s.amm.get_pairs().len(), 1);
}

#[test]
fn create_pair_validation() {
    let (s, _) = setup();
    assert_eq!(
        s.amm.try_create_pair(&s.a.address, &s.a.address),
        Err(Ok(Error::IdenticalTokens))
    );
    // Same pair in either order is a duplicate.
    assert_eq!(
        s.amm.try_create_pair(&s.b.address, &s.a.address),
        Err(Ok(Error::PairAlreadyExists))
    );
    // An address that is not a token contract is rejected.
    let not_a_token = Address::generate(&s.env);
    assert!(s.amm.try_create_pair(&s.a.address, &not_a_token).is_err());
}

#[test]
fn set_admin_needs_both_signatures() {
    let (s, _) = setup();
    let new_admin = Address::generate(&s.env);
    s.amm.set_admin(&new_admin);
    let signers: std::vec::Vec<Address> = s.env.auths().into_iter().map(|a| a.0).collect();
    assert!(signers.contains(&s.admin));
    assert!(signers.contains(&new_admin));
    assert_eq!(s.amm.admin(), new_admin);
}

#[test]
fn upgrade_rejects_non_admin() {
    let (s, _) = setup();
    let attacker = Address::generate(&s.env);
    let hash = soroban_sdk::BytesN::from_array(&s.env, &[7; 32]);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.amm.address,
            fn_name: "upgrade",
            args: (&hash,).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.amm.try_upgrade(&hash).is_err());
}

// ── Liquidity ────────────────────────────────────────────────────────────────

#[test]
fn first_deposit_mints_sqrt_minus_locked() {
    let (s, user) = setup();
    let shares = seed(&s, &user, 4_000_000, 1_000_000);
    assert_eq!(shares, 2_000_000 - MINIMUM_LIQUIDITY);
    assert_eq!(s.amm.get_shares(&s.a.address, &s.b.address, &user), shares);
    let p = s.amm.get_pair(&s.a.address, &s.b.address);
    assert_eq!(p.total_shares, 2_000_000);
    assert_eq!(s.a.balance(&s.amm.address), 4_000_000);
    assert_eq!(s.b.balance(&s.amm.address), 1_000_000);
}

#[test]
fn first_deposit_too_small_is_rejected() {
    let (s, user) = setup();
    let r = s.amm.try_add_liquidity(
        &user,
        &s.a.address,
        &s.b.address,
        &1_000,
        &1_000,
        &0,
        &0,
        &DEADLINE,
    );
    assert_eq!(r, Err(Ok(Error::InsufficientLiquidity)));
}

#[test]
fn second_deposit_only_takes_matching_ratio() {
    let (s, user) = setup();
    seed(&s, &user, 2_000_000, 1_000_000);
    let lp2 = Address::generate(&s.env);
    fund(&s, &lp2, 1_000_000);

    let (got_a, got_b, shares) = s.amm.add_liquidity(
        &lp2,
        &s.a.address,
        &s.b.address,
        &1_000_000,
        &1_000_000,
        &0,
        &0,
        &DEADLINE,
    );
    assert_eq!((got_a, got_b), (1_000_000, 500_000));
    assert!(shares > 0);
    // The extra 500_000 B stays with the provider.
    assert_eq!(s.b.balance(&lp2), 500_000);
}

#[test]
fn deposit_respects_caller_token_order() {
    let (s, user) = setup();
    seed(&s, &user, 2_000_000, 1_000_000);
    // Same deposit, tokens passed as (B, A): amounts must follow that order.
    let (got_b, got_a, _) = s.amm.add_liquidity(
        &user,
        &s.b.address,
        &s.a.address,
        &500_000,
        &5_000_000,
        &0,
        &0,
        &DEADLINE,
    );
    assert_eq!((got_b, got_a), (500_000, 1_000_000));
    assert_eq!(
        s.amm.get_reserves(&s.b.address, &s.a.address),
        (1_500_000, 3_000_000)
    );
}

#[test]
fn deposit_slippage_minimums() {
    let (s, user) = setup();
    seed(&s, &user, 2_000_000, 1_000_000);
    let r = s.amm.try_add_liquidity(
        &user,
        &s.a.address,
        &s.b.address,
        &1_000_000,
        &1_000_000,
        &0,
        &600_000,
        &DEADLINE,
    );
    assert_eq!(r, Err(Ok(Error::SlippageExceeded)));
}

#[test]
fn remove_all_returns_everything_but_locked_dust() {
    let (s, user) = setup();
    let before_a = s.a.balance(&user);
    let before_b = s.b.balance(&user);
    let shares = seed(&s, &user, 4_000_000, 1_000_000);
    let (out_a, out_b) = s.amm.remove_liquidity(
        &user,
        &s.a.address,
        &s.b.address,
        &shares,
        &0,
        &0,
        &DEADLINE,
    );
    // Locked shares (1000 of 2_000_000) keep 0.05 % of the reserves.
    assert_eq!((out_a, out_b), (3_998_000, 999_500));
    assert_eq!(s.a.balance(&user), before_a - 2_000);
    assert_eq!(s.b.balance(&user), before_b - 500);
    assert_eq!(s.amm.get_shares(&s.a.address, &s.b.address, &user), 0);
    assert_eq!(
        s.amm.get_pair(&s.a.address, &s.b.address).total_shares,
        MINIMUM_LIQUIDITY
    );
}

#[test]
fn remove_validation() {
    let (s, user) = setup();
    let shares = seed(&s, &user, 4_000_000, 1_000_000);
    let other = Address::generate(&s.env);
    let rm = |who: &Address, n: i128, min_a: i128, min_b: i128| {
        s.amm.try_remove_liquidity(
            who,
            &s.a.address,
            &s.b.address,
            &n,
            &min_a,
            &min_b,
            &DEADLINE,
        )
    };
    assert_eq!(rm(&user, 0, 0, 0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(
        rm(&user, shares + 1, 0, 0),
        Err(Ok(Error::InsufficientShares))
    );
    assert_eq!(rm(&other, 1, 0, 0), Err(Ok(Error::InsufficientShares)));
    assert_eq!(
        rm(&user, shares, 4_000_000, 0),
        Err(Ok(Error::SlippageExceeded))
    );
}

#[test]
fn liquidity_calls_require_provider_auth() {
    let (s, user) = setup();
    seed(&s, &user, 4_000_000, 1_000_000);
    let auths = s.env.auths();
    assert_eq!(auths[0].0, user);
    match &auths[0].1.function {
        AuthorizedFunction::Contract((_, name, _)) => {
            assert_eq!(name, &Symbol::new(&s.env, "add_liquidity"))
        }
        _ => panic!("unexpected auth"),
    }
}

// ── Swap ─────────────────────────────────────────────────────────────────────

#[test]
fn swap_moves_tokens_and_matches_quote() {
    let (s, user) = setup();
    seed(&s, &user, 1_000_000_000, 1_000_000_000);
    let trader = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.a.address).mint(&trader, &10_000_000);

    let quote = s
        .amm
        .get_amount_out(&s.a.address, &s.b.address, &10_000_000);
    let out = s.amm.swap_exact_in(
        &trader,
        &s.a.address,
        &s.b.address,
        &10_000_000,
        &quote,
        &DEADLINE,
    );
    assert_eq!(out, quote);
    assert_eq!(out, 9_871_580); // 1 % of pool, 0.3 % fee + price impact
    assert_eq!(s.a.balance(&trader), 0);
    assert_eq!(s.b.balance(&trader), out);
    assert_eq!(
        s.amm.get_reserves(&s.a.address, &s.b.address),
        (1_010_000_000, 1_000_000_000 - out)
    );
}

#[test]
fn swap_requires_user_auth_for_exact_call() {
    let (s, user) = setup();
    seed(&s, &user, 1_000_000_000, 1_000_000_000);
    s.amm
        .swap_exact_in(&user, &s.a.address, &s.b.address, &1_000, &0, &DEADLINE);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, user);
    match &auths[0].1.function {
        AuthorizedFunction::Contract((addr, name, args)) => {
            assert_eq!(addr, &s.amm.address);
            assert_eq!(name, &Symbol::new(&s.env, "swap_exact_in"));
            assert_eq!(args.len(), 6);
        }
        _ => panic!("unexpected auth"),
    }
}

#[test]
fn swap_cannot_spend_someone_elses_tokens() {
    let (s, user) = setup();
    seed(&s, &user, 1_000_000_000, 1_000_000_000);
    let attacker = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.amm.address,
            fn_name: "swap_exact_in",
            args: (
                &user,
                &s.a.address,
                &s.b.address,
                1_000i128,
                0i128,
                DEADLINE,
            )
                .into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    let r = s
        .amm
        .try_swap_exact_in(&user, &s.a.address, &s.b.address, &1_000, &0, &DEADLINE);
    assert!(r.is_err());
}

#[test]
fn swap_slippage_and_validation() {
    let (s, user) = setup();
    seed(&s, &user, 1_000_000_000, 1_000_000_000);
    let quote = s
        .amm
        .get_amount_out(&s.a.address, &s.b.address, &10_000_000);
    let swap = |amount: i128, min: i128, deadline: u64| {
        s.amm
            .try_swap_exact_in(&user, &s.a.address, &s.b.address, &amount, &min, &deadline)
    };
    assert_eq!(
        swap(10_000_000, quote + 1, DEADLINE),
        Err(Ok(Error::SlippageExceeded))
    );
    assert_eq!(swap(0, 0, DEADLINE), Err(Ok(Error::InvalidAmount)));
    assert_eq!(swap(-5, 0, DEADLINE), Err(Ok(Error::InvalidAmount)));
    assert_eq!(swap(10, -1, DEADLINE), Err(Ok(Error::InvalidAmount)));
    assert_eq!(swap(1, 0, DEADLINE), Err(Ok(Error::InsufficientLiquidity)));
    assert_eq!(swap(1_000, 0, NOW - 1), Err(Ok(Error::DeadlineExpired)));
    assert_eq!(
        s.amm
            .try_swap_exact_in(&user, &s.a.address, &s.a.address, &1_000, &0, &DEADLINE),
        Err(Ok(Error::IdenticalTokens))
    );
}

#[test]
fn swap_on_missing_or_empty_pair_fails() {
    let (s, user) = setup();
    assert_eq!(
        s.amm
            .try_swap_exact_in(&user, &s.a.address, &s.b.address, &1_000, &0, &DEADLINE),
        Err(Ok(Error::InsufficientLiquidity))
    );
    let (c, _) = new_token(&s.env, &s.admin);
    assert_eq!(
        s.amm
            .try_swap_exact_in(&user, &s.a.address, &c.address, &1_000, &0, &DEADLINE),
        Err(Ok(Error::PairNotFound))
    );
}

#[test]
fn fees_grow_lp_value_over_round_trips() {
    let (s, user) = setup();
    let shares = seed(&s, &user, 1_000_000_000, 1_000_000_000);
    let trader = Address::generate(&s.env);
    fund(&s, &trader, 1_000_000_000);
    let k0 = 1_000_000_000i128 * 1_000_000_000;

    for i in 0..20 {
        let (tin, tout) = if i % 2 == 0 {
            (&s.a.address, &s.b.address)
        } else {
            (&s.b.address, &s.a.address)
        };
        s.amm
            .swap_exact_in(&trader, tin, tout, &50_000_000, &0, &DEADLINE);
    }
    let p = s.amm.get_pair(&s.a.address, &s.b.address);
    assert!(p.reserve_a * p.reserve_b > k0, "fees must increase k");

    let (out_a, out_b) = s.amm.remove_liquidity(
        &user,
        &s.a.address,
        &s.b.address,
        &shares,
        &0,
        &0,
        &DEADLINE,
    );
    assert!(
        out_a + out_b > 2 * (1_000_000_000 - 1_000),
        "LP earned fees"
    );
    // The contract never holds less than its recorded reserves.
    let p = s.amm.get_pair(&s.a.address, &s.b.address);
    assert!(s.a.balance(&s.amm.address) >= p.reserve_a);
    assert!(s.b.balance(&s.amm.address) >= p.reserve_b);
}

// ── Pause ────────────────────────────────────────────────────────────────────

#[test]
fn pause_blocks_swaps_and_deposits_but_not_withdrawals() {
    let (s, user) = setup();
    let shares = seed(&s, &user, 4_000_000, 1_000_000);
    s.amm.set_paused(&true);
    assert!(s.amm.is_paused());
    assert_eq!(
        s.amm
            .try_swap_exact_in(&user, &s.a.address, &s.b.address, &1_000, &0, &DEADLINE),
        Err(Ok(Error::Paused))
    );
    assert_eq!(
        s.amm.try_add_liquidity(
            &user,
            &s.a.address,
            &s.b.address,
            &1_000,
            &1_000,
            &0,
            &0,
            &DEADLINE
        ),
        Err(Ok(Error::Paused))
    );
    s.amm.remove_liquidity(
        &user,
        &s.a.address,
        &s.b.address,
        &shares,
        &0,
        &0,
        &DEADLINE,
    );
    s.amm.set_paused(&false);
    assert!(!s.amm.is_paused());
}

#[test]
fn events_are_emitted() {
    let (s, user) = setup();
    seed(&s, &user, 1_000_000_000, 1_000_000_000);
    s.amm
        .swap_exact_in(&user, &s.a.address, &s.b.address, &1_000_000, &0, &DEADLINE);
    let from_amm = s
        .env
        .events()
        .all()
        .filter_by_contract(&s.amm.address)
        .events()
        .len();
    assert_eq!(from_amm, 1, "the swap emits exactly one AMM event");
}
