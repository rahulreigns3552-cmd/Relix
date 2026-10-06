# Posting providers

Relix talks to a posting provider only from the API and the worker, through `SocialProvider` in `apps/api/src/social/`. The browser sees Connect, a same-origin handoff URL, and "Connected · @username". Provider names and provider URLs are stripped from UI text and from JSON sent to the browser.

Choose the adapter with `SOCIAL_PROVIDER`:

| Value | Behaviour |
|---|---|
| `none` (default) | No network calls. Connect returns `Posting service not configured`. Admins see that sentence on Channels. Publishing stays off. |
| `zernio` | REST adapter. Needs `ZERNIO_API_KEY`. |
| `ayrshare` | Adapter with the same method shape. Needs `AYRSHARE_API_KEY`. Connect URLs also need `AYRSHARE_DOMAIN` and a private key (`AYRSHARE_PRIVATE_KEY` or `AYRSHARE_PRIVATE_KEY_PATH`). Until those are set, methods throw `not configured`. |

Restart the API and the worker after changing this. Each Relix project gets one provider profile. The profile id is stored on the project and is not included in browser JSON.

`PUBLIC_BASE_URL` is the origin used for the OAuth redirect (Docker: `http://localhost:8080`, Vite: `http://localhost:5173`). Keep it short. Some platforms cap the length of the redirect URL.

## Zernio

1. Sign up at [zernio.com](https://zernio.com).
2. Create an API key and set `ZERNIO_API_KEY`.
3. Set `SOCIAL_PROVIDER=zernio` and `PUBLIC_BASE_URL`.

The adapter uses `https://zernio.com/api/v1` with `Authorization: Bearer`. It creates one profile per Relix project, opens a connect URL, and publishes through the posts API. Facebook Page and LinkedIn organization connects use headless mode: Relix renders the page or organization picker. Other platforms use the provider's standard connect window. If a headless step is not one Relix can render, the API restarts that connect in standard mode and sends the browser on.

Pricing checked 6 Oct 2026: the first 2 connected accounts are free, then $6 per account per month for accounts 3–10, $3 for 11–100, and $1 from 101 onward.

Docs: [multi-tenant](https://docs.zernio.com/multi-tenant), [connecting accounts](https://docs.zernio.com/guides/connecting-accounts), [get connect URL](https://docs.zernio.com/connect/get-connect-url).

## Ayrshare

1. Use an Ayrshare plan that includes User Profiles (Launch or Business for more than one brand).
2. Set `AYRSHARE_API_KEY`, `AYRSHARE_DOMAIN`, and either `AYRSHARE_PRIVATE_KEY` or `AYRSHARE_PRIVATE_KEY_PATH` (a PEM file on the server, never committed).
3. Set `SOCIAL_PROVIDER=ayrshare`.

The adapter creates one User Profile per Relix project, builds a connect URL with `generateJWT`, and publishes with `POST /api/post` and a `Profile-Key` header. Base URL is `https://app.ayrshare.com/api`.

Pricing checked 6 Oct 2026:

| Plan | Price | Profiles |
|---|---|---|
| Premium | $149/mo | 1 profile (single user, not a multi-brand connect) |
| Launch | $299/mo | Up to 10 profiles (28-day trial) |
| Business | $599/mo | 30 profiles, white-label connect page |

Max Pack is $300/mo on top and adds custom CSS, favicon, and footer on Ayrshare's linking page. Relix does not depend on that pack: the Channels screen and the selection screen are Relix's own UI.

Docs: [business plan overview](https://www.ayrshare.com/docs/multiple-users/business-plan-overview).

## Swap

Set `SOCIAL_PROVIDER` to the other name and supply that provider's keys. Existing channel rows stay in Relix, but account ids belong to the previous provider, so reconnect each platform after a swap. Leave `WORKER_PUBLISH_ENABLED=false` until a test brand connects and you have approved a preview on purpose.

## White-label limit

Connect in Relix does not ask the user to paste an API key or a provider URL. The consent screen on Instagram, Facebook, LinkedIn, X, YouTube, TikTok, Threads, and Pinterest still shows the OAuth app name of whoever owns that platform's `client_id`. With the hosted adapters above, that name is the provider's app, not yours.

A fully white-labeled consent screen needs your own platform developer apps (for example Post for Me "White Label Projects") or an enterprise arrangement where the provider registers your apps. Relix's selection screen only replaces the provider's page picker, not the platform consent screen.

## Other providers (not implemented)

Checked 6 Oct 2026, for context only:

| Provider | Connect | Price notes |
|---|---|---|
| bundle.social | Hosted connect URL. White-label listed for Enterprise. | Free (3 accounts, 20 posts/mo), Pro $100/mo unlimited accounts. 15 platforms. |
| Upload-Post | Branded connect from Professional. Callback briefly passes through their host. | Free, Basic $24/mo, Professional $50/mo. 20+ platforms. |
| Post for Me | White Label Projects using your own platform credentials. | From $10/mo (1,000 posts). 9 platforms. |
