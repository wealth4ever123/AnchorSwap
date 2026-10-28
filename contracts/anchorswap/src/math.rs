//! Pure AMM math. No storage access, so it is easy to test exhaustively.
//!
//! Every division rounds down, which always favours the pool over the caller.

use crate::error::Error;

/// Swap fee in basis points (0.30 %). The fee stays in the pool for LPs.
pub const FEE_BPS: i128 = 30;
pub const BPS: i128 = 10_000;

/// Shares burned forever on the first deposit. Stops the "first depositor
/// inflation" attack where a tiny initial deposit makes one share so valuable
/// that later depositors round down to zero shares.
pub const MINIMUM_LIQUIDITY: i128 = 1_000;

fn mul(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_mul(b).ok_or(Error::Overflow)
}

fn add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::Overflow)
}

fn div(a: i128, b: i128) -> Result<i128, Error> {
    if b == 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(a / b)
}

/// Floor integer square root (Newton's method). Returns 0 for n <= 0.
pub fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    // (x + 1) / 2 without overflowing at i128::MAX.
    let mut y = x / 2 + x % 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Output for an exact input, after the fee:
/// `out = in*(1-fee)*r_out / (r_in + in*(1-fee))`.
pub fn amount_out(amount_in: i128, reserve_in: i128, reserve_out: i128) -> Result<i128, Error> {
    if amount_in <= 0 {
        return Err(Error::InvalidAmount);
    }
    if reserve_in <= 0 || reserve_out <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let in_with_fee = mul(amount_in, BPS - FEE_BPS)?;
    let numerator = mul(in_with_fee, reserve_out)?;
    let denominator = add(mul(reserve_in, BPS)?, in_with_fee)?;
    div(numerator, denominator)
}

/// Amount of B that has the same value as `amount_a` at the current price.
pub fn quote(amount_a: i128, reserve_a: i128, reserve_b: i128) -> Result<i128, Error> {
    if amount_a <= 0 {
        return Err(Error::InvalidAmount);
    }
    if reserve_a <= 0 || reserve_b <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    div(mul(amount_a, reserve_b)?, reserve_a)
}

/// Result of working out a deposit: what is actually taken and what is minted.
#[derive(Debug, PartialEq, Eq)]
pub struct Deposit {
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
    /// Shares locked forever (only non-zero on the first deposit).
    pub locked: i128,
}

/// Work out a deposit, Uniswap-v2-router style: never take more than the
/// pool's current ratio needs, so extra tokens are not silently donated.
#[allow(clippy::too_many_arguments)]
pub fn deposit(
    a_desired: i128,
    b_desired: i128,
    a_min: i128,
    b_min: i128,
    reserve_a: i128,
    reserve_b: i128,
    total_shares: i128,
) -> Result<Deposit, Error> {
    if a_desired <= 0 || b_desired <= 0 || a_min < 0 || b_min < 0 {
        return Err(Error::InvalidAmount);
    }

    if total_shares == 0 {
        let root = isqrt(mul(a_desired, b_desired)?);
        if root <= MINIMUM_LIQUIDITY {
            return Err(Error::InsufficientLiquidity);
        }
        return Ok(Deposit {
            amount_a: a_desired,
            amount_b: b_desired,
            shares: root - MINIMUM_LIQUIDITY,
            locked: MINIMUM_LIQUIDITY,
        });
    }

    let (amount_a, amount_b) = {
        let b_optimal = quote(a_desired, reserve_a, reserve_b)?;
        if b_optimal <= b_desired {
            if b_optimal < b_min {
                return Err(Error::SlippageExceeded);
            }
            (a_desired, b_optimal)
        } else {
            let a_optimal = quote(b_desired, reserve_b, reserve_a)?;
            // a_optimal <= a_desired holds whenever b_optimal > b_desired,
            // apart from rounding, so clamp defensively.
            if a_optimal > a_desired || a_optimal < a_min {
                return Err(Error::SlippageExceeded);
            }
            (a_optimal, b_desired)
        }
    };

    let shares_a = div(mul(amount_a, total_shares)?, reserve_a)?;
    let shares_b = div(mul(amount_b, total_shares)?, reserve_b)?;
    let shares = shares_a.min(shares_b);
    if shares <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(Deposit {
        amount_a,
        amount_b,
        shares,
        locked: 0,
    })
}

/// Tokens returned for burning `shares`.
pub fn withdraw(
    shares: i128,
    reserve_a: i128,
    reserve_b: i128,
    total_shares: i128,
) -> Result<(i128, i128), Error> {
    if shares <= 0 {
        return Err(Error::InvalidAmount);
    }
    if total_shares <= 0 || shares > total_shares {
        return Err(Error::InsufficientLiquidity);
    }
    Ok((
        div(mul(shares, reserve_a)?, total_shares)?,
        div(mul(shares, reserve_b)?, total_shares)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isqrt_exact_and_floor() {
        assert_eq!(isqrt(-5), 0);
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(2), 1);
        assert_eq!(isqrt(3), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(99), 9);
        assert_eq!(isqrt(1_000_000), 1_000);
        let big = (i64::MAX as i128) * (i64::MAX as i128);
        assert_eq!(isqrt(big), i64::MAX as i128);
        for n in 0..5_000i128 {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "n={n}");
        }
    }

    #[test]
    fn amount_out_matches_formula() {
        // 1000 in against 1e6/1e6: 1000*9970*1e6 / (1e6*1e4 + 1000*9970)
        assert_eq!(amount_out(1_000, 1_000_000, 1_000_000), Ok(996));
        assert_eq!(amount_out(1, 1_000_000, 1_000_000), Ok(0));
    }

    #[test]
    fn amount_out_rejects_bad_input() {
        assert_eq!(amount_out(0, 10, 10), Err(Error::InvalidAmount));
        assert_eq!(amount_out(-1, 10, 10), Err(Error::InvalidAmount));
        assert_eq!(amount_out(1, 0, 10), Err(Error::InsufficientLiquidity));
        assert_eq!(amount_out(1, 10, 0), Err(Error::InsufficientLiquidity));
        assert_eq!(amount_out(i128::MAX, 10, 10), Err(Error::Overflow));
    }

    #[test]
    fn amount_out_never_drains_pool_and_k_grows() {
        let (ri, ro) = (5_000_000_000i128, 7_000_000_000i128);
        let mut x = 12_345i128;
        for _ in 0..2_000 {
            x = (x * 1_103_515_245 + 12_345) % 900_000_000_000 + 1;
            let out = amount_out(x, ri, ro).unwrap();
            assert!(out < ro);
            assert!((ri + x) * (ro - out) >= ri * ro, "k decreased for in={x}");
        }
    }

    #[test]
    fn first_deposit_locks_minimum_liquidity() {
        let d = deposit(4_000_000, 1_000_000, 0, 0, 0, 0, 0).unwrap();
        assert_eq!(d.shares, 2_000_000 - MINIMUM_LIQUIDITY);
        assert_eq!(d.locked, MINIMUM_LIQUIDITY);
        assert_eq!(
            deposit(1_000, 1_000, 0, 0, 0, 0, 0),
            Err(Error::InsufficientLiquidity)
        );
    }

    #[test]
    fn later_deposit_uses_pool_ratio() {
        // Pool 2:1. Offering 100 A and 100 B should take 100 A + 50 B.
        let d = deposit(100, 100, 0, 0, 2_000, 1_000, 1_414).unwrap();
        assert_eq!((d.amount_a, d.amount_b), (100, 50));
        assert_eq!(d.shares, 70);
        // Offering 1000 A and 10 B is limited by B: 20 A + 10 B.
        let d = deposit(1_000, 10, 0, 0, 2_000, 1_000, 1_414).unwrap();
        assert_eq!((d.amount_a, d.amount_b), (20, 10));
    }

    #[test]
    fn later_deposit_respects_minimums() {
        assert_eq!(
            deposit(100, 100, 0, 60, 2_000, 1_000, 1_414),
            Err(Error::SlippageExceeded)
        );
        assert_eq!(
            deposit(1_000, 10, 30, 0, 2_000, 1_000, 1_414),
            Err(Error::SlippageExceeded)
        );
        assert_eq!(
            deposit(1, 1, 0, 0, 2_000_000, 1_000_000, 1_000),
            Err(Error::InsufficientLiquidity),
            "dust that mints zero shares must be rejected"
        );
    }

    #[test]
    fn withdraw_is_proportional_and_rounds_down() {
        assert_eq!(withdraw(500, 3_001, 1_000, 1_000), Ok((1_500, 500)));
        assert_eq!(withdraw(1, 3, 3, 2), Ok((1, 1)));
        assert_eq!(withdraw(0, 1, 1, 1), Err(Error::InvalidAmount));
        assert_eq!(withdraw(2, 1, 1, 1), Err(Error::InsufficientLiquidity));
    }
}
