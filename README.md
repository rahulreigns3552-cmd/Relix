# Relix — Agent Team Control Panel

Orange + white Vite/React control panel for Relix (Grok Bot). Chat is the post-login home; Instagram drafts go through Preview → approve / request changes → publish.

## Quick start

```bash
npm install
npm run dev
```

- **Vite UI:** http://localhost:5173 (binds `0.0.0.0`)
- **API:** http://localhost:8787 (`/api` proxied from Vite)
- **Demo login:** `admin@opslead.app` / `lead123`

## How Relix processes work

Chat messages and Instagram actions are persisted under `data/`. Relix (Grok Bot) can:

1. Poll the API (`GET /api/chat/pending`, `GET /api/ig/actions/pending`), or
2. Read the JSON files directly, or
3. Receive an optional webhook ping (`{ type, id }`) when a webhook URL is set in Settings.

### Data files

| File | Purpose |
|------|---------|
| `data/chat.json` | Full chat thread |
| `data/chat-inbox.json` | Pending user messages for Relix |
| `data/chat-archive.json` | Completed chat jobs |
| `data/ig-queue.json` | Instagram preview items |
| `data/ig-actions.json` | Pending publish / revise actions |
| `data/settings.json` | Webhook URL and API settings |

### Reply to chat

```bash
# List pending jobs
curl -s http://localhost:8787/api/chat/pending | jq

# Reply (text + optional attachments)
curl -s -X POST http://localhost:8787/api/chat/reply \
  -H 'Content-Type: application/json' \
  -d '{
    "jobId": "JOB_ID",
    "text": "Here is a draft caption.",
    "attachments": [
      { "type": "image", "url": "https://example.com/img.jpg" },
      { "type": "pdf", "url": "/files/brief.pdf", "name": "Brief.pdf" },
      {
        "type": "ig_preview",
        "imageUrl": "https://example.com/post.jpg",
        "caption": "Sanctum mornings.",
        "hashtags": ["#Sanctum", "#QuietLuxury"]
      }
    ]
  }'
```

### Instagram revise / complete

```bash
# After revising a post, push it back to pending preview
curl -s -X POST http://localhost:8787/api/ig/POST_ID/update \
  -H 'Content-Type: application/json' \
  -d '{"caption":"Updated caption","hashtags":["#Sanctum"],"imageUrl":"..."}'

# Mark a publish/revise action done
curl -s -X POST http://localhost:8787/api/ig/actions/ACTION_ID/complete \
  -H 'Content-Type: application/json' \
  -d '{"result":"published"}'
```

## Scripts

- `npm run dev` — API (8787) + Vite (5173) via concurrently
- `npm run dev:api` / `npm run dev:web` — run separately
