# Free KIVO devnet preview on Render

This package can run as a **free preview** on Render. It is not an always-on public launch: Render's Free web service sleeps after 15 minutes without traffic, and the first request can take about a minute to wake it. The website and admin need an external Upstash Redis database. Solana's program remains on devnet.

1. Put this source tree in a private GitHub repository. Never commit `.env`, Solana keypairs, or Redis tokens. The repository must contain `render.yaml` and `Dockerfile` at its root.
2. Create an Upstash Redis database on its free tier. Copy its REST URL and REST token for the next step.
3. In Render, select **New → Blueprint**, connect the GitHub repository and approve the `render.yaml` plan. The blueprint selects a Free Docker web service and pre-fills the public devnet values.
4. Render will prompt for `ADMIN_PASSWORD` (at least 16 characters), `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Enter them in Render; do not put them in Git or chat. Render generates `ADMIN_SESSION_SECRET` automatically.
5. After the build, visit the assigned `onrender.com` HTTPS URL. Check `/`, `/launch`, `/app`, `/admin` and `/api/markets`, and test admin login. A devnet wallet is required for trading actions. The CA field in `/admin` verifies a **mainnet** mint and should remain blank until the project's mainnet mint exists.

The Dockerfile builds the client using the `NEXT_PUBLIC_` variables from `render.yaml`. Changing one requires a rebuild. For devnet RPC rate limits, replace the public endpoint only with a non-secret RPC URL. Do not expose a private RPC API key in a `NEXT_PUBLIC_` variable.
