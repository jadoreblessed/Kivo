# KIVO implementation status

The Site UI is hosted on Sites. `/launch` creates a fixed-supply Token-2022 mint on **Solana devnet** through an injected Phantom-compatible wallet. The transaction stores name and symbol in the mint metadata extension, optionally sets a public metadata JSON URI, creates the creator's token account, mints the complete supply and revokes the mint authority. The creator signs and pays network fees; the site never handles wallet keys.

The visual builder, blueprints, market list, bonding curve estimates, LP rewards, pot, anti-snipe, burn and surge-fee rules are **interface previews**. They are not enforced by the mint and do not support trading. A separate market program, indexer, wallet compatibility work, economic tests, integration tests and independent security review are necessary before any mainnet launch. Do not describe a devnet token mint as a deployed KIVO trading protocol.

## Run locally

```sh
npm ci
npm run dev
```

Open `/launch` with a devnet-funded Solana browser wallet. The public Solana devnet RPC is used by default. The metadata JSON URL is optional and should be an HTTPS resource whose contents you control. A local image preview is not uploaded. The transaction links to Solana Explorer when confirmed.

## Verification

`npx tsc --noEmit` and `npm run build` validate the client and site bundle. A full onchain test needs a devnet wallet and SOL for account rent; it has not been performed in this environment. The single transaction intentionally reverts in full if metadata initialization or mint creation fails.
