# Deployment

## Contract on Testnet

Requirements: Rust (stable) with `wasm32v1-none`
(`rustup target add wasm32v1-none`), stellar-cli 25.2 or newer, `curl`.

```bash
bash scripts/deploy_testnet.sh
```

The script:

1. Creates (or reuses) two testnet identities in stellar-cli's key store
   (`~/.config/stellar`, outside the repo) and funds them with Friendbot:
   `anchorswap-deployer` (admin and first liquidity provider) and
   `anchorswap-issuer` (issues the ANC test asset).
2. Deploys the Stellar Asset Contract for ANC and looks up the native XLM one.
3. Sends ANC from the issuer to the deployer.
4. Builds the contract and deploys it, with the deployer as admin.
5. Creates the XLM/ANC pool and seeds it with 2,000 XLM and 10,000 ANC
   (change with `SEED_XLM` / `SEED_ANC`).
6. Writes the public IDs to `frontend/src/config/testnet.json`.

Commit the updated `testnet.json` so the app and everyone else use the new
deployment. Re-run the end-to-end tests to confirm it works:

```bash
cd frontend && npm run test:testnet
```

Running the script again deploys a **new** contract (with a new ID) and a
new pool. The old one stays on-chain.

### Creating more pools

```bash
stellar contract invoke --id <CONTRACT> --source anchorswap-deployer --network testnet -- \
  create_pair --token_a <TOKEN_A_CONTRACT> --token_b <TOKEN_B_CONTRACT>
```

Then add the tokens to `TOKENS` in `frontend/src/lib/tokens.ts`. The app
only shows pools whose tokens are both in that list.

## Hosting the frontend

The app is a static-friendly Next.js app with no server-side secrets.

```bash
cd frontend
npm ci
npm run build
npm start            # or deploy to Vercel / Netlify / any Node host
```

Optional environment variables are listed in
[`frontend/.env.example`](../frontend/.env.example). They are all public
(`NEXT_PUBLIC_*`). Never add a secret key.

## Before Mainnet

Testnet is fine as-is. Mainnet needs at least the following:

- [ ] Independent security audit of the contract.
- [ ] Admin set to a multisig account or governance contract, not a single key (`set_admin` needs both the old and new admin to sign).
- [ ] Decide whether `upgrade` should exist at all, or be time-locked.
- [ ] Choose tokens carefully. Only standard Stellar Asset Contracts or audited tokens that move exactly the requested amount.
- [ ] Seed pools with enough liquidity for reasonable price impact.
- [ ] Set `NEXT_PUBLIC_NETWORK_PASSPHRASE`, the RPC, Horizon and explorer URLs to Mainnet values. Point the token list and `testnet.json` equivalent at Mainnet assets (Circle's Mainnet USDC issuer is different).
- [ ] Use a reliable RPC provider; the public SDF endpoints are rate-limited.
- [ ] Add monitoring for contract events and a written incident plan for `set_paused`.
