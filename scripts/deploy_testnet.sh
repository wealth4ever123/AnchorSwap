#!/usr/bin/env bash
# Deploy AnchorSwap to Stellar Testnet and seed an XLM/ANC pool.
#
# Requires: stellar-cli >= 25.2 (https://developers.stellar.org/docs/tools/cli),
#           Rust with the wasm32v1-none target, curl, python3.
#
# Creates (or reuses) two testnet identities in the stellar-cli key store
# (~/.config/stellar, never inside this repo):
#   anchorswap-deployer  admin of the AMM and first liquidity provider
#   anchorswap-issuer    issuer of the ANC test asset
#
# Writes:
#   frontend/src/config/testnet.json   public contract IDs used by the web app,
#                                      committed so anyone can verify them
#
# Usage: bash scripts/deploy_testnet.sh
# Env overrides: DEPLOYER, ISSUER, SEED_XLM, SEED_ANC (whole units)

set -euo pipefail

NETWORK=testnet
DEPLOYER=${DEPLOYER:-anchorswap-deployer}
ISSUER=${ISSUER:-anchorswap-issuer}
ASSET_CODE=ANC
SEED_XLM=${SEED_XLM:-2000}
SEED_ANC=${SEED_ANC:-10000}
STROOPS=10000000

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM="$ROOT/target/wasm32v1-none/release/anchorswap.wasm"

log() { printf '\033[0;32m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

command -v stellar >/dev/null || die "stellar-cli not found"

ensure_key() {
  if ! stellar keys address "$1" >/dev/null 2>&1; then
    log "Creating testnet identity $1"
    stellar keys generate "$1" --network "$NETWORK" --fund
  else
    stellar keys fund "$1" --network "$NETWORK" >/dev/null 2>&1 || true
  fi
}

invoke() {
  stellar contract invoke --id "$AMM" --source-account "$DEPLOYER" --network "$NETWORK" -- "$@"
}

# 1. Identities
ensure_key "$DEPLOYER"
ensure_key "$ISSUER"
DEPLOYER_ADDR=$(stellar keys address "$DEPLOYER")
ISSUER_ADDR=$(stellar keys address "$ISSUER")
ASSET="$ASSET_CODE:$ISSUER_ADDR"
log "Deployer $DEPLOYER_ADDR"
log "Issuer   $ISSUER_ADDR"

# 2. Token contracts (Stellar Asset Contracts)
XLM_SAC=$(stellar contract id asset --asset native --network "$NETWORK")
ANC_SAC=$(stellar contract id asset --asset "$ASSET" --network "$NETWORK")
stellar contract asset deploy --asset "$ASSET" --source-account "$ISSUER" --network "$NETWORK" \
  >/dev/null 2>&1 || log "ANC asset contract already deployed"
log "XLM contract $XLM_SAC"
log "ANC contract $ANC_SAC"

# 3. Give the deployer ANC to provide liquidity with
stellar tx new change-trust --source-account "$DEPLOYER" --line "$ASSET" --network "$NETWORK" >/dev/null
stellar tx new payment --source-account "$ISSUER" --destination "$DEPLOYER_ADDR" \
  --asset "$ASSET" --amount $(( SEED_ANC * 2 * STROOPS )) --network "$NETWORK" >/dev/null
log "Sent $(( SEED_ANC * 2 )) ANC to deployer"

# 4. Build and deploy the AMM (constructor sets the admin atomically)
log "Building contract"
(cd "$ROOT" && stellar contract build --package anchorswap >/dev/null)
[[ -f "$WASM" ]] || die "WASM not found at $WASM"
AMM=$(stellar contract deploy --wasm "$WASM" --source-account "$DEPLOYER" --network "$NETWORK" \
  --alias anchorswap -- --admin "$DEPLOYER_ADDR")
log "AnchorSwap contract $AMM"

# 5. Create and seed the XLM/ANC pool
invoke create_pair --token_a "$XLM_SAC" --token_b "$ANC_SAC" >/dev/null
DEADLINE=$(( $(date +%s) + 600 ))
invoke add_liquidity --provider "$DEPLOYER_ADDR" \
  --token_a "$XLM_SAC" --token_b "$ANC_SAC" \
  --amount_a_desired $(( SEED_XLM * STROOPS )) --amount_b_desired $(( SEED_ANC * STROOPS )) \
  --amount_a_min 0 --amount_b_min 0 --deadline "$DEADLINE"
log "Seeded pool with $SEED_XLM XLM / $SEED_ANC ANC"
log "Reserves (XLM, ANC): $(invoke get_reserves --token_a "$XLM_SAC" --token_b "$ANC_SAC")"

# 6. Write config (public IDs only, never secrets)
CONFIG="$ROOT/frontend/src/config/testnet.json"
mkdir -p "$(dirname "$CONFIG")"
cat > "$CONFIG" <<EOF
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "anchorswap": "$AMM",
  "admin": "$DEPLOYER_ADDR",
  "tokens": {
    "XLM": { "contract": "$XLM_SAC", "asset": "native" },
    "ANC": { "contract": "$ANC_SAC", "asset": "$ASSET" }
  },
  "pools": [["XLM", "ANC"]]
}
EOF
log "Wrote $CONFIG"
log "Explorer: https://stellar.expert/explorer/testnet/contract/$AMM"
