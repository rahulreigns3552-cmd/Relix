# Run Relix on your machine

These steps are for Visual Studio Code on your own computer. Relix talks to MySQL and, for Ask Relix replies, to OpenAI. Nothing here connects a Grok Bot API. There is no Grok Bot API to connect.

You still have to do three things yourself. Relix cannot do them for you:

- Create an OpenAI account and an API key.
- Create the posting-provider account that issues your Instagram, WhatsApp, and email keys.
- Paste those keys into Relix Settings.

## 1. Install Node.js

1. Install Node.js 20 or newer from the Node.js website.
2. Open a terminal in VS Code (**Terminal → New Terminal**).
3. Check the install:

```bash
node -v
npm -v
```

## 2. Install MySQL or MariaDB

1. Install MySQL or MariaDB and start the database service.
2. Create an empty database named `relix`, and a database user that can use it. Example in the `mysql` client:

```sql
CREATE DATABASE relix CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'relix'@'127.0.0.1' IDENTIFIED BY 'choose-a-password';
GRANT ALL PRIVILEGES ON relix.* TO 'relix'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Use your own user name and password. Relix creates its tables the first time the API starts.

## 3. Configure `.env`

1. In VS Code, open the `ops-lead-app` folder.
2. Copy `.env.example` to a file named `.env` in that same folder.
3. Fill in the MySQL lines:

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=relix
MYSQL_PASSWORD=choose-a-password
MYSQL_DATABASE=relix
```

4. Set the OpenAI lines in the same `.env`:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_MODEL` is optional. If you leave it blank, Relix uses `gpt-4o-mini`.

Do not commit `.env`. It is already listed in `.gitignore`.

Agents do not run until `OPENAI_API_KEY` is set. OpenAI is required. If the key is missing, Ask Relix returns: add `OPENAI_API_KEY` to `.env` and restart the API.

## 4. Install dependencies and start the app

In the VS Code terminal, from the `ops-lead-app` folder:

```bash
npm install
```

Start the API (port 8787):

```bash
node server.mjs
```

Leave that terminal running. Open a second terminal in the same folder and start the Vite UI (port 5173):

```bash
npx vite
```

Or use one terminal for both:

```bash
npm run dev
```

Open http://localhost:5173 in the browser. The UI calls the API through the Vite proxy.

Demo login, if you have not created your own account: `admin@opslead.app` / `lead123`.

## 5. Paste Instagram, WhatsApp, and email keys

1. Sign in and open the project.
2. Go to **Settings**.
3. In the **Connections** card, paste:
   - Instagram account name and Instagram API key
   - WhatsApp number and WhatsApp API key
   - From email and email API key
4. Click **Save connections**.

Relix stores the keys in MySQL. The screen never shows the full key again, only that one is saved and the last four characters.

Saving runs a format check only. It does not call the posting service and it does not publish a post. A key that looks well formed is marked connected with the note **saved, not verified with the network**. A missing or badly shaped key is marked failed.

## 6. Turn a channel on

1. Open **Channels**.
2. For Instagram, WhatsApp, or email, turn the toggle on. The URL field is optional for those three. The toggle uses the key you saved in Settings.
3. LinkedIn, X / Twitter, and YouTube still need a profile URL, then the toggle.

Disconnect with the same toggle.

## 7. Ask Relix

Open **Ask Relix** and send a message. Relix calls OpenAI chat completions with that message and writes the assistant reply into the same project chat. It does not use a second chat store.

If you have not set `OPENAI_API_KEY`, the chat shows the error telling you to add it. Restart `node server.mjs` after you change `.env`.

## What stays manual

- Creating the OpenAI account and copying `OPENAI_API_KEY`.
- Creating the posting-provider account and copying the Instagram, WhatsApp, and email keys.
- Pasting those keys in Settings → Connections.
- Installing Node.js and MySQL or MariaDB, and creating the `relix` database.

Relix does not send real email, publish real posts, or generate images from this setup.
