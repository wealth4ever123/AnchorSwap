//! AnchorSwap test suite.
//!
//! This module re-exports the two test sub-modules so they are picked up by
//! `cargo test --features testutils`.

#[cfg(test)]
mod unit;

#[cfg(test)]
mod integration;
