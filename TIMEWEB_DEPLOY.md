# KIVO on Timeweb Cloud (devnet)

The Solana program is already deployed to devnet at `7rJ2978K9SpqB4d7FAGrquhC7Gy2iJehxB4EohDZEB8`. Timeweb hosts only the website, API and password-protected admin. The fixed devnet treasury is `84HCJtzmvWF2tB4SCr8hmDymLN4Rz6u8jJoyaqwLjSRR`. No deployer or program private key belongs on the web server.

## Timeweb Cloud App Platform

1. Put this package in a private Git repository. Commit the source, `Dockerfile` and `docker-compose.yml`; do not commit `.env`, wallet keypairs or admin/Redis credentials. In Timeweb Cloud → App Platform → Create, connect the repository and select **Docker Compose**. Keep the project directory at the repository root.
2. Under advanced settings → Variables, enter the following four values as application variables. They have no valid defaults:

   - `ADMIN_PASSWORD`: a unique password with at least 16 characters.
   - `ADMIN_SESSION_SECRET`: a different random value with at least 32 characters.
   - `UPSTASH_REDIS_REST_URL`: URL of your external Upstash Redis REST database.
   - `UPSTASH_REDIS_REST_TOKEN`: token for that database.

   The devnet RPC, network, program ID and treasury already have public defaults in `docker-compose.yml`. If public Solana RPC becomes rate limited, set both `NEXT_PUBLIC_SOLANA_DEVNET_RPC` and `SOLANA_MARKET_RPC` to your provider's devnet endpoints, then rebuild. Do not put private RPC credentials in a `NEXT_PUBLIC_` URL.
3. Run deployment and open the Timeweb technical HTTPS domain. Check `/`, `/launch`, `/app`, `/admin` and `/api/markets`. Connect a **devnet** wallet and verify that the market created during testing is visible; verify a new transaction from the browser if needed. Do not paste the Solana keypair JSON into Timeweb.
4. Attach a custom domain in the Timeweb dashboard when ready. After each change to the public program, network, treasury or client RPC values, trigger a new image build; these values are baked into the frontend bundle.

Timeweb's technical domain has managed HTTPS. Admin configuration needs external Redis because application containers can be replaced during redeployment. The `/admin` CA field validates a **mainnet** mint; leave it blank while testing a devnet token, and test X profile updates separately.

## Timeweb VPS with Docker

Copy the files to the Linux server, then from the project directory:

```sh
cp .env.example .env
chmod 600 .env
# Edit .env on the server: replace the four admin/Redis placeholders with real values.
docker compose up -d --build
docker compose logs --tail=100 web
```

The container listens on server port 3000. Put the server's HTTPS reverse proxy in front of it and point the domain at that proxy. If Docker is already installed but `docker compose` chooses another file, use `docker compose -f docker-compose.yml up -d --build` explicitly. Validate `/admin` login over HTTPS before making the site public.

## Scope

This is a **devnet** site. The app and program are not deployed to Solana mainnet. Do not switch `NEXT_PUBLIC_KIVO_NETWORK` to `mainnet-beta` while the current program address is only on devnet. Source status and remaining integration limitations are in `KIVO_STATUS.md`.
