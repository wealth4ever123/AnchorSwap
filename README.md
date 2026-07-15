# ⚓ AnchorSwap

> A permissionless, constant-product AMM DEX on Stellar/Soroban — swap, pool, and earn.

[![CI](https://github.com/your-org/anchorswap/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/anchorswap/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

AnchorSwap fills Stellar's biggest DeFi gap — on-chain trustless liquidity —
by letting anyone create a token pair, provide liquidity, earn LP shares, and
swap tokens with a 0.3 % fee. The contract is fully permissionless (no
admin-gated pair creation) and composable, so other Soroban dApps can route
swaps programmatically.

---

## Table of Contents

- [Features](#features)
- [Project Layout](#project-layout)
- [Environment Variables](#environment-variables)
- [Local Setup](#local-setup)
- [Running Tests](#running-tests)
- [Testnet Deployment](#testnet-deployment)
- [Frontend Development](#frontend-development)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Feature | Details |
|---------|---------|
| **Constant-product AMM** | x·y=k formula, 0.3 % swap fee retained in pool |
| **Permissionless pairs** | Anyone may call `init_pair` — no governance required |
| **LP shares** | First LP receives `√(a×b)` shares; subsequent LPs receive proportional shares |
| **Slippage protection** | Every state-mutating call accepts a caller-supplied minimum output |
| **Re-entrancy guard** | Boolean lock in instance storage prevents cross-contract re-entry |
| **Composable** | Other Soroban contracts can call `swap_exact_in` as a sub-call |
| **Upgradeable** | Admin-gated WASM upgrade via `e.deployer().update_current_contract_wasm()` |
| **Modern frontend** | Next.js 15 App Router, glassmorphism UI, Freighter wallet integration |

---

## Project Layout

```
anchorswap/
├── contracts/
│   ├── anchorswap/
│   │   ├── src/
│   │   │   ├── lib.rs          # Contract entrypoint – all public functions
│   │   │   ├── error.rs        # ContractError enum (8 typed error codes)
│   │   │   ├── storage.rs      # StorageKey enum + typed get/set helpers
│   │   │   ├── test.rs         # Comprehensive original test suite
│   │   │   └── tests/
│   │   │       ├── mod.rs      # Test module root
│   │   │       ├── unit.rs     # 15+ unit tests
│   │   │       └── integration.rs  # 5 end-to-end scenario tests
│   │   ├── Cargo.toml
│   │   └── soroban.toml        # Contract manifest + network targets
│   └── token/
│       ├── src/lib.rs          # SEP-41 token contract (test fixture + deployable)
│       └── Cargo.toml
├── frontend/
│   ├── src/
│   │   ├── app/                # Next.js 15 App Router pages
│   │   │   ├── page.tsx        # Landing / home page
│   │   │   ├── layout.tsx      # Root layout (WalletProvider + Navbar)
│   │   │   ├── globals.css     # Glassmorphism theme + Tailwind base
│   │   │   ├── swap/page.tsx   # Swap dashboard
│   │   │   └── pool/
│   │   │       ├── page.tsx    # Pool browser
│   │   │       ├── add/page.tsx
│   │   │       └── remove/page.tsx
│   │   ├── components/
│   │   │   ├── Header.tsx      # Wallet connector & navigation
│   │   │   ├── Navbar.tsx      # Sticky top nav (alias of Header)
│   │   │   ├── SwapForm.tsx    # Exact-input swap UI
│   │   │   ├── PoolForm.tsx    # Tabbed Add/Remove liquidity container
│   │   │   ├── AddLiquidityForm.tsx
│   │   │   ├── RemoveLiquidityForm.tsx
│   │   │   ├── PoolCard.tsx    # Per-pair statistics card
│   │   │   └── TokenSelect.tsx # Dropdown token picker
│   │   ├── hooks/
│   │   │   └── usePairStats.ts # Polling hook for live reserve data
│   │   └── lib/
│   │       ├── soroban.ts      # RPC client, tx builders, formula helpers
│   │       ├── wallet.tsx      # Freighter context + useWallet hook
│   │       └── tokens.ts       # Well-known testnet token registry
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── next.config.js
│   └── next.config.mjs
├── scripts/
│   └── deploy_testnet.sh       # One-command compile → deploy → init
├── .github/
│   └── workflows/
│       └── ci.yml              # Format / lint / test / build pipeline
├── docs/
│   ├── architecture.md         # System flowchart and component descriptions
│   ├── api_reference.md        # Complete function signatures and event schemas
│   └── design_decisions.md     # Math proofs and storage rationale
├── Cargo.toml                  # Workspace root
├── README.md
└── LICENSE                     # Apache-2.0
```

---

## Environment Variables

Create `frontend/.env.local` (auto-generated by the deploy script):

```bash
# Contract ID of the deployed AnchorSwap AMM on Testnet
NEXT_PUBLIC_ANCHORSWAP_CONTRACT=C...

# Optional: override the contract ID alias used in soroban.ts
NEXT_PUBLIC_CONTRACT_ID=C...

# Optional: custom ANC token contract ID
NEXT_PUBLIC_ANC_TOKEN=C...
```

---

## Local Setup

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | ≥ 1.78 | `curl https://sh.rustup.rs -sSf \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| soroban-cli | ≥ 0.9 | `cargo install --locked soroban-cli` |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | Bundled with Node.js |
| Freighter wallet | latest | [freighter.app](https://www.freighter.app) |

### 1. Clone the repository

```bash
git clone https://github.com/your-org/anchorswap.git
cd anchorswap
```

### 2. Build the contract (native, for tests)

```bash
cargo build --workspace
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
```

### 4. Start the development server

```bash
npm run dev
# → http://localhost:3000
```

---

## Running Tests

### Contract unit and integration tests

```bash
# From the workspace root
cargo test --features testutils --workspace
```

Run only the unit tests:

```bash
cargo test --features testutils -- unit
```

Run only the integration tests:

```bash
cargo test --features testutils -- integration
```

Run with output for debugging:

```bash
cargo test --features testutils -- --nocapture
```

### Frontend checks

```bash
cd frontend

# Type-check
npm run type-check

# Lint
npm run lint

# Production build
npm run build
```

---

## Testnet Deployment

### One-command deploy

```bash
export DEPLOYER_SECRET=S...   # Your Stellar testnet secret key

bash scripts/deploy_testnet.sh
```

The script will:

1. Install the `wasm32-unknown-unknown` Rust target if missing.
2. Compile the contract to WASM (release profile).
3. Fund the deployer account via Friendbot.
4. Deploy the WASM and call `initialize(admin)`.
5. Write `NEXT_PUBLIC_ANCHORSWAP_CONTRACT=<id>` to `frontend/.env.local`.
6. Call `init_pair` to register the default XLM/USDC pair.

### Manual deploy steps

```bash
# 1. Build
cargo build --target wasm32-unknown-unknown --release --package anchorswap

# 2. Deploy
CONTRACT_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/anchorswap.wasm \
  --source <deployer-key-name> \
  --network testnet)

# 3. Initialize
soroban contract invoke \
  --id $CONTRACT_ID \
  --source <deployer-key-name> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>

# 4. Create a pair
soroban contract invoke \
  --id $CONTRACT_ID \
  --source <deployer-key-name> \
  --network testnet \
  -- init_pair \
  --token_a CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --token_b CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

---

## Frontend Development

After deploying, run the dev server:

```bash
cd frontend
npm run dev
```

Navigate to:

- **`/`** — Landing page with feature overview
- **`/swap`** — Token swap interface
- **`/pool`** — Liquidity pools browser
- **`/pool/add`** — Add liquidity form
- **`/pool/remove`** — Remove liquidity form

Connect your [Freighter](https://www.freighter.app) browser extension and switch it to **Testnet** before interacting.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/architecture.md`](./docs/architecture.md) | System architecture flowchart, component table, data flow diagrams |
| [`docs/api_reference.md`](./docs/api_reference.md) | Complete function signatures, return types, error codes, events |
| [`docs/design_decisions.md`](./docs/design_decisions.md) | AMM math proofs, storage tier choices, security model |

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes and run `cargo test --features testutils` + `cd frontend && npm run lint && npm run type-check`.
4. Commit and open a pull request against `main`.

The CI pipeline runs automatically on every PR.

---

## License

Apache-2.0 — see [LICENSE](./LICENSE) for details.
