# KIVO development package

KIVO is a Solana Token-2022 launchpad with five configurable swap rules, a ten-tranche bonding curve, buying and selling, a public Nth-buy pot, creator and treasury fee claims, and graduation into a permanently locked Meteora DAMM v2 position. The source includes the website, local-validator tests and the Anchor program. **It is not yet an approved mainnet handoff.** Read `KIVO_STATUS.md` before deploying.

## Current behavior

- When `NEXT_PUBLIC_KIVO_PROGRAM_ID` and `NEXT_PUBLIC_KIVO_TREASURY` are configured, `/launch` creates a fixed 1B supply Token-2022 mint with onchain name and ticker and initializes its market in the same wallet transaction. The mint authority is revoked. `/market/<mint>` signs buy, sell and permissionless graduation transactions, and `/app` reads onchain markets.
- `/launch` can publish immutable rule blueprints with a 0–10% author royalty from LP and pot contributions and use any published blueprint. It supports up to four creator fee recipients. The market page displays their shares and provides claims for the recipient wallets and blueprint author. These additions require a freshly built and tested program; an older `.so` binary in the workspace does not contain them.
- Without a configured market program, `/launch` offers the older standalone mint creator. This does **not** establish a KIVO trading market. The onchain program address shipped in source is a local test ID; it is not deployed to devnet or mainnet.
- `/admin` is password protected. It publishes the mainnet CA and X profile after checking the CA is a real mainnet mint. It persists data in Upstash Redis. The public CA and X buttons update without rebuilding.
- Pool migration uses the deployed Meteora DAMM v2 program ID `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`. The KIVO ABI was built against upstream commit `a85c926607433f23f0ea60f4ca7b1ae92f4156cb`. Validate that the deployed program supports that ABI on the target cluster.

## Local checks

Requires Node.js 22+, Rust and the Solana CLI with `cargo build-sbf`.

```sh
npm ci
npm run typecheck
npm run build
cargo test --manifest-path programs/kivo-market-math/Cargo.toml
KIVO_TREASURY_PUBKEY=<treasury-public-key> cargo build-sbf --manifest-path programs/kivo-market/Cargo.toml
```

The local validator tests use `http://127.0.0.1:18899`, a temporary payer keypair at `/tmp/kivo-test-payer.json`, the example KIVO program ID in source, and the DAMM v2 SBF binary for graduation. They include `scripts/test-market-local.mjs`, `scripts/test-market-metadata-local.mjs` (also run with `KIVO_TEST_WRONG_TREASURY=1`), `scripts/test-blueprint-local.mjs`, and `scripts/test-graduation-local.mjs`. All passed on the current SBPFv0 build. Never use their example key or IDs as production credentials.

Build the KIVO `.so` from the current source, load it and the pinned DAMM v2 `.so` into a fresh validator at the stated RPC port, fund the temporary payer, then run all three scripts. The graduation script publishes a blueprint, verifies author royalties survive migration, swaps through DAMM, collects pool fees and claims the creator splits. Do not reuse a prebuilt KIVO `.so` after modifying Rust source.

## Deploying after the remaining gates

1. Complete the open items in `KIVO_STATUS.md`, audit the Rust program and integration, and rehearse on devnet with funded test wallets. Verify the exact DAMM v2 program version and pool economics. A successful local test does not constitute a mainnet security review.
2. Generate a **new** program keypair outside this repository. Replace the `declare_id!` value in `programs/kivo-market/src/lib.rs` with its public key. Set `KIVO_TREASURY_PUBKEY` to the project's treasury public address while building with `cargo build-sbf`. Every market initialization must use that same treasury; the program rejects substitutions. Deploy the `.so` with `solana program deploy --program-id <your-program-keypair.json> --url <cluster> programs/kivo-market/target/deploy/kivo_market.so`. Keep the keypair and upgrade authority secret. Confirm the deployed hash and ID.
3. Set `NEXT_PUBLIC_KIVO_PROGRAM_ID`, `NEXT_PUBLIC_KIVO_TREASURY` to the exact address compiled into the program, `NEXT_PUBLIC_KIVO_NETWORK`, the matching RPC values and the four admin/Redis secrets in `.env` (copy `.env.example`). `NEXT_PUBLIC_` values are public and baked into the frontend build. Keep passwords, Redis tokens and private RPC credentials out of the frontend variables.
4. Run `docker compose up -d --build`, put an HTTPS reverse proxy in front of port 3000, then verify `/launch`, `/app`, `/market/<mint>` and `/admin` on the deployed host. The program must be deployed on the same Solana cluster selected in the site environment.
5. Once the project's own token exists on **mainnet**, paste its mint address and the X profile into `/admin`. The admin password is `ADMIN_PASSWORD` from the server environment, never stored in the browser bundle.

The server reads markets directly from RPC with `getProgramAccounts`; a production indexer with pagination and provider capacity remains an open scalability task. The market creation and swap pages require an injected Solana wallet such as Phantom. Wallets sign transactions; the server never handles seed phrases.
