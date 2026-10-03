# KIVO

KIVO is a Solana token creator and an interactive prototype for a programmable token-market protocol. The public site is [kivo-markets.jadorealure.chatgpt.site](https://kivo-markets.jadorealure.chatgpt.site).

## Available now

- A wallet-signed Token-2022 mint creation flow on **Solana devnet** at `/launch`.
- Onchain name and ticker, optional HTTPS metadata URI, fixed supply with six decimals, token account for the creator, and mint authority revocation.
- Responsive landing page, rule builder, and local blueprint previews.

The five swap rules, bonding curve, LP graduation, marketplace, royalties, and live trading are **not implemented onchain**. See [KIVO_STATUS.md](KIVO_STATUS.md) before deploying or using this with real funds.

## Development

Requires Node.js 22.13+.

```sh
npm install
npm run dev
```

To check the build:

```sh
npx tsc --noEmit
npm run build
```

No server receives a wallet secret. The user's injected Solana wallet signs the devnet transaction. Use a wallet funded with devnet SOL for rent and fees.
