import http from 'node:http';
import { getSocialProvider } from '@relix/api/social';
import { createWorkerClient } from './api.js';
import { smtpConfigFrom, sendSmtp } from './mail.js';
import { runAnalytics } from './jobs/analytics.js';
import { runChannelSync } from './jobs/channel-sync.js';
import { runChatReplies } from './jobs/chat-replies.js';
import { runEmails } from './jobs/emails.js';
import { runImageGen } from './jobs/image-gen.js';
import { runProvision } from './jobs/provision.js';
import { runPublish } from './jobs/publish.js';

const port = Number(process.env.WORKER_PORT || 8790);
const intervalSeconds = Number(process.env.WORKER_INTERVAL_SECONDS || 60);
const workerKey = String(process.env.RELIX_WORKER_API_KEY || '');
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  const apiBase = String(process.env.RELIX_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const client = createWorkerClient(apiBase, workerKey);
  const provider = getSocialProvider();
  const log = (message: string) => console.log(`[relix-worker] ${message}`);
  const jobs: [string, () => Promise<unknown>][] = [
    ['chat', () => runChatReplies({
      client,
      apiKey: String(process.env.OPENAI_API_KEY || ''),
      model: String(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      log,
    })],
    ['channels', () => runChannelSync({ client, provider })],
    ['publish', () => runPublish({
      client,
      provider,
      publishEnabled: String(process.env.WORKER_PUBLISH_ENABLED || 'false') === 'true',
      publicBaseUrl: String(process.env.PUBLIC_BASE_URL || ''),
      log,
    })],
    ['provision', () => runProvision(client)],
    ['email', () => runEmails({ client, smtp: smtpConfigFrom(), send: (message) => sendSmtp(smtpConfigFrom()!, message), log })],
    ['analytics', () => runAnalytics({ client, provider, log })],
    ['images', () => runImageGen({
      client,
      apiKey: String(process.env.OPENAI_API_KEY || ''),
      model: String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'),
      enabled: String(process.env.WORKER_IMAGEGEN_ENABLED || 'false') === 'true',
      apiBase,
      log,
    })],
  ];
  try {
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (error) {
        console.error(`[relix-worker] ${name} failed`, error instanceof Error ? error.message : 'error');
      }
    }
  } finally {
    ticking = false;
  }
}

function authorized(req: http.IncomingMessage): boolean {
  const header = String(req.headers['x-relix-worker-key'] || '');
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return Boolean(workerKey) && (header === workerKey || bearer === workerKey);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'relix-worker' }));
    return;
  }
  if (req.method === 'POST' && path === '/wake') {
    if (!authorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'worker API key required' }));
      return;
    }
    void tick();
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[relix-worker] http://0.0.0.0:${port}`);
  void tick();
  setInterval(() => void tick(), Math.max(5, intervalSeconds) * 1000);
});
