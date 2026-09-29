# Ask Relix — rich chat blocks (widget + connector)

Bot replies can carry interactive cards in addition to text. They travel in the
existing `attachments` array of the chat reply endpoint.

## Endpoints

| Who | Method + path | Body |
|---|---|---|
| Bot | `GET /api/projects/:pid/chat/pending` (or `GET /api/chat/pending-all`) | – returns `{ jobs: [{ id, text, messageId, projectId, meta? }] }` |
| Bot | `POST /api/projects/:pid/chat/reply` | `{ jobId, text, attachments }` |
| Bot | `POST /api/chat/reply` (bridge form) | `{ projectId, jobId, text, attachments }` |
| UI  | `POST /api/projects/:pid/chat/widget-answer` | `{ messageId, widgetId, value }` |
| UI  | `POST /api/projects/:pid/chat/connector-action` | `{ messageId, connectorId, url? }` |

`jobId` is **required** and must be a pending chat job (every user message creates one).
Base URL: `http://127.0.0.1:8787`.

## Block schemas

### `widget` — question card
```jsonc
{
  "type": "widget",
  "widget": {
    "id": "connect-linkedin",            // unique within the message (auto-generated if omitted)
    "prompt": "Should I connect your LinkedIn?",
    "helpText": "optional grey line under the prompt",
    "options": [
      { "label": "Yes", "value": "Yes, connect LinkedIn", "description": "optional", "style": "primary" },
      { "label": "No",  "value": "No, skip LinkedIn for now", "style": "default" }   // style: primary | default | danger
    ],
    "allowCustom": false                 // true = show a small free-text input
  }
}
```
- The server always stores `answered: null` on arrival; bots cannot pre-answer.
- When the user clicks an option the card becomes inert, shows the chosen answer with a ✓,
  and the option's **`value`** (falls back to `label`) is posted as a normal user chat message.
  That creates a new pending chat job whose `meta` is
  `{ "kind": "widget-answer", "messageId", "widgetId", "prompt" }` so the bot knows which question was answered.

### `connector` — connector / channel card
```jsonc
{
  "type": "connector",
  "connector": {
    "id": "zernio-linkedin",             // unique within the message (auto-generated if omitted)
    "name": "Zernio",
    "description": "one line, truncated in the UI",
    "logoUrl": "/media/connectors/zernio.svg",   // optional; otherwise a coloured initial tile
    "tools": 52,                         // optional, shows "52 tools"
    "platform": "linkedin",              // optional: instagram | linkedin | twitter (x) | youtube | whatsapp | email (gmail)
    "action": "connect_channel",         // connect_channel | add_connector
    "url": "https://…",                  // optional; used by add_connector (opened in a new tab)
    "status": "available"                // available | connecting | added | failed  (default available)
  }
}
```
Button states: `available` → orange **Add**, `connecting` → **Connecting...**, `added` → green **✓ Added**,
`failed` → red **Retry**, `needs_url` → inline URL input (+ Connect).

Clicking **Add**:
- **with `platform`** → runs the same flow as `POST /api/projects/:pid/channels/:platform/connect`
  using the channel's saved URL. If no URL is saved yet the card switches to `needs_url` and shows an
  inline input; submitting it calls connector-action again with `{ url }` (validated like the Channels page).
  A channel job is queued at `GET /api/channel-jobs?status=pending` for the connector worker.
- **`add_connector` with `url`** (no platform) → the UI opens `url` in a new tab and the card is marked `added`.

For cards with a `platform`, status is **re-derived from the channel record on every GET /chat** (the UI polls
every 2.5 s): channel `connected` → Added, `connecting` → Connecting..., `failed` (after the card was clicked) →
Retry, otherwise Add. So bots can just post `"status": "available"`.

Available logos: `/media/connectors/{zernio,linkedin,instagram,x,youtube,whatsapp,gmail}.svg`.

### Text
`text` is plain text. Bare URLs and markdown links (`[label](https://…)`) in bot text render as short
link chips (domain or label) — don't paste long raw URLs expecting them to show in full.

---

## Example (a) — "Should I connect your LinkedIn?" (Yes / No)

```bash
curl -s -X POST http://127.0.0.1:8787/api/projects/sanctum/chat/reply \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "jobId": "job_XXXXXXXX",
  "text": "LinkedIn isn't connected for this brand yet.",
  "attachments": [
    {
      "type": "widget",
      "widget": {
        "id": "connect-linkedin",
        "prompt": "Should I connect your LinkedIn?",
        "helpText": "I'll use Zernio so I can schedule and publish LinkedIn posts for you.",
        "options": [
          { "label": "Yes", "value": "Yes, connect LinkedIn", "description": "Connect it via Zernio now", "style": "primary" },
          { "label": "No", "value": "No, skip LinkedIn for now", "description": "Keep Instagram only" }
        ],
        "allowCustom": true
      }
    }
  ]
}
JSON
```

## Example (b) — Zernio connector card for LinkedIn (platform linkedin, 52 tools)

```bash
curl -s -X POST http://127.0.0.1:8787/api/projects/sanctum/chat/reply \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "jobId": "job_XXXXXXXX",
  "text": "Here's the connector. Tap Add and I'll link your LinkedIn page.",
  "attachments": [
    {
      "type": "connector",
      "connector": {
        "id": "zernio-linkedin",
        "name": "Zernio",
        "description": "Schedule, publish and analyse LinkedIn posts for this brand",
        "logoUrl": "/media/connectors/zernio.svg",
        "tools": 52,
        "platform": "linkedin",
        "action": "connect_channel",
        "status": "available"
      }
    }
  ]
}
JSON
```

Both blocks (and more) can be sent in one reply: put several objects in `attachments`; they render
in order below the text.
