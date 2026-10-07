# Setup

Relix runs from this repository on any machine with Docker, or with Node.js 22 and PostgreSQL 16. Keys belong in `.env`, which is never committed.

## Docker (Windows, macOS, Linux)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows or macOS) or Docker Engine plus the Compose plugin (Linux).
2. Clone the branch and enter the repo.
3. Copy the example env and fill in the required values:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Set at least `JWT_SECRET`, `RELIX_WORKER_API_KEY`, and `ADMIN_PASSWORD` (more than 6 characters). Leave provider, OpenAI, and SMTP blank until you have them.
5. Check, then start:

```bash
npm run check-env
docker compose up -d --build
```

`npm run check-env` needs Node. If you do not want Node on the host, confirm those three values are set in `.env` and start Compose directly.

6. Open http://localhost:8080 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Compose starts Postgres, runs migrations, imports `data/`, ensures the admin, and starts the API, Nginx, and the worker. Stop with `docker compose down`. Add `-v` to drop the database volume.

## Without Docker

Install Node.js 22 and PostgreSQL 16.

### Linux and macOS

```bash
psql -c "CREATE USER relix WITH PASSWORD 'relix' CREATEDB;"
psql -c "CREATE DATABASE relix OWNER relix;"
psql -c "CREATE DATABASE relix_test OWNER relix;"
cp .env.example .env
npm install
npm run check-env
npm run db:migrate
npm run dev
```

On Linux, `psql` is often `sudo -u postgres psql`.

### Windows (PowerShell)

Create the user and database in `psql`, then:

```powershell
Copy-Item .env.example .env
npm install
npm run check-env
npm run db:migrate
npm run dev
```

`npm run dev` starts the API (port 8787), the UI (http://localhost:5173), and the worker. `DATABASE_URL` in `.env` must match the Postgres you created.

`npm run db:seed` imports `data/` again. It is safe to run more than once: projects are upserted, and password hashes from the JSON files are not reused. The admin password changes only when that user does not exist yet.

## Where to get keys

| Key | Where |
|---|---|
| `JWT_SECRET`, `RELIX_WORKER_API_KEY`, `ADMIN_PASSWORD` | You invent these. They are not from a vendor. |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys). `OPENAI_MODEL` defaults to `gpt-4o-mini`. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-1`. |
| `ZERNIO_API_KEY` | Sign up at zernio.com, create an API key, set `SOCIAL_PROVIDER=zernio`. Details in `docs/SOCIAL-PROVIDERS.md`. |
| `AYRSHARE_API_KEY`, `AYRSHARE_DOMAIN`, private key | Ayrshare dashboard. Set `SOCIAL_PROVIDER=ayrshare`. The private key stays on the server (`AYRSHARE_PRIVATE_KEY` or `AYRSHARE_PRIVATE_KEY_PATH`). |
| `SMTP_*` | Any SMTP server. For Gmail, turn on 2-step verification, create an app password, then `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` is the Gmail address, `SMTP_PASS` is the app password, `SMTP_FROM` is the same address. |
| Meta (Facebook, Instagram) | [developers.facebook.com](https://developers.facebook.com/). Create an app, add Facebook Login and Instagram, and note the app id. With the hosted posting providers, the consent screen shows their app name unless you register your own app (see `docs/SOCIAL-PROVIDERS.md`). |
| LinkedIn | [developer.linkedin.com](https://www.linkedin.com/developers/). Create an app and request the Sign In and Share products. The same consent-screen limit applies. |

`SOCIAL_PROVIDER=none` is the default. Connect then tells an admin that the posting service is not configured, and the worker does not call a provider.

Brand reference images for Sanctum ship at `apps/api/public/media/brands/sanctum/logo.png` and `box.png`. They are simple marks because the original photographs were not in the git tree. Upload replacements from a signed-in session:

`POST /api/projects/<id>/brand-references` with `{ "filename": "logo.png", "dataBase64": "..." }`.

Image generation stays off until `WORKER_IMAGEGEN_ENABLED=true` and `OPENAI_API_KEY` is set. It does not approve or publish.

## Troubleshooting

- **Login fails after Compose.** Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, and that `ADMIN_PASSWORD` is longer than 6 characters. The password is not reset if that user already exists in the volume. `docker compose down -v` starts from an empty database.
- **The site loads but the API is 502.** Wait for the API healthcheck. The first boot migrates and imports `data/`. `docker compose logs api` shows the error.
- **Cookies disappear.** `COOKIE_SECURE` must be `false` on plain http.
- **Vite cannot reach the API.** `RELIX_API_URL` defaults to `http://127.0.0.1:8787`. Change it if the API listens elsewhere.
- **Connect button says the posting service is not configured.** `SOCIAL_PROVIDER` is `none` or the matching API key is empty. That is expected until you add a key.
- **Approved posts stay approved.** `WORKER_PUBLISH_ENABLED` defaults to `false`. The worker logs and leaves the action pending.
- **No approval email.** Set all of `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. The message goes to the project owner. The link only approves; it does not publish.
- **Images are not generated.** Set `WORKER_IMAGEGEN_ENABLED=true`, `OPENAI_API_KEY`, and at least one png, jpg, or webp under `apps/api/public/media/brands/<projectId>/`.
- **`npm run check-env` lists required names.** Those must be non-empty. Optional blanks are printed and do not fail the check.
- **Port 8080 is taken.** Set `RELIX_PORT` to another host port and set `PUBLIC_BASE_URL` and `WEB_ORIGIN` to match.
