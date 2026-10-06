# Relix

Orange-and-white control panel for multi-brand social ops. Ask Relix drafts and answers inside one brand. Instagram posts leave the building only after an explicit approval (Preview, or an email `APPROVE` handled by the worker).

```
apps/web     Vite + React UI
apps/api     Express API (TypeScript) + Prisma
apps/worker  chat replies, channel sync, publish, provision
packages/shared   shared UI types and the Ask Relix prompt
data/        legacy JSON imported by the seed (not the live database)
```

Postgres is the only database. Nginx serves the built UI and proxies `/api` and `/media` to the API, so the browser uses one origin.

## Run with Docker

Requires Docker Desktop (Windows or Mac) or Docker Engine (Linux).

```bash
cp .env.example .env
```

Edit `.env` before you share the machine. At minimum set `JWT_SECRET`, `RELIX_WORKER_API_KEY`, and `ADMIN_PASSWORD` (more than 6 characters).

```bash
docker compose up --build
```

Open http://localhost:8080 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (the example values are `admin@relix.app` / `change-me-please` until you change them).

Compose starts Postgres, the API, Nginx, and the worker. On first boot the API runs Prisma migrations, imports `data/` when the database is empty, and ensures the admin user. Sanctum and the other seeded brands show up for that admin. The worker polls the API every `WORKER_INTERVAL_SECONDS` (default 60). Publishing stays off until `WORKER_PUBLISH_ENABLED=true`.

### Windows (PowerShell)

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Then open http://localhost:8080.

### Linux

```bash
cp .env.example .env
docker compose up --build
```

Stop with `docker compose down`. Add `-v` to drop the database volume.

## Run without Docker

Requirements: Node.js 22+, PostgreSQL 16.

### Linux

```bash
sudo -u postgres psql -c "CREATE USER relix WITH PASSWORD 'relix' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE relix OWNER relix;"
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

UI: http://localhost:5173 (Vite proxies `/api` and `/media` to port 8787).

In another terminal, `npm run worker` starts the in-repo agent loop against `http://127.0.0.1:8787`. Set `RELIX_BRIDGE_WEBHOOK=http://127.0.0.1:8790/wake` and set `RELIX_BRIDGE_WEBHOOK_AUTH` to the same value as `RELIX_WORKER_API_KEY` if you want the API to wake it immediately.

### Windows (PowerShell)

Install Node.js 22 and PostgreSQL 16, then create the database in `psql`:

```sql
CREATE USER relix WITH PASSWORD 'relix' CREATEDB;
CREATE DATABASE relix OWNER relix;
```

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`DATABASE_URL` in `.env` must match the user, password, and database you created. The API reads that file on startup. `npm run worker` in a second terminal starts the agent loop, same as on Linux.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Authentication

The browser session is an httpOnly cookie named `relix_session` (HMAC JWT, 7 days). API clients may also send `Authorization: Bearer <jwt>`.

Every `/api` route except `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/channels/callback`, `GET /api/channels/go`, and `POST /api/channels/callback/select` returns **401** without a session or the worker key. The channel routes are the OAuth return path. Project routes return **403** when the signed-in user does not own the project. The seeded admin can see every project.

`GET /media/...` is served by the API (and proxied by Nginx) so preview images load on the same origin.

CORS allows only `WEB_ORIGIN` (comma-separated). Set `COOKIE_SECURE=true` behind HTTPS.

Change the account password from Settings. That call is `POST /api/auth/password` with the current and new password. Goals and briefs are stored per project (`GET/PUT /api/projects/:id/goals`, `GET/POST/DELETE /api/projects/:id/briefs`).

## Worker API contract

External automations send this header on every worker call:

```
X-Relix-Worker-Key: <RELIX_WORKER_API_KEY>
```

There is no query-string key and no bearer token for workers. A missing or wrong key is **401** with `{ "error": "worker API key required" }`.

Paths and JSON bodies are unchanged. Base URL on the host is `http://127.0.0.1:8787` (or the public origin plus `/api` when you go through Nginx).

| Method and path | Who |
|---|---|
| `GET /api/chat/pending-all` | worker |
| `GET /api/projects/:pid/chat/pending` | worker |
| `POST /api/projects/:pid/chat/reply` | worker |
| `POST /api/chat/reply` | worker, body includes `projectId` |
| `GET /api/projects/:pid/ig/queue` | signed-in user **or** worker |
| `POST /api/projects/:pid/ig/queue` | worker |
| `POST /api/projects/:pid/ig/morning-draft` | worker |
| `POST /api/projects/:pid/ig/:id/update` | worker |
| `POST /api/projects/:pid/ig/:id/email-sent` | worker |
| `POST /api/projects/:pid/ig/:id/approve` | user **or** worker (`via: "email"` for an email APPROVE) |
| `POST /api/projects/:pid/ig/:id/request-changes` | user or worker |
| `POST /api/projects/:pid/ig/:id/reject` | user or worker |
| `GET /api/projects/:pid/ig/actions/pending` | worker |
| `GET /api/ig/actions/pending-all` | worker |
| `POST /api/projects/:pid/ig/actions/:id/complete` | worker |
| `POST /api/ig/actions/:id/complete` | worker, body includes `projectId` |
| `POST /api/projects/:pid/ig/:id/retry` | user or worker |
| `POST /api/projects/:pid/analytics/sync` | worker |
| `GET /api/bridge/settings` and `POST /api/bridge/settings` | worker |
| `GET /api/provision/queue` | worker |
| `POST /api/provision/:jobId/complete` | worker |
| `GET /api/channel-jobs?status=pending` | worker |
| `POST /api/channel-jobs/:id/result` | worker |
| `GET /api/leads/pending` and `POST /api/leads/:id/sent` | worker |
| `POST /api/projects/:pid/channels/:platform/connect` | signed-in user. Returns `{ authUrl }` on this origin |
| `GET /api/channels/go` | public handoff into the platform consent screen |
| `GET /api/channels/callback` | public OAuth return |
| `POST /api/channels/callback/select` | public Relix page or organization picker |
| `POST /api/projects/:pid/channels/:platform/sync` | worker |

Job behaviour, failure handling, and the sequence from browser to platform are in [docs/AGENTS.md](docs/AGENTS.md). Provider setup is in [docs/SOCIAL-PROVIDERS.md](docs/SOCIAL-PROVIDERS.md).

### Publish lifecycle

Approving a preview creates a pending `publish` action. Nothing is posted before that.

`POST .../ig/actions/:id/complete` with a publish action:

- Success (`result` omitted, `"published"`, or an object without `error` / `status: "failed"`) sets the queue item to `published` and stores `externalPostId` from `result.externalPostId`, `result.zernioPostId`, or `result.postId`. The legacy `zernioPostId` field is still written for older workers.
- Failure (`result.error`, `result.status: "failed"`, or `result.ok: false`) sets the queue item and the action to `failed`.
- `POST /api/projects/:pid/ig/:id/retry` on a `failed` item queues a new publish action. It does not approve a draft that was never approved.

Chat block shapes (question cards and connector cards) are in [CHAT-BLOCKS.md](CHAT-BLOCKS.md).

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `POSTGRES_PASSWORD` | Password compose gives the `postgres` service |
| `JWT_SECRET` | Signs session cookies |
| `RELIX_WORKER_API_KEY` | Worker header secret |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin. Password is not reset if the user already exists |
| `WEB_ORIGIN` | Allowed browser origins |
| `COOKIE_SECURE` | `true` when the site is HTTPS |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Ask Relix replies. Model defaults to `gpt-4o-mini` |
| `RELIX_LEAD_SINK_EMAIL` | Optional address stored on completed-chat leads |
| `RELIX_BRIDGE_WEBHOOK` / `RELIX_BRIDGE_WEBHOOK_AUTH` | Wake-up POST when chat or provision jobs are queued. Compose defaults the URL to `http://worker:8790/wake`. The auth value must equal `RELIX_WORKER_API_KEY` |
| `SOCIAL_PROVIDER` | `none` (default), `zernio`, or `ayrshare`. `none` makes no network calls |
| `ZERNIO_API_KEY` | Key for the Zernio adapter. Leave empty in the example |
| `AYRSHARE_API_KEY` / `AYRSHARE_DOMAIN` / `AYRSHARE_PRIVATE_KEY_PATH` | Ayrshare adapter. The private key can also be `AYRSHARE_PRIVATE_KEY` inline. Do not commit a key file |
| `PUBLIC_BASE_URL` | Origin used to build the OAuth redirect |
| `WORKER_PUBLISH_ENABLED` | `false` by default. The worker logs and skips publish actions until this is `true` |
| `WORKER_INTERVAL_SECONDS` | Worker poll interval (default `60`) |
| `PORT` | API port (default `8787`) |
| `RELIX_PORT` | Host port mapped to Nginx (default `8080`) |
| `SEED_ON_START` | Import `data/` when the database has no projects (`true` by default) |

Do not commit `.env`, API keys, or `data/channel-sync-state.json`.

## Connect

Channels for Instagram, Facebook, LinkedIn, X, YouTube, TikTok, Threads, and Pinterest use **Connect**. That calls `POST /api/projects/:id/channels/:platform/connect`. The JSON `authUrl` is always on this site (`/api/channels/go`). The API then redirects to the platform. After consent, the browser lands on `/p/:projectId/channels?connected=<platform>`. A page or organization choice is a Relix screen (orange and white), posted back to `/api/channels/callback/select`.

WhatsApp and email stay manual (a link or address in Channels, or the key check in Settings). With `SOCIAL_PROVIDER=none`, admins see "Posting service not configured" on Channels. Other roles see that connect is not available on the workspace yet.

Chat connector cards use the same connect call.

## Product rules

- The posting-provider name is not shown in the UI or in JSON the browser receives. Connector cards say "Relix".
- Approve, Request changes, and Reject stay on Preview. A failed publish can be retried; that is not a new approval. The worker posts only when `WORKER_PUBLISH_ENABLED=true` and the live queue item is `approved`.
- Ask Relix stays inside the brand's posts, drafts, approvals, captions, calendar, and channels. Out-of-scope replies use the existing refusal text and an app-options card. Chat text renders bold, italic, code, links, and lists. Vendor links that used to leave a dangling "Docs:" or "1. Open" line are dropped.
