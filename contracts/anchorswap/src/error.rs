use soroban_sdk::contracterror;

/// Every failure the contract can return.
///
/// The numbers are part of the public ABI (clients match on them), so never
/// reorder or reuse them.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    PairAlreadyExists = 1,
    PairNotFound = 2,
    IdenticalTokens = 3,
    /// An amount argument was zero or negative.
    InvalidAmount = 4,
    /// The result would be worse than the caller's minimum.
    SlippageExceeded = 5,
    InsufficientLiquidity = 6,
    InsufficientShares = 7,
    /// `deadline` (ledger timestamp, seconds) has passed.
    DeadlineExpired = 8,
    /// Swaps and deposits are paused by the admin. Withdrawals still work.
    Paused = 9,
    /// An intermediate value overflowed i128.
    Overflow = 10,
    /// Too many pairs registered (see `MAX_PAIRS`).
    TooManyPairs = 11,
}
