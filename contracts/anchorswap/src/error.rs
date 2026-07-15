//! AnchorSwap – Custom contract error codes.
//!
//! All public entry-points that can fail in a recoverable way return
//! `Result<T, ContractError>`.  The `#[contracterror]` macro generates the
//! XDR binding so that callers can match on the strongly-typed enum rather
//! than raw integer codes.

use soroban_sdk::contracterror;

/// Exhaustive set of failure modes for the AnchorSwap AMM contract.
///
/// Each variant maps to a stable numeric discriminant that is embedded in the
/// contract's ABI; **do not reorder or renumber existing variants** once
/// deployed, as that would break backward compatibility with stored events and
/// client error-matching code.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ContractError {
    /// Attempted to call `init_pair` for a token pair that was already
    /// registered.  Each `(token_a, token_b)` canonical pair may only be
    /// created once.
    PairAlreadyExists = 1,

    /// A state-mutating operation (swap, add/remove liquidity) was called for
    /// a pair that has never been initialised via `init_pair`.
    PairNotFound = 2,

    /// The `amount_a` or `amount_b` argument passed to `add_liquidity` was
    /// zero or negative, or the geometric-mean share calculation produced a
    /// zero result (e.g. both inputs are 1 stroop and their product rounds
    /// down).
    InvalidLiquidityAmount = 3,

    /// The minimum acceptable output (share, token_a, token_b, or swap output)
    /// specified by the caller could not be satisfied given the current pool
    /// state.  The transaction is reverted without any state changes.
    SlippageExceeded = 4,

    /// Either the pool is completely empty (total_shares == 0) or the caller
    /// is trying to withdraw more shares than they own.
    InsufficientLiquidity = 5,

    /// A re-entrant call was detected.  The contract's boolean lock flag was
    /// set when another invocation tried to enter a guarded function.
    ReentrancyGuardTriggered = 6,

    /// The two token addresses supplied are identical; a pair must consist of
    /// two *distinct* tokens.
    InvalidTokenOrder = 7,

    /// A required numeric argument (e.g. `amount_in`, `min_out`) was zero.
    ZeroAmount = 8,
}
