# AnchorSwap – Architecture

## Overview

AnchorSwap is a permissionless, constant-product Automated Market Maker (AMM) deployed as a Soroban smart contract on the Stellar network. The system is split into three layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User (Browser)                              │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    Next.js 15 Frontend                      │  │
│   │  SwapForm  │  AddLiquidityForm  │  RemoveLiquidityForm      │  │
│   └──────────────────────┬──────────────────────────────────────┘  │
│                          │ XDR envelope (unsigned)                  │
│   ┌──────────────────────▼──────────────────────────────────────┐  │
│   │           Freighter Wallet Extension (browser)              │  │
│   └──────────────────────┬──────────────────────────────────────┘  │
│                          │ Signed XDR envelope                     │
└──────────────────────────┼──────────────────────────────────────────┘
                           │ HTTPS / JSON-RPC
         ┌─────────────────▼──────────────────────┐
         │        Stellar Soroban RPC Node         │
         │  (soroban-testnet.stellar.org)          │
         └─────────────────┬──────────────────────┘
                           │ Transaction submission
         ┌─────────────────▼──────────────────────┐
         │         Stellar Consensus (SCP)         │
         │  Ledger closes every ~5 seconds         │
         └─────────────────┬──────────────────────┘
                           │ State updates
         ┌─────────────────▼──────────────────────┐
         │     AnchorSwap Soroban Contract         │
         │                                         │
         │  ┌──────────┐  ┌──────────┐            │
         │  │ AMM Core │  │ Storage  │            │
         │  │ (lib.rs) │  │ Keys     │            │
         │  └──────────┘  └──────────┘            │
         │  ┌──────────┐  ┌──────────┐            │
         │  │  Errors  │  │ Re-entry │            │
         │  │(error.rs)│  │  Guard   │            │
         │  └──────────┘  └──────────┘            │
         └─────────────────────────────────────────┘
```

---

## Component descriptions

### Frontend (Next.js 15 App Router)

| File | Purpose |
|------|---------|
| `app/page.tsx` | Landing page with protocol stats and feature cards |
| `app/swap/page.tsx` | Swap dashboard – delegates to `SwapForm` |
| `app/pool/page.tsx` | Pool browser – shows active pairs with live reserves |
| `app/pool/add/page.tsx` | Add liquidity workflow |
| `app/pool/remove/page.tsx` | Remove liquidity workflow |
| `components/SwapForm.tsx` | Token input/output, slippage, swap execution |
| `components/AddLiquidityForm.tsx` | Dual token input, share estimation, deposit |
| `components/RemoveLiquidityForm.tsx` | Slider-based LP share withdrawal |
| `components/PoolForm.tsx` | Tabbed Add/Remove container |
| `components/Header.tsx` / `Navbar.tsx` | Wallet connect, navigation |
| `components/PoolCard.tsx` | Pool statistics card |
| `components/TokenSelect.tsx` | Dropdown token picker |
| `lib/soroban.ts` | RPC simulation, transaction builders, formula helpers |
| `lib/wallet.tsx` | Freighter wallet context + `useWallet` hook |
| `lib/tokens.ts` | Well-known token registry |
| `hooks/usePairStats.ts` | Polling hook for live reserve data |

### Soroban Smart Contract (`contracts/anchorswap`)

| Module | Purpose |
|--------|---------|
| `lib.rs` | Contract entrypoint — `AnchorSwap` struct + all public functions |
| `storage.rs` | Type-safe `StorageKey` enum, typed get/set helpers, TTL management |
| `error.rs` | `ContractError` enum (`#[contracterror]`), 8 variants |
| `tests/unit.rs` | 15+ unit tests for individual invariants |
| `tests/integration.rs` | 5 end-to-end scenario tests |
| `test.rs` | Original comprehensive test file (preserved) |

---

## Data flow: Swap

```
User types amount → SwapForm calls computeSwapOut() locally (no RPC)
→ User clicks Swap
→ buildSwapTx() constructs TransactionBuilder with swap_exact_in call
→ server.prepareTransaction() estimates fee & fetches ledger sequence
→ Freighter.signTransaction() prompts user to approve
→ submitSignedTx() sends to Soroban RPC
→ Contract: require_not_locked() → lock()
→ canonical_pair() maps tokens to storage key
→ Uniswap v2 formula computes amount_out
→ assert(amount_out >= min_out)  ← slippage guard
→ token_in.transfer(user → contract)
→ token_out.transfer(contract → user)
→ update reserves
→ emit Swapped event
→ unlock()
→ RPC returns tx hash
→ Frontend shows success + stellar.expert link
```

## Data flow: Add Liquidity

```
User selects pair + amounts → AddLiquidityForm fetches reserves via simulation
→ Auto-fills second input to match current ratio
→ Estimates LP shares (sqrt formula or proportional formula)
→ buildAddLiquidityTx() constructs add_liquidity call
→ Signed + submitted via Freighter
→ Contract: lock → validate → compute shares → transfer tokens → mint shares → unlock
→ Emits LiquidityAdded event
```

## Data flow: Remove Liquidity

```
User selects pair + slider percentage → estimated returns computed locally
→ buildRemoveLiquidityTx() with share_amount + 1% slippage min values
→ Contract: lock → check user balance → compute proportional amounts
→ Enforce min_a / min_b slippage guards
→ Burn shares → transfer tokens → unlock
→ Emits LiquidityRemoved event
```

---

## Storage layout

```
Instance storage (fast, low cost, lives with contract instance TTL):
  Admin              → Address
  Locked             → bool
  ReserveA(pair)     → i128
  ReserveB(pair)     → i128
  TotalShares(pair)  → i128   ← also doubles as "pair exists" flag

Persistent storage (survives ledger eviction, has explicit TTL bumps):
  ShareBalance(pair, user)  → i128
  TTL: 6,307,200 ledgers (~1 year at 5s/ledger)
  Threshold: 3,153,600 ledgers (bump when below half)
```

---

## Security model

| Mechanism | Implementation |
|-----------|---------------|
| Re-entrancy guard | `Locked` bool in instance storage; `require_not_locked()` panics if already set; `lock()` / `unlock()` wrap every state-mutating function |
| Slippage protection | Caller-supplied `min_share`, `min_a`, `min_b`, `min_out` checked before any state mutation |
| Canonical token ordering | XDR byte-comparison in `canonical_pair()` prevents duplicate pairs and ensures deterministic storage keys |
| Checked arithmetic | All multiplications and additions use `.checked_mul()` / `.checked_add()` / `.checked_sub()` with explicit `expect()` messages |
| Auth | `provider.require_auth()` / `user.require_auth()` on all state-mutating calls; `admin.require_auth()` for `upgrade()` |
| Upgrade restriction | WASM upgrade is gated behind admin authentication only |
