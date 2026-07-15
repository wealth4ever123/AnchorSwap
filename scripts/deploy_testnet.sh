#!/usr/bin/env bash
# =============================================================================
# scripts/deploy_testnet.sh
#
# AnchorSwap – Testnet compile, deploy, and initialisation script.
#
# Prerequisites:
#   • Rust toolchain + cargo (rustup)
#   • soroban-cli  ≥ 0.9  (https://soroban.stellar.org/docs/reference/soroban-cli)
#   • A funded Stellar Testnet account ($DEPLOYER_SECRET)
#
# Usage:
#   export DEPLOYER_SECRET=S...
#   bash scripts/deploy_testnet.sh
#
# After the script finishes:
#   • NEXT_PUBLIC_ANCHORSWAP_CONTRACT is written to frontend/.env.local
#   • The default XLM/USDC pair is initialised on Testnet
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── Configuration ─────────────────────────────────────────────────────────────

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
FRIENDBOT_URL="https://friendbot.stellar.org"

# Well-known Soroban Testnet token contract IDs (adjust if you deploy your own).
# Wrapped XLM (native):
TESTNET_XLM="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
# USDC issued by Circle on Testnet:
TESTNET_USDC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="${REPO_ROOT}/contracts/anchorswap"
WASM_PATH="${REPO_ROOT}/target/wasm32-unknown-unknown/release/anchorswap.wasm"
ENV_FILE="${REPO_ROOT}/frontend/.env.local"

# ── Guard: DEPLOYER_SECRET must be set ───────────────────────────────────────

if [[ -z "${DEPLOYER_SECRET:-}" ]]; then
  die "DEPLOYER_SECRET environment variable is not set.\nExport your Stellar secret key: export DEPLOYER_SECRET=S..."
fi

# Derive the public key from the secret key.
DEPLOYER_PUB=$(soroban keys generate --global deployer --secret-key "${DEPLOYER_SECRET}" --overwrite 2>/dev/null \
  || soroban keys public deployer)

log "Deployer: ${DEPLOYER_PUB}"

# ── Step 1: Install wasm32 target ─────────────────────────────────────────────

log "Step 1/5 – Ensuring wasm32-unknown-unknown target is installed…"
if ! rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
  rustup target add wasm32-unknown-unknown
  log "  ✓ wasm32-unknown-unknown installed"
else
  log "  ✓ wasm32-unknown-unknown already installed"
fi

# ── Step 2: Compile the contract ──────────────────────────────────────────────

log "Step 2/5 – Compiling AnchorSwap contract (release)…"
cd "${REPO_ROOT}"

# Use soroban contract build if available (wraps cargo), otherwise fall back
# to a plain cargo build with the correct target.
if soroban contract build --help &>/dev/null; then
  soroban contract build \
    --package anchorswap \
    --profile release
else
  cargo build \
    --target wasm32-unknown-unknown \
    --release \
    --package anchorswap
fi

if [[ ! -f "${WASM_PATH}" ]]; then
  die "WASM artefact not found at ${WASM_PATH}"
fi

WASM_SIZE=$(wc -c < "${WASM_PATH}")
log "  ✓ Compiled (${WASM_SIZE} bytes): ${WASM_PATH}"

# ── Step 3: Fund deployer (friendbot) ────────────────────────────────────────

log "Step 3/5 – Funding deployer account via Friendbot (idempotent)…"
curl -s "${FRIENDBOT_URL}?addr=${DEPLOYER_PUB}" > /dev/null && log "  ✓ Funded (or already funded)"

# ── Step 4: Deploy contract WASM ─────────────────────────────────────────────

log "Step 4/5 – Deploying AnchorSwap WASM to Testnet…"

CONTRACT_ID=$(soroban contract deploy \
  --wasm "${WASM_PATH}" \
  --source deployer \
  --network "${NETWORK}" \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}")

if [[ -z "${CONTRACT_ID}" ]]; then
  die "Deployment failed – no contract ID returned"
fi

log "  ✓ Contract deployed: ${CONTRACT_ID}"

# ── Step 4a: Initialise the contract (set admin) ─────────────────────────────

log "  Initialising contract (admin = deployer)…"
soroban contract invoke \
  --id "${CONTRACT_ID}" \
  --source deployer \
  --network "${NETWORK}" \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}" \
  -- initialize \
  --admin "${DEPLOYER_PUB}"

log "  ✓ Contract initialised"

# ── Step 4b: Write contract ID to frontend/.env.local ─────────────────────────

log "  Writing env var to ${ENV_FILE}…"
mkdir -p "$(dirname "${ENV_FILE}")"

# Preserve existing env vars and upsert NEXT_PUBLIC_ANCHORSWAP_CONTRACT.
if [[ -f "${ENV_FILE}" ]]; then
  grep -v "^NEXT_PUBLIC_ANCHORSWAP_CONTRACT=" "${ENV_FILE}" > "${ENV_FILE}.tmp" || true
  mv "${ENV_FILE}.tmp" "${ENV_FILE}"
fi

echo "NEXT_PUBLIC_ANCHORSWAP_CONTRACT=${CONTRACT_ID}" >> "${ENV_FILE}"
log "  ✓ ${ENV_FILE} updated"

# ── Step 5: Initialise the default XLM/USDC pair ─────────────────────────────

log "Step 5/5 – Initialising default XLM/USDC pair…"

soroban contract invoke \
  --id "${CONTRACT_ID}" \
  --source deployer \
  --network "${NETWORK}" \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}" \
  -- init_pair \
  --token_a "${TESTNET_XLM}" \
  --token_b "${TESTNET_USDC}"

log "  ✓ XLM/USDC pair created"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  AnchorSwap deployed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Contract ID : ${CONTRACT_ID}"
echo "  Network     : ${NETWORK}"
echo "  Explorer    : https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}"
echo ""
echo "  Next steps:"
echo "    cd frontend && npm install && npm run dev"
echo ""
