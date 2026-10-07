// @ts-nocheck
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RELIX_AGENT_SYSTEM_PROMPT, scrubVendorText } from '@relix/shared';
import { signEmailAction, verifyEmailAction } from './email-token.js';
import { prepareDatabase } from './seed.js';
import {
  getSocialProvider,
  peekHandoff,
  rememberHandoff,
  selectionPage,
  signConnectState,
  verifyConnectState,
} from './social/index.js';
import { flushStore, hasDoc, readDoc, runExclusive, writeDoc } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_MEDIA = path.resolve(__dirname, '../public/media');
const PORT = Number(process.env.PORT || 8787);
const SESSION_COOKIE = 'relix_session';
const WORKER_HEADER = 'x-relix-worker-key';

const DEFAULT_PROJECTS = [
  {
    id: 'sanctum',
    name: 'Sanctum',
    description: 'Quiet luxury lifestyle brand — ritual, warmth, intentional living.',
    createdAt: '2026-09-23T00:00:00.000Z',
  },
  {
    id: 'sciens',
    name: 'Sciens',
    description: 'Science-forward product brand — clarity, evidence, modern craft.',
    createdAt: '2026-09-23T00:00:00.000Z',
  },
];

function ensureDir(dir = DATA_DIR) {
  const resolved = path.resolve(dir);
  const dataRoot = path.resolve(DATA_DIR);
  if (resolved === dataRoot || resolved.startsWith(dataRoot + path.sep)) return;
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
}

function loadEnvFile() {
  const candidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    applyEnvFile(file);
  }
}

function applyEnvFile(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
}

function relDataPath(file) {
  const abs = path.resolve(file);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (abs !== path.resolve(DATA_DIR) && !abs.startsWith(root)) return null;
  return abs.slice(root.length).split(path.sep).join('/');
}

function readJson(file, fallback) {
  const rel = relDataPath(file);
  if (!rel || !hasDoc(rel)) return structuredClone(fallback);
  const value = readDoc(rel);
  return value === undefined ? structuredClone(fallback) : structuredClone(value);
}

function writeJson(file, data) {
  const rel = relDataPath(file);
  if (!rel) throw new Error(`Refusing to write outside the data store: ${file}`);
  writeDoc(rel, data);
}

function jsonDataExists(file) {
  const rel = relDataPath(file);
  return Boolean(rel && hasDoc(rel));
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROVISION_QUEUE_FILE = path.join(DATA_DIR, 'provision-queue.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const verify = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(verify, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function readUsers() {
  const data = readJson(USERS_FILE, { users: [] });
  if (!Array.isArray(data.users)) data.users = [];
  return data;
}

function writeUsers(data) {
  writeJson(USERS_FILE, data);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isUrlish(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    return Boolean(u.hostname && u.hostname.includes('.'));
  } catch {
    return false;
  }
}

function slugifyName(name) {
  const base =
    String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project';
  return base;
}

function uniqueProjectId(name) {
  const base = slugifyName(name);
  const projects = listProjects();
  const ids = new Set(projects.map((p) => p.id));
  if (!ids.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function readProvisionQueue() {
  const data = readJson(PROVISION_QUEUE_FILE, { jobs: [] });
  if (!Array.isArray(data.jobs)) data.jobs = [];
  return data;
}

function readBridgeSettings() {
  return readJson(path.join(DATA_DIR, 'bridge-settings.json'), { webhookUrl: '' });
}

function workerWakeUrl() {
  const settings = readBridgeSettings();
  const fromSettings = String(settings.webhookUrl || '').trim();
  if (fromSettings) return fromSettings;
  const fromEnv = String(process.env.RELIX_BRIDGE_WEBHOOK || '').trim();
  if (fromEnv) return fromEnv;
  const port = Number(process.env.WORKER_PORT || 8790);
  return `http://127.0.0.1:${port}/wake`;
}

function pingBridgeWebhook(payload) {
  const settings = readBridgeSettings();
  const url = workerWakeUrl();
  if (!url) return;
  const auth = String(settings.webhookAuth || process.env.RELIX_BRIDGE_WEBHOOK_AUTH || process.env.RELIX_WORKER_API_KEY || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = /^(Bearer|Basic)\s/i.test(auth) ? auth : `Bearer ${auth}`;
  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function enqueueProvisionJob(payload) {
  const queue = readProvisionQueue();
  const job = {
    id: uid('prov'),
    status: 'pending',
    projectId: payload.projectId,
    email: payload.email,
    goal: payload.goal || 'Grow my brand',
    businessName: payload.businessName,
    website: payload.website || '',
    industry: payload.industry || '',
    teamSize: 6,
    note: 'Always create 6 new brand agents + brand group. Never reuse another brand\'s agents.',
    createdAt: new Date().toISOString(),
  };
  queue.jobs.push(job);
  writeJson(PROVISION_QUEUE_FILE, queue);
  // Wake Relix immediately so brand agents are created without waiting on cron
  pingBridgeWebhook({
    type: 'provision',
    id: job.id,
    projectId: job.projectId,
    businessName: job.businessName,
    goal: job.goal,
  });
  // Also ping project webhook if configured
  if (job.projectId) pingWebhook(job.projectId, 'provision', job.id);
  return job;
}

function createProjectRecord({ name, description, website, industry, ownerEmail }) {
  const id = uniqueProjectId(name);
  const project = {
    id,
    name: String(name).trim(),
    description: String(description || '').trim(),
    website: String(website || '').trim(),
    industry: String(industry || '').trim(),
    ownerEmail: String(ownerEmail || '').trim().toLowerCase() || undefined,
    createdAt: new Date().toISOString(),
  };
  const projects = listProjects();
  projects.push(project);
  writeJson(path.join(DATA_DIR, 'projects.json'), projects);
  seedProject(id);
  return project;
}

function writeProjectBrand(projectId, brand) {
  const dir = projectDir(projectId);
  ensureDir(dir);
  writeJson(path.join(dir, 'brand.json'), brand);
  const files = projectFiles(projectId);
  const settings = readJson(files.settings, { webhookUrl: '' });
  writeJson(files.settings, { ...settings, brand });
}

function parseHashtags(input) {
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  return String(input || '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** Next calendar morning 10:00 Asia/Calcutta after postDate (YYYY-MM-DD) or after an ISO timestamp. */
function nextMorningExpiresAt(postDateOrIso) {
  let y;
  let m;
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(postDateOrIso || ''))) {
    [y, m, d] = String(postDateOrIso).split('-').map(Number);
  } else {
    const dt = new Date(postDateOrIso || Date.now());
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Calcutta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt);
    y = Number(parts.find((p) => p.type === 'year').value);
    m = Number(parts.find((p) => p.type === 'month').value);
    d = Number(parts.find((p) => p.type === 'day').value);
  }
  // Next day 10:00 IST = 04:30 UTC
  return new Date(Date.UTC(y, m - 1, d + 1, 4, 30, 0, 0)).toISOString();
}


function istYmdFromDate(dt = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Calcutta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

/** Tomorrow's calendar date in Asia/Calcutta (YYYY-MM-DD). Preview always targets this. */
function tomorrowIstYmd() {
  const today = istYmdFromDate(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

function expireStaleIgItems(queue) {
  const now = Date.now();
  let changed = false;
  for (const item of queue.items || []) {
    if (
      (item.status === 'pending' || item.status === 'changes_requested') &&
      item.expiresAt &&
      new Date(item.expiresAt).getTime() < now
    ) {
      item.status = 'expired';
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}


function isFragileRemoteThumb(url) {
  const u = String(url || '');
  if (!u) return true;
  if (u.startsWith('/media/') || u.startsWith('data:')) return false;
  // Instagram CDN signed URLs expire / hotlink-block without full query params
  if (/cdninstagram\.com|fbcdn\.net|instagram\.com\/.*\/media/i.test(u)) {
    try {
      const parsed = new URL(u);
      if (![...parsed.searchParams.keys()].length) return true;
    } catch {
      return true;
    }
    // Even signed ones often 403 from localhost — treat as fragile
    return true;
  }
  return false;
}

function localMediaCandidates(projectId, calendarPostId, postId) {
  const names = [];
  if (calendarPostId) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      names.push(`${projectId}-${calendarPostId}${ext}`);
    }
  }
  if (postId) {
    const slice = String(postId).slice(0, 8);
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      names.push(`${projectId}-post-${slice}${ext}`);
      names.push(`${projectId}-ig-${slice}${ext}`);
      names.push(`${projectId}-zernio-${slice}${ext}`);
    }
  }
  return names;
}

function findLocalMediaUrl(projectId, { calendarPostId, id, zernioPostId } = {}) {
  ensureDir(PUBLIC_MEDIA);
  for (const name of localMediaCandidates(projectId, calendarPostId, id || zernioPostId)) {
    const full = path.join(PUBLIC_MEDIA, name);
    if (fs.existsSync(full)) return `/media/${name.replace(/-zernio-/g, '-post-')}`;
  }
  return null;
}

function queueImageUrl(files, calendarPostId) {
  if (!calendarPostId || !files?.igQueue) return null;
  const queue = readJson(files.igQueue, { items: [] });
  const item = (queue.items || []).find(
    (i) => i.calendarPostId === calendarPostId && i.imageUrl
  );
  const url = item?.imageUrl ? String(item.imageUrl) : '';
  if (url.startsWith('/media/') || url.startsWith('data:')) return url;
  return null;
}

function resolveAnalyticsThumbnail(projectId, post, files) {
  const local = findLocalMediaUrl(projectId, post);
  if (local) return local;
  const fromQueue = queueImageUrl(files, post?.calendarPostId);
  if (fromQueue) return fromQueue;
  const current = String(post?.thumbnailUrl || '');
  if (current && !isFragileRemoteThumb(current)) return current;
  return current || '';
}

function enrichAnalyticsPosts(projectId, store, files) {
  if (!store?.posts) return store;
  store.posts = store.posts.map((post) => ({
    ...post,
    thumbnailUrl: resolveAnalyticsThumbnail(projectId, post, files) || post.thumbnailUrl || '',
  }));
  return store;
}

function emptyAnalytics() {
  return { account: '', updatedAt: null, posts: [] };
}

function readAnalytics(files) {
  return readJson(files.analytics, emptyAnalytics());
}

function upsertAnalyticsPosts(store, incomingPosts, account) {
  if (!store.posts) store.posts = [];
  if (account !== undefined && account !== null && String(account).trim()) {
    store.account = String(account).trim();
  }
  for (const raw of incomingPosts || []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || raw.zernioPostId || '').trim();
    if (!id) continue;
    const zid = raw.zernioPostId ? String(raw.zernioPostId) : undefined;
    const idx = store.posts.findIndex(
      (p) =>
        p.id === id ||
        (zid && (p.zernioPostId === zid || p.id === zid)) ||
        (p.zernioPostId && p.zernioPostId === id)
    );
    const metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};
    const next = {
      id,
      zernioPostId: zid || (idx >= 0 ? store.posts[idx].zernioPostId : undefined),
      calendarPostId: raw.calendarPostId ?? (idx >= 0 ? store.posts[idx].calendarPostId : undefined),
      caption: raw.caption ?? (idx >= 0 ? store.posts[idx].caption : ''),
      publishedAt: raw.publishedAt ?? (idx >= 0 ? store.posts[idx].publishedAt : null),
      platformPostUrl: raw.platformPostUrl ?? (idx >= 0 ? store.posts[idx].platformPostUrl : ''),
      thumbnailUrl: (() => {
        const prev = idx >= 0 ? store.posts[idx].thumbnailUrl : '';
        const incoming = raw.thumbnailUrl;
        const localHint =
          raw.localImageUrl ||
          raw.imageUrl ||
          (typeof incoming === 'string' && String(incoming).startsWith('/media/') ? incoming : '');
        // Prefer durable local /media paths over fragile Instagram CDN thumbs
        if (localHint && String(localHint).startsWith('/media/')) return String(localHint);
        if (incoming && !isFragileRemoteThumb(incoming)) return String(incoming);
        if (prev && !isFragileRemoteThumb(prev)) return String(prev);
        return incoming != null && incoming !== '' ? String(incoming) : prev || '';
      })(),
      metrics: {
        impressions: Number(metrics.impressions ?? 0),
        reach: Number(metrics.reach ?? 0),
        likes: Number(metrics.likes ?? 0),
        comments: Number(metrics.comments ?? 0),
        shares: Number(metrics.shares ?? 0),
        saves: Number(metrics.saves ?? 0),
        clicks: Number(metrics.clicks ?? 0),
        views: Number(metrics.views ?? 0),
        engagementRate: Number(metrics.engagementRate ?? 0),
      },
    };
    if (idx >= 0) store.posts[idx] = { ...store.posts[idx], ...next };
    else store.posts.unshift(next);
  }
  store.updatedAt = new Date().toISOString();
  return store;
}

function projectDir(projectId) {
  return path.join(DATA_DIR, projectId);
}

function projectFiles(projectId) {
  const dir = projectDir(projectId);
  return {
    chat: path.join(dir, 'chat.json'),
    chatInbox: path.join(dir, 'chat-inbox.json'),
    chatArchive: path.join(dir, 'chat-archive.json'),
    igQueue: path.join(dir, 'ig-queue.json'),
    igActions: path.join(dir, 'ig-actions.json'),
    settings: path.join(dir, 'settings.json'),
    analytics: path.join(dir, 'analytics.json'),
  };
}

function demoSvg(title, subtitle, colors) {
  const [c1, c2, c3] = colors;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="50%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <circle cx="820" cy="220" r="140" fill="rgba(255,255,255,0.18)"/>
  <circle cx="200" cy="860" r="200" fill="rgba(255,255,255,0.12)"/>
  <text x="540" y="500" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="72" font-weight="700" fill="white">${title}</text>
  <text x="540" y="580" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="32" fill="rgba(255,255,255,0.9)">${subtitle}</text>
</svg>`)}`;
}

const PROJECT_SEEDS = {
  sanctum: {
    welcome:
      'Hi — I am Relix for Sanctum. Ask me anything about brand, content, or Instagram drafts for this quiet-luxury lifestyle project.',
    ig: {
      imageUrl: demoSvg('Sanctum', 'Quiet luxury · Everyday ritual', [
        '#F97316',
        '#FB923C',
        '#FED7AA',
      ]),
      caption:
        'Morning light, soft linen, and a cup that never rushes you.\n\nSanctum is for the quiet moments between the noise — a lifestyle brand built around ritual, warmth, and intentional living.',
      hashtags: ['#Sanctum', '#QuietLuxury', '#EverydayRitual', '#SlowLiving', '#Lifestyle'],
    },
  },
  sciens: {
    welcome:
      'Hi — I am Relix for Sciens. Ask me anything about science-forward messaging, product content, or Instagram drafts for this project.',
    ig: {
      imageUrl: demoSvg('Sciens', 'Clarity · Evidence · Craft', [
        '#EA580C',
        '#F97316',
        '#FFEDD5',
      ]),
      caption:
        'Built on evidence. Finished with craft.\n\nSciens turns rigorous science into products you can trust — clear claims, modern design, zero fluff.',
      hashtags: ['#Sciens', '#ScienceForward', '#EvidenceBased', '#ModernCraft', '#Product'],
    },
  },
};

function currentUserRecord(email) {
  const e = String(email || '').trim().toLowerCase();
  return readUsers().users.find((u) => u.email === e) || null;
}

function listProjectsForEmail(email) {
  const all = listProjects();
  const user = currentUserRecord(email);
  if (!user) return [];
  if (user.role === 'admin') return all;
  const e = user.email.toLowerCase();
  return all.filter((p) => String(p.ownerEmail || '').toLowerCase() === e);
}

function listProjects() {
  const file = path.join(DATA_DIR, 'projects.json');
  const projects = readJson(file, []);
  return Array.isArray(projects) ? projects : [];
}

function isValidProjectId(id) {
  const projects = listProjects();
  return projects.some((p) => p.id === id);
}


function welcomeTextFor(projectId) {
  const seed = PROJECT_SEEDS[projectId];
  if (seed?.welcome) return seed.welcome;
  const project = listProjects().find((p) => p.id === projectId);
  const name = project?.name || projectId;
  return `Hi — I am Relix for ${name}. Ask me anything about this project.`;
}

function resetChatThread(projectId) {
  const files = projectFiles(projectId);
  const prev = readJson(files.chat, { messages: [], pendingReply: false });
  const inbox = readJson(files.chatInbox, { jobs: [] });
  const archive = readJson(files.chatArchive, { jobs: [] });

  // Archive prior thread snapshot + any pending jobs so refresh is a clean start
  archive.jobs = archive.jobs || [];
  archive.jobs.push({
    id: uid('refresh'),
    type: 'chat-refresh',
    projectId,
    clearedAt: new Date().toISOString(),
    messageCount: (prev.messages || []).length,
    pendingJobs: (inbox.jobs || []).filter((j) => j.status === 'pending'),
  });
  for (const job of inbox.jobs || []) {
    if (job.status === 'pending') {
      job.status = 'cancelled';
      job.cancelledAt = new Date().toISOString();
      archive.jobs.push(job);
    }
  }

  const chat = {
    messages: [
      {
        id: uid('msg'),
        role: 'assistant',
        text: welcomeTextFor(projectId),
        attachments: [],
        createdAt: new Date().toISOString(),
      },
    ],
    pendingReply: false,
  };

  writeJson(files.chat, chat);
  writeJson(files.chatInbox, { jobs: [] });
  writeJson(files.chatArchive, archive);
  return chat;
}

function seedProject(projectId) {
  ensureDir(projectDir(projectId));
  const files = projectFiles(projectId);
  const seed = PROJECT_SEEDS[projectId] || {
    welcome: `Hi — I am Relix for ${projectId}. Ask me anything about this project.`,
    ig: {
      imageUrl: demoSvg(projectId, 'Project workspace', ['#F97316', '#FB923C', '#FED7AA']),
      caption: `Welcome to ${projectId}.`,
      hashtags: [`#${projectId}`],
    },
  };

  if (!jsonDataExists(files.chat)) {
    writeJson(files.chat, {
      messages: [
        {
          id: uid('msg'),
          role: 'assistant',
          text: seed.welcome,
          attachments: [],
          createdAt: new Date().toISOString(),
        },
      ],
      pendingReply: false,
    });
  }
  if (!jsonDataExists(files.chatInbox)) writeJson(files.chatInbox, { jobs: [] });
  if (!jsonDataExists(files.chatArchive)) writeJson(files.chatArchive, { jobs: [] });
  if (!jsonDataExists(files.igActions)) writeJson(files.igActions, { actions: [] });
  if (!jsonDataExists(files.settings)) writeJson(files.settings, { webhookUrl: '' });
  if (!jsonDataExists(files.analytics)) writeJson(files.analytics, emptyAnalytics());

  if (!jsonDataExists(files.igQueue)) {
    writeJson(files.igQueue, { items: [] });
  } else {
    const queue = readJson(files.igQueue, { items: [] });
    if (!queue.items) {
      writeJson(files.igQueue, { items: [] });
    }
  }
}

function ownedDefaultProjects() {
  const owner = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return DEFAULT_PROJECTS.map((project) => ({
    ...project,
    ownerEmail: owner || undefined,
  }));
}

function ensureSeeded() {
  ensureDir();
  const projectsFile = path.join(DATA_DIR, 'projects.json');
  const existing = jsonDataExists(projectsFile) ? readJson(projectsFile, []) : [];
  if (!Array.isArray(existing) || existing.length === 0) {
    writeJson(projectsFile, ownedDefaultProjects());
  }
  for (const p of listProjects()) {
    seedProject(p.id);
  }
  if (!jsonDataExists(PROVISION_QUEUE_FILE)) {
    writeJson(PROVISION_QUEUE_FILE, { jobs: [] });
  }
}

function pingWebhook(projectId, type, id) {
  const files = projectFiles(projectId);
  const settings = readJson(files.settings, { webhookUrl: '' });
  const url = (settings.webhookUrl || '').trim();
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id, projectId }),
  }).catch(() => {});
}

function requireProject(req, res, next) {
  const projectId = req.params.projectId;
  if (!projectId || !isValidProjectId(projectId)) {
    return res.status(404).json({ error: 'project not found' });
  }
  if (!actorCanAccessProject(req, projectId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  seedProject(projectId);
  req.projectId = projectId;
  req.files = projectFiles(projectId);
  next();
}


// ——— Notifications (every change; kept 48h) ———
const NOTIF_TTL_MS = 48 * 60 * 60 * 1000;
const GLOBAL_NOTIF_FILE = path.join(DATA_DIR, 'notifications-global.json');

function notifFile(projectId) {
  return projectId ? path.join(projectDir(projectId), 'notifications.json') : GLOBAL_NOTIF_FILE;
}

function pruneNotifs(list) {
  const cutoff = Date.now() - NOTIF_TTL_MS;
  return (list || []).filter((n) => new Date(n.createdAt).getTime() > cutoff);
}

function addNotification(projectId, { title, body = '', kind = 'info', section = null, dedupeMs = 0 }) {
  try {
    if (projectId && !isValidProjectId(projectId)) return null;
    const file = notifFile(projectId);
    const store = readJson(file, { items: [] });
    store.items = pruneNotifs(store.items);
    if (dedupeMs > 0) {
      const recent = store.items.find(
        (n) => n.title === title && Date.now() - new Date(n.createdAt).getTime() < dedupeMs
      );
      if (recent) return null;
    }
    const n = {
      id: uid('ntf'),
      projectId: projectId || null,
      title: String(title).slice(0, 160),
      body: String(body || '').slice(0, 400),
      kind,
      section,
      createdAt: new Date().toISOString(),
    };
    store.items.unshift(n);
    writeJson(file, store);
    return n;
  } catch {
    return null;
  }
}

function firstLine(text, max = 90) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function viaLabel(via) {
  return via === 'email' ? ' by email' : via === 'relix' ? ' in Preview' : '';
}

function describeChange(method, pathname, body, out) {
  const b = body || {};
  const o = out || {};
  let m;
  if (method !== 'POST') return null;
  if (pathname === '/api/auth/signup') return { projectId: null, title: 'Account created', body: o.email || b.email || '', kind: 'success' };
  if (pathname === '/api/projects' || pathname === '/api/onboarding/complete') {
    return { projectId: o.project?.id, title: `Project created: ${o.project?.name || b.name || b.businessName}`, body: 'Setting up 6 dedicated agents for this brand.', kind: 'success', section: 'overview' };
  }
  if (pathname === '/api/bridge/settings') return { projectId: null, title: 'Bridge settings updated', kind: 'info', section: 'settings' };
  if ((m = pathname.match(/^\/api\/provision\/[^/]+\/complete$/))) {
    const j = o.job || {};
    return { projectId: j.projectId, title: `Agents ready for ${j.businessName || 'your brand'}`, body: `${(j.agents || []).length || 6} dedicated agents created.`, kind: 'success' };
  }
  if (pathname.startsWith('/api/channel-jobs')) return null; // channel routes add their own notifications
  if ((m = pathname.match(/^\/api\/(?:ig\/actions\/[^/]+\/complete|chat\/reply)$/))) {
    const pid = b.projectId;
    if (pathname.startsWith('/api/chat')) return null; // Ask Relix chat messages never create notifications
    return actionDoneNotif(pid, o.action, b.result);
  }
  m = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)$/);
  if (!m) return null;
  const pid = decodeURIComponent(m[1]);
  const rest = m[2];
  const item = o.item || {};
  const cap = firstLine(item.caption, 70);
  if (rest === '/profile') return { projectId: pid, title: 'Brand updated', body: o.brand?.brandName ? `Brand name: ${o.brand.brandName}` : '', kind: 'info', section: 'settings' };
  if (rest === '/settings') return { projectId: pid, title: 'Settings updated', kind: 'info', section: 'settings' };
  if (rest === '/chat/refresh') return { projectId: pid, title: 'Ask Relix chat cleared', kind: 'info', section: 'chat' };
  if (rest === '/chat' || rest === '/chat/reply' || rest === '/chat/agent-reply' || rest === '/chat/widget-answer' || rest === '/chat/completed') return null; // Ask Relix chat messages never create notifications
  if (rest === '/chat/connector-action') return null; // channel connect adds its own notification
  if (rest === '/connections/test') return null; // credential test writes its own channel notifications
  if (rest === '/ig/queue') return { projectId: pid, title: 'New post added to Preview', body: cap, kind: 'info', section: 'preview' };
  if (rest === '/ig/morning-draft') return { projectId: pid, title: `Post for ${item.postDate || 'tomorrow'} is ready for approval`, body: cap, kind: 'warning', section: 'preview' };
  if (rest === '/analytics/sync') return { projectId: pid, title: 'Analytics refreshed', body: `${(o.posts || []).length} posts updated.`, kind: 'info', section: 'analytics', dedupeMs: 6 * 60 * 60 * 1000 };
  let r;
  if ((r = rest.match(/^\/ig\/([^/]+)\/(approve|request-changes|reject|update|email-sent)$/))) {
    const verb = r[2];
    if (verb === 'approve') return { projectId: pid, title: `Post approved${viaLabel(item.approvedVia)}`, body: `${cap}${item.postDate ? ` · scheduled for ${item.postDate}` : ''}`, kind: 'success', section: 'preview' };
    if (verb === 'request-changes') return { projectId: pid, title: `Changes requested${viaLabel(b.via || 'relix')}`, body: firstLine(b.feedback, 140), kind: 'warning', section: 'preview' };
    if (verb === 'reject') return { projectId: pid, title: `Post rejected${viaLabel(b.via || 'relix')}`, body: cap, kind: 'error', section: 'preview' };
    if (verb === 'update') return { projectId: pid, title: `Revised post ready for approval${item.revision ? ` (revision ${item.revision})` : ''}`, body: cap, kind: 'warning', section: 'preview' };
    if (verb === 'email-sent') return { projectId: pid, title: 'Approval email sent', body: `${item.approvalEmail?.to || 'Your inbox'} · ${cap}`, kind: 'info', section: 'preview' };
  }
  if ((r = rest.match(/^\/ig\/actions\/[^/]+\/complete$/))) return actionDoneNotif(pid, o.action, b.result);
  if (rest === '/notifications') return null;
  if (rest.startsWith('/channels')) return null;
  return { projectId: pid, title: 'Workspace updated', kind: 'info' };
}

function actionDoneNotif(pid, action, result) {
  if (!action) return null;
  const cap = firstLine(action.post?.caption, 70);
  if (action.action === 'publish') {
    const failed = result && (result.error || result.status === 'failed');
    if (failed) return { projectId: pid, title: 'Scheduling failed', body: firstLine(result.error || cap, 140), kind: 'error', section: 'preview' };
    return { projectId: pid, title: `Post scheduled on Instagram${action.publishOn ? ` for ${action.publishOn} at ${action.publishTimeIst || '10:10'} IST` : ''}`, body: cap, kind: 'success', section: 'preview' };
  }
  if (action.action === 'revise') return { projectId: pid, title: 'Revision started', body: cap, kind: 'info', section: 'preview' };
  return { projectId: pid, title: `Task completed: ${action.action || 'action'}`, body: cap, kind: 'info' };
}

function notificationMiddleware(req, res, next) {
  if (req.method !== 'POST' || !req.path.startsWith('/api/')) return next();
  const origJson = res.json.bind(res);
  res.json = (data) => {
    if (res.statusCode < 400) {
      try {
        const d = describeChange(req.method, req.path, req.body, data);
        if (d && d.title) addNotification(d.projectId || null, d);
      } catch {
        /* ignore */
      }
    }
    return origJson(data);
  };
  next();
}

function jwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
}

function signSession(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const body = Buffer.from(JSON.stringify({
    sub: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
    exp,
  })).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function readSessionToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac('sha256', jwtSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function workerAuthorized(req) {
  const expected = String(process.env.RELIX_WORKER_API_KEY || '');
  const got = String(req.get(WORKER_HEADER) || '');
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicSession(user) {
  return {
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
    loggedInAt: new Date().toISOString(),
    displayName: user.displayName || 'Relix',
    emailNotifications: user.emailNotifications !== false,
    pushNotifications: user.pushNotifications === true,
    weeklyDigest: user.weeklyDigest !== false,
    confirmBeforeProceed: user.confirmBeforeProceed !== false,
  };
}

function actorCanAccessProject(req, projectId) {
  if (req.authKind === 'worker') return true;
  const user = req.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const project = listProjects().find((p) => p.id === projectId);
  return String(project?.ownerEmail || '').toLowerCase() === String(user.email || '').toLowerCase();
}

function routeKind(req) {
  const method = req.method;
  const p = req.path;
  if (method === 'GET' && p === '/api/health') return 'public';
  if (method === 'POST' && (p === '/api/auth/login' || p === '/api/auth/signup')) return 'public';
  if (method === 'GET' && (p === '/api/channels/callback' || p === '/api/channels/go')) return 'public';
  if (method === 'POST' && p === '/api/channels/callback/select') return 'public';
  if (method === 'GET' && p === '/api/ig/email-action') return 'public';
  // Logos, drafts, and brand references are loaded by img tags and by the worker.
  if ((method === 'GET' || method === 'HEAD') && p.startsWith('/media/')) return 'public';
  const worker =
    (method === 'GET' && p === '/api/bridge/settings') ||
    (method === 'POST' && p === '/api/bridge/settings') ||
    (method === 'GET' && p === '/api/provision/queue') ||
    (method === 'POST' && /^\/api\/provision\/[^/]+\/complete$/.test(p)) ||
    (method === 'GET' && p === '/api/chat/pending-all') ||
    (method === 'POST' && p === '/api/chat/reply') ||
    (method === 'GET' && p === '/api/leads/pending') ||
    (method === 'POST' && /^\/api\/leads\/[^/]+\/sent$/.test(p)) ||
    (method === 'GET' && p === '/api/ig/actions/pending-all') ||
    (method === 'POST' && /^\/api\/ig\/actions\/[^/]+\/complete$/.test(p)) ||
    (method === 'GET' && p === '/api/channel-jobs') ||
    (method === 'POST' && /^\/api\/channel-jobs\/[^/]+\/result$/.test(p)) ||
    (method === 'GET' && /^\/api\/projects\/[^/]+\/chat\/pending$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/chat\/reply$/.test(p)) ||
    (method === 'GET' && /^\/api\/projects\/[^/]+\/ig\/actions\/pending$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/actions\/[^/]+\/complete$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/queue$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/[^/]+\/update$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/[^/]+\/email-sent$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/morning-draft$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/analytics\/sync$/.test(p)) ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/channels\/[^/]+\/sync$/.test(p)) ||
    (method === 'GET' && p === '/api/worker/projects') ||
    (method === 'GET' && p === '/api/ig/awaiting-email') ||
    (method === 'GET' && p === '/api/ig/needs-image') ||
    (method === 'POST' && /^\/api\/projects\/[^/]+\/ig\/[^/]+\/generated-image$/.test(p));
  if (worker) return 'worker';
  const either =
    /^\/api\/projects\/[^/]+\/ig\/[^/]+\/(approve|request-changes|reject|retry)$/.test(p) ||
    (method === 'GET' && /^\/api\/projects\/[^/]+\/ig\/queue$/.test(p)) ||
    (method === 'GET' && /^\/api\/projects\/[^/]+\/channels$/.test(p)) ||
    (method === 'GET' && /^\/api\/projects\/[^/]+\/brand-references$/.test(p));
  if (either) return 'either';
  return 'user';
}

function authMiddleware(req, res, next) {
  const kind = routeKind(req);
  const worker = workerAuthorized(req);
  const header = String(req.get('authorization') || '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const token = readCookie(req, SESSION_COOKIE) || bearer;
  let user = null;
  if (token && kind !== 'worker') {
    try {
      const payload = readSessionToken(token);
      if (payload) user = currentUserRecord(payload.sub);
    } catch {
      user = null;
    }
  }
  req.user = user;
  if (kind === 'public') return next();
  if (kind === 'worker') {
    if (!worker) return res.status(401).json({ error: 'worker API key required' });
    req.authKind = 'worker';
    return next();
  }
  if (kind === 'either' && worker) {
    req.authKind = 'worker';
    return next();
  }
  if (!user) return res.status(401).json({ error: 'authentication required' });
  req.authKind = 'user';
  next();
}

function configuredOrigins() {
  return String(process.env.WEB_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = configuredOrigins();
    if (allowed.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  runExclusive(async () => {
    await new Promise((resolve, reject) => {
      const origEnd = res.end;
      let ended = false;
      res.end = function endWithFlush(...args) {
        if (ended) return this;
        ended = true;
        flushStore()
          .then(() => {
            origEnd.apply(this, args);
            resolve();
          })
          .catch(reject);
        return this;
      };
      try {
        next();
      } catch (error) {
        reject(error);
      }
    });
  }).catch((error) => {
    console.error('[relix-api] request failed', error);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
});
app.use(authMiddleware);
app.use(notificationMiddleware);

app.use('/media', express.static(PUBLIC_MEDIA));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'relix-api',
    time: new Date().toISOString(),
    store: 'postgres',
  });
});

app.post('/api/auth/signup', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  if (password.length <= 6) {
    return res.status(400).json({ error: 'password must be more than 6 characters' });
  }
  const store = readUsers();
  if (store.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'email already registered' });
  }
  const user = {
    email,
    passwordHash: hashPassword(password),
    role: 'user',
    displayName: 'Relix',
    emailNotifications: true,
    pushNotifications: false,
    weeklyDigest: true,
    confirmBeforeProceed: true,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeUsers(store);
  setSessionCookie(res, signSession(user));
  res.json(publicSession(user));
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const user = currentUserRecord(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  setSessionCookie(res, signSession(user));
  res.json(publicSession(user));
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json(publicSession(req.user));
});

app.post('/api/auth/password', (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length <= 6) {
    return res.status(400).json({ error: 'password must be more than 6 characters' });
  }
  const store = readUsers();
  const user = store.users.find((u) => u.email === req.user.email);
  if (!user || !verifyPassword(current, user.passwordHash)) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }
  user.passwordHash = hashPassword(next);
  writeUsers(store);
  res.json({ ok: true });
});

app.patch('/api/me', (req, res) => {
  const store = readUsers();
  const user = store.users.find((u) => u.email === req.user.email);
  if (!user) return res.status(401).json({ error: 'authentication required' });
  const body = req.body || {};
  if (body.displayName !== undefined) {
    const name = String(body.displayName || '').trim();
    if (!name) return res.status(400).json({ error: 'display name required' });
    user.displayName = name.slice(0, 80);
  }
  if (body.emailNotifications !== undefined) user.emailNotifications = Boolean(body.emailNotifications);
  if (body.pushNotifications !== undefined) user.pushNotifications = Boolean(body.pushNotifications);
  if (body.weeklyDigest !== undefined) user.weeklyDigest = Boolean(body.weeklyDigest);
  if (body.confirmBeforeProceed !== undefined) user.confirmBeforeProceed = Boolean(body.confirmBeforeProceed);
  writeUsers(store);
  req.user = user;
  res.json(publicSession(user));
});

app.get('/api/projects', (req, res) => {
  res.json({ projects: listProjectsForEmail(req.user.email).map(publicProject) });
});

app.get('/api/projects/:projectId', (req, res) => {
  const project = listProjects().find((p) => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });
  if (!actorCanAccessProject(req, project.id)) return res.status(403).json({ error: 'forbidden' });
  res.json({ project: publicProject(project) });
});

app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const description = String(req.body?.description || '').trim();
  const website = String(req.body?.website || '').trim();
  const industry = String(req.body?.industry || '').trim();
  if (website && !isUrlish(website)) {
    return res.status(400).json({ error: 'website must look like a URL' });
  }
  const requestedOwner = String(req.body?.ownerEmail || req.body?.email || '').trim().toLowerCase();
  const ownerEmail = req.user.role === 'admin' && requestedOwner ? requestedOwner : req.user.email;
  const goal = String(req.body?.goal || 'Grow my brand').trim() || 'Grow my brand';
  const project = createProjectRecord({ name, description, website, industry, ownerEmail });
  writeProjectBrand(project.id, {
    brandName: name,
    website,
    industry,
    tagline: '',
    brandVoice: '',
    targetAudience: '',
    competitors: '',
    notes: '',
  });
  writeJson(path.join(projectDir(project.id), 'onboarding.json'), {
    email: ownerEmail || '',
    goal,
    businessName: name,
    website,
    industry,
    completedAt: new Date().toISOString(),
    teamSize: 6,
    source: 'add_project',
  });
  const provisionJob = enqueueProvisionJob({
    projectId: project.id,
    email: ownerEmail,
    goal,
    businessName: name,
    website,
    industry,
  });
  res.json({ project, provisionJobId: provisionJob.id });
});

app.post('/api/projects/:projectId/profile', requireProject, (req, res) => {
  const body = req.body || {};
  const brand = {
    brandName: String(body.brandName || body.businessName || '').trim(),
    website: String(body.website || '').trim(),
    industry: String(body.industry || '').trim(),
    tagline: String(body.tagline || '').trim(),
    brandVoice: String(body.brandVoice || '').trim(),
    targetAudience: String(body.targetAudience || '').trim(),
    competitors: String(body.competitors || '').trim(),
    notes: String(body.notes || '').trim(),
  };
  const goal = body.goal !== undefined ? String(body.goal || '').trim() : undefined;
  writeProjectBrand(req.projectId, brand);
  const onboardingPath = path.join(projectDir(req.projectId), 'onboarding.json');
  if (goal !== undefined || jsonDataExists(onboardingPath)) {
    const prev = readJson(onboardingPath, {});
    writeJson(onboardingPath, {
      ...prev,
      goal: goal !== undefined ? goal : prev.goal || '',
      businessName: brand.brandName || prev.businessName || '',
      website: brand.website || prev.website || '',
      industry: brand.industry || prev.industry || '',
      updatedAt: new Date().toISOString(),
    });
  }
  res.json({ ok: true, brand, goal: goal || null });
});

function defaultGoals(projectId) {
  const onboarding = readJson(path.join(projectDir(projectId), 'onboarding.json'), {});
  const saved = readJson(path.join(projectDir(projectId), 'goals.json'), null);
  if (saved && typeof saved === 'object') {
    return {
      objectives: String(saved.objectives ?? onboarding.goal ?? ''),
      primaryKpi: String(saved.primaryKpi || 'Engagement rate'),
      monthlyContentVolume: Number(saved.monthlyContentVolume ?? 12) || 12,
      platforms: Array.isArray(saved.platforms) ? saved.platforms.map(String) : [],
    };
  }
  return {
    objectives: String(onboarding.goal || ''),
    primaryKpi: 'Engagement rate',
    monthlyContentVolume: 12,
    platforms: [],
  };
}

app.get('/api/projects/:projectId/profile', requireProject, (req, res) => {
  const brand = readJson(path.join(projectDir(req.projectId), 'brand.json'), {
    brandName: '',
    website: '',
    industry: '',
    tagline: '',
    brandVoice: '',
    targetAudience: '',
    competitors: '',
    notes: '',
  });
  res.json({ brand });
});

app.get('/api/projects/:projectId/goals', requireProject, (req, res) => {
  res.json(defaultGoals(req.projectId));
});

app.put('/api/projects/:projectId/goals', requireProject, (req, res) => {
  const body = req.body || {};
  const objectives = String(body.objectives ?? '').trim();
  if (!objectives) return res.status(400).json({ error: 'objectives required' });
  const goals = {
    objectives,
    primaryKpi: String(body.primaryKpi || 'Engagement rate').slice(0, 120),
    monthlyContentVolume: Math.max(0, Math.round(Number(body.monthlyContentVolume ?? 12) || 0)),
    platforms: Array.isArray(body.platforms) ? body.platforms.map((p) => String(p).slice(0, 40)).slice(0, 12) : [],
  };
  writeJson(path.join(projectDir(req.projectId), 'goals.json'), goals);
  const onboardingPath = path.join(projectDir(req.projectId), 'onboarding.json');
  const prev = readJson(onboardingPath, {});
  writeJson(onboardingPath, { ...prev, goal: objectives, updatedAt: new Date().toISOString() });
  res.json(goals);
});

app.get('/api/projects/:projectId/briefs', requireProject, (req, res) => {
  const store = readJson(path.join(projectDir(req.projectId), 'briefs.json'), { items: [] });
  res.json({ items: Array.isArray(store.items) ? store.items : [] });
});

app.post('/api/projects/:projectId/briefs', requireProject, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const keyMessage = String(body.keyMessage || '').trim();
  if (!title || !keyMessage) return res.status(400).json({ error: 'title and keyMessage required' });
  const item = {
    id: uid('brief'),
    title: title.slice(0, 200),
    platform: String(body.platform || 'Instagram').slice(0, 40),
    tone: String(body.tone || 'Professional').slice(0, 40),
    cta: String(body.cta || '').slice(0, 200),
    keyMessage: keyMessage.slice(0, 2000),
    deadline: String(body.deadline || '').slice(0, 40),
    notes: String(body.notes || '').slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
  const file = path.join(projectDir(req.projectId), 'briefs.json');
  const store = readJson(file, { items: [] });
  if (!Array.isArray(store.items)) store.items = [];
  store.items.unshift(item);
  writeJson(file, store);
  res.json({ ok: true, item, items: store.items });
});

app.delete('/api/projects/:projectId/briefs/:briefId', requireProject, (req, res) => {
  const file = path.join(projectDir(req.projectId), 'briefs.json');
  const store = readJson(file, { items: [] });
  const before = Array.isArray(store.items) ? store.items.length : 0;
  store.items = (store.items || []).filter((item) => item.id !== req.params.briefId);
  if (store.items.length === before) return res.status(404).json({ error: 'brief not found' });
  writeJson(file, store);
  res.json({ ok: true, items: store.items });
});

app.post('/api/onboarding/complete', (req, res) => {
  const email = req.user.email;
  const goal = String(req.body?.goal || '').trim();
  const businessName = String(req.body?.businessName || '').trim();
  const website = String(req.body?.website || '').trim();
  const industry = String(req.body?.industry || '').trim();

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  if (!goal) return res.status(400).json({ error: 'goal required' });
  if (!businessName) return res.status(400).json({ error: 'businessName required' });
  if (!industry) return res.status(400).json({ error: 'industry required' });
  if (website && !isUrlish(website)) {
    return res.status(400).json({ error: 'website must look like a URL' });
  }

  const project = createProjectRecord({
    name: businessName,
    description: `${goal} — ${industry}`,
    website,
    industry,
    ownerEmail: email,
  });

  const onboarding = {
    email,
    goal,
    businessName,
    website,
    industry,
    completedAt: new Date().toISOString(),
    teamSize: 6,
  };
  writeJson(path.join(projectDir(project.id), 'onboarding.json'), onboarding);

  const brand = {
    brandName: businessName,
    website,
    industry,
    tagline: '',
    brandVoice: '',
    targetAudience: '',
    competitors: '',
    notes: '',
  };
  writeProjectBrand(project.id, brand);

  const provisionJob = enqueueProvisionJob({
    projectId: project.id,
    email,
    goal,
    businessName,
    website,
    industry,
  });

  const session = { email, loggedInAt: new Date().toISOString() };
  res.json({
    project,
    session,
    provisionJobId: provisionJob.id,
    brand,
    goals: { objectives: goal },
  });
});


app.get('/api/bridge/settings', (_req, res) => {
  res.json(readBridgeSettings());
});

app.post('/api/bridge/settings', (req, res) => {
  const current = readBridgeSettings();
  const next = {
    ...current,
    webhookUrl: String(req.body?.webhookUrl ?? current.webhookUrl ?? '').trim(),
  };
  writeJson(path.join(DATA_DIR, 'bridge-settings.json'), next);
  res.json({ ok: true, settings: next });
});

app.get('/api/provision/queue', (_req, res) => {
  res.json(readProvisionQueue());
});


app.get('/api/projects/:projectId/team', requireProject, (req, res) => {
  const teamPath = path.join(projectDir(req.projectId), 'team.json');
  const team = readJson(teamPath, null);
  if (!team) {
    return res.json({
      projectId: req.projectId,
      status: 'pending',
      channelId: null,
      channelName: null,
      agents: [],
      goal: null,
      businessName: null,
    });
  }
  res.json({
    projectId: req.projectId,
    status: 'ready',
    ...team,
  });
});

app.post('/api/provision/:jobId/complete', (req, res) => {
  const queue = readProvisionQueue();
  const job = (queue.jobs || []).find((j) => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  const body = req.body || {};
  job.status = 'done';
  job.agentIds = body.agentIds || job.agentIds || [];
  job.agents = body.agents || job.agents || [];
  job.channelId = body.channelId || job.channelId || null;
  job.channelName = body.channelName || job.channelName || job.businessName || null;
  job.completedAt = new Date().toISOString();
  writeJson(PROVISION_QUEUE_FILE, queue);
  if (job.projectId) {
    writeJson(path.join(projectDir(job.projectId), 'team.json'), {
      channelId: job.channelId,
      channelName: job.channelName,
      agents: job.agents,
      goal: job.goal,
      businessName: job.businessName,
      provisionedAt: job.completedAt,
    });
  }
  res.json({ ok: true, job });
});

// ——— Chat (project-scoped) ———

app.post('/api/projects/:projectId/chat/refresh', requireProject, (req, res) => {
  const chat = resetChatThread(req.projectId);
  res.json({ ok: true, chat });
});

app.get('/api/projects/:projectId/chat', requireProject, (req, res) => {
  const chat = readJson(req.files.chat, { messages: [], pendingReply: false });
  recordCompletedChatLead(req.projectId, chat);
  res.json(deriveChatBlocks(req.projectId, chat));
});

app.post('/api/projects/:projectId/chat', requireProject, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const { userMsg, job, chat } = pushUserChatMessage(req.projectId, req.files, text);
  res.json({ ok: true, message: userMsg, jobId: job.id, chat: deriveChatBlocks(req.projectId, chat) });
});

app.get('/api/projects/:projectId/chat/pending', requireProject, (req, res) => {
  const inbox = readJson(req.files.chatInbox, { jobs: [] });
  res.json({
    jobs: (inbox.jobs || [])
      .filter((j) => j.status === 'pending')
      .map((j) => ({ ...j, projectId: req.projectId })),
  });
});


function leadSinkEmail() {
  return String(process.env.RELIX_LEAD_SINK_EMAIL || '').trim();
}
const LEADS_FILE = path.join(DATA_DIR, 'chat-leads.json');
const LEAD_TEXT_MAX = 1000;

function redactLeadText(text) {
  let t = String(text || '');
  t = t.replace(/sk-[A-Za-z0-9_\-]{8,}/g, '[redacted]');
  t = t.replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [redacted]');
  t = t.replace(/\b(api[_-]?key|secret|password|token|authorization)\b\s*[:=]\s*\S+/gi, '$1=[redacted]');
  t = t.replace(/https?:\/\/[^\s)]+/gi, (url) => (/zernio/i.test(url) ? '' : url));
  t = t.replace(/\bZernio\b/gi, 'the connector');
  t = t.replace(/^[ \t]*Docs:[ \t]*$/gim, '');
  t = t.replace(/^[ \t]*\d+\.[ \t]*Open[ \t]*$/gim, '');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > LEAD_TEXT_MAX) t = `${t.slice(0, LEAD_TEXT_MAX - 1)}…`;
  return t;
}

function leadExchangeKey(projectId, userId, assistantId) {
  return crypto.createHash('sha256').update(`${projectId}\0${userId}\0${assistantId}`).digest('hex');
}

/** A thread is complete when every user message has a Relix reply and nothing is still waiting. */
function completedChatExchanges(chat) {
  if (!chat || chat.pendingReply) return [];
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const pairs = [];
  const waiting = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'user') {
      if (!message.id || !String(message.text || '').trim()) continue;
      waiting.push(message);
      continue;
    }
    if (message.role === 'assistant' && waiting.length && message.id && String(message.text || '').trim()) {
      pairs.push({ user: waiting.shift(), assistant: message });
    }
  }
  if (waiting.length) return [];
  return pairs;
}

function publicLead(lead) {
  const transcript = (Array.isArray(lead?.transcript) ? lead.transcript : [])
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'relix'))
    .map((turn) => ({ role: turn.role, text: redactLeadText(turn.text) }))
    .filter((turn) => turn.text);
  return {
    id: lead.id,
    projectId: lead.projectId,
    time: lead.createdAt,
    to: lead.to,
    transcript,
  };
}

function readLeadFile() {
  const store = readJson(LEADS_FILE, { leads: [] });
  if (!Array.isArray(store.leads)) store.leads = [];
  return store;
}

function writeLeadFile(store) {
  writeJson(LEADS_FILE, store);
}

function recordCompletedChatLead(projectId, chat) {
  try {
    const pairs = completedChatExchanges(chat);
    if (!pairs.length) return [];
    const now = new Date().toISOString();
    const drafts = [];
    for (const pair of pairs) {
      const userText = redactLeadText(pair.user.text);
      const relixText = redactLeadText(pair.assistant.text);
      if (!userText || !relixText) continue;
      drafts.push({
        id: uid('lead'),
        projectId,
        createdAt: pair.assistant.createdAt || now,
        to: leadSinkEmail(),
        exchangeKey: leadExchangeKey(projectId, pair.user.id, pair.assistant.id),
        transcript: [
          { role: 'user', text: userText },
          { role: 'relix', text: relixText },
        ],
      });
    }
    if (!drafts.length) return [];
    const store = readLeadFile();
    const saved = [];
    for (const draft of drafts) {
      const existing = store.leads.find((lead) => lead.exchangeKey === draft.exchangeKey);
      if (existing) {
        saved.push(existing);
        continue;
      }
      store.leads.push({ ...draft, emailedAt: null });
      saved.push(store.leads[store.leads.length - 1]);
    }
    writeLeadFile(store);
    return saved;
  } catch {
    console.error('[relix-api] lead capture failed');
    return [];
  }
}

function listPendingLeads() {
  return readLeadFile().leads.filter((lead) => !lead.emailedAt);
}

function markLeadEmailed(id) {
  const emailedAt = new Date().toISOString();
  const store = readLeadFile();
  const lead = store.leads.find((item) => item.id === id);
  if (!lead) return { found: false };
  if (!lead.emailedAt) {
    lead.emailedAt = emailedAt;
    writeLeadFile(store);
  }
  return { found: true, lead };
}

function captureCompletedLeads() {
  for (const project of listProjects()) {
    const chat = readJson(projectFiles(project.id).chat, { messages: [], pendingReply: false });
    recordCompletedChatLead(project.id, chat);
  }
}

function applyChatReply(projectId, files, jobId, text, attachments) {
  const chat = readJson(files.chat, { messages: [], pendingReply: false });
  const inbox = readJson(files.chatInbox, { jobs: [] });
  const archive = readJson(files.chatArchive, { jobs: [] });
  const idx = (inbox.jobs || []).findIndex((j) => j.id === jobId);
  if (idx === -1) return { error: 'job not found', status: 404 };
  const job = inbox.jobs[idx];
  job.status = 'done';
  job.repliedAt = new Date().toISOString();
  inbox.jobs.splice(idx, 1);
  archive.jobs.push(job);
  const assistantMsg = {
    id: uid('msg'),
    role: 'assistant',
    text: String(text || ''),
    attachments: sanitizeChatAttachments(attachments),
    createdAt: new Date().toISOString(),
    jobId,
  };
  chat.messages.push(assistantMsg);
  chat.pendingReply = (inbox.jobs || []).some((j) => j.status === 'pending');
  writeJson(files.chat, chat);
  writeJson(files.chatInbox, inbox);
  writeJson(files.chatArchive, archive);
  recordCompletedChatLead(projectId, chat);
  return { assistantMsg, chat };
}

app.post('/api/projects/:projectId/chat/reply', requireProject, (req, res) => {
  const { jobId, text, attachments } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  const applied = applyChatReply(req.projectId, req.files, jobId, text, attachments);
  if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
  res.json({ ok: true, message: applied.assistantMsg, chat: deriveChatBlocks(req.projectId, applied.chat) });
});

app.post('/api/projects/:projectId/chat/completed', requireProject, (req, res) => {
  const chat = readJson(req.files.chat, { messages: [], pendingReply: false });
  const leads = recordCompletedChatLead(req.projectId, chat);
  res.json({ ok: true, leads: leads.map(publicLead) });
});

app.get('/api/leads/pending', (_req, res) => {
  try {
    const leads = listPendingLeads().map(publicLead);
    res.json({ leads });
  } catch {
    console.error('[relix-api] lead list failed');
    res.status(500).json({ error: 'Could not list leads' });
  }
});

app.post('/api/leads/:id/sent', (req, res) => {
  try {
    const result = markLeadEmailed(req.params.id);
    if (!result?.found) return res.status(404).json({ error: 'lead not found' });
    res.json({ ok: true, lead: { ...publicLead(result.lead), emailedAt: result.lead.emailedAt } });
  } catch {
    console.error('[relix-api] lead sent mark failed');
    res.status(500).json({ error: 'Could not update lead' });
  }
});

const OPENAI_MISSING_ERROR = 'Add OPENAI_API_KEY to the server .env and restart the API. OpenAI is required. Agents do not run until that key is set.';

function openAiConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const model = String(process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
  return { apiKey, model };
}

function publicAgentError(err) {
  const raw = err instanceof Error ? err.message : 'Agent reply failed';
  return raw.replace(/sk-[A-Za-z0-9_\-]+/g, 'sk-…').slice(0, 300);
}

async function completeWithOpenAi(apiKey, model, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.4 }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ? String(data.error.message).slice(0, 240) : `HTTP ${res.status}`;
    throw new Error(`OpenAI chat completion failed: ${detail}`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('OpenAI returned an empty reply');
  return String(text).trim();
}

app.post('/api/projects/:projectId/chat/agent-reply', requireProject, async (req, res) => {
  const { apiKey, model } = openAiConfig();
  if (!apiKey) return res.status(503).json({ error: OPENAI_MISSING_ERROR });
  try {
    const files = req.files;
    const inbox = readJson(files.chatInbox, { jobs: [] });
    const pending = (inbox.jobs || []).filter((j) => j.status === 'pending');
    const requested = String(req.body?.jobId || '').trim();
    const job = requested
      ? (inbox.jobs || []).find((j) => j.id === requested)
      : pending[pending.length - 1];
    if (!job) return res.status(404).json({ error: requested ? 'job not found' : 'no pending chat message' });
    if (job.status !== 'pending') return res.status(409).json({ error: 'job already replied' });
    const chat = readJson(files.chat, { messages: [], pendingReply: false });
    const history = (chat.messages || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim())
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.text).slice(0, 4000) }));
    const messages = [
      {
        role: 'system',
        content: RELIX_AGENT_SYSTEM_PROMPT,
      },
      ...history,
    ];
    const replyText = await completeWithOpenAi(apiKey, model, messages);
    const applied = applyChatReply(req.projectId, files, job.id, replyText, withScopeOptions(replyText));
    if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
    res.json({ ok: true, message: applied.assistantMsg, chat: deriveChatBlocks(req.projectId, applied.chat) });
  } catch (err) {
    console.error('[relix-api] agent reply failed');
    if (!res.headersSent) res.status(502).json({ error: publicAgentError(err) });
  }
});

// ——— Chat rich blocks: widget (question card) + connector (Add card) ———
const CHAT_CONNECTOR_STATUSES = ['available', 'connecting', 'added', 'failed', 'needs_url'];
const CHAT_PLATFORM_ALIASES = { x: 'twitter', gmail: 'email', newsletter: 'email' };

function chatPlatform(raw) {
  if (!raw) return null;
  const p = String(raw).toLowerCase().trim();
  const alias = CHAT_PLATFORM_ALIASES[p] || p;
  return CHANNEL_PLATFORMS[alias] ? alias : null;
}

function clip(v, max) {
  return String(v ?? '').slice(0, max);
}

/** Normalise attachments posted by the bot. Unknown types pass through untouched (image/pdf/ig_preview). */
function sanitizeChatAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      if (a.type === 'widget') {
        const w = a.widget && typeof a.widget === 'object' ? a.widget : {};
        const options = (Array.isArray(w.options) ? w.options : [])
          .filter((o) => o && (o.label || o.value))
          .slice(0, 12)
          .map((o) => {
            const opt = {
              label: clip(o.label ?? o.value, 160),
              value: clip(o.value ?? o.label, 1000),
              style: ['primary', 'default', 'danger'].includes(o.style) ? o.style : 'default',
            };
            if (o.description) opt.description = clip(o.description, 300);
            return opt;
          });
        const widget = {
          id: clip(w.id || uid('wdg'), 80),
          prompt: clip(w.prompt, 600),
          options,
          allowCustom: Boolean(w.allowCustom),
          answered: null,
        };
        if (w.helpText) widget.helpText = clip(w.helpText, 400);
        return { type: 'widget', widget };
      }
      if (a.type === 'connector') {
        const c = a.connector && typeof a.connector === 'object' ? a.connector : {};
        const platform = chatPlatform(c.platform);
        const connector = {
          id: clip(c.id || uid('con'), 80),
          name: scrubVendorName(clip(c.name || (platform ? CHANNEL_PLATFORMS[platform] : 'Connector'), 80)),
          description: scrubVendorName(clip(c.description, 300)),
          action: c.action === 'add_connector' ? 'add_connector' : 'connect_channel',
          status: CHAT_CONNECTOR_STATUSES.includes(c.status) ? c.status : 'available',
        };
        if (c.logoUrl) connector.logoUrl = scrubPublicAssetUrl(clip(c.logoUrl, 1000));
        if (c.url && !/zernio/i.test(String(c.url))) connector.url = clip(c.url, 1000);
        if (Number.isFinite(Number(c.tools)) && c.tools !== null && c.tools !== '') connector.tools = Math.max(0, Math.round(Number(c.tools)));
        if (platform) connector.platform = platform;
        return { type: 'connector', connector };
      }
      return a;
    });
}

function scrubVendorName(value) {
  return scrubVendorText(String(value ?? ''));
}

function scrubPublicAssetUrl(value) {
  return String(value ?? '').replace(/\/connectors\/zernio\./gi, '/connectors/connector.');
}

function publicBlockId(id) {
  return String(id || '').replace(/^zernio-/i, 'connector-');
}

function clientChannel(channel) {
  if (!channel || typeof channel !== 'object') return channel;
  const next = { ...channel };
  delete next.accountId;
  delete next.providerProfileRef;
  if (next.message) next.message = scrubVendorName(next.message);
  if (next.connector) next.connector = 'Relix';
  if (next.username) next.username = scrubVendorName(next.username);
  if (next.connectUrl && /zernio|ayrshare/i.test(String(next.connectUrl))) next.connectUrl = null;
  return next;
}

function publicProject(project) {
  if (!project || typeof project !== 'object') return project;
  const next = { ...project };
  delete next.providerProfileRef;
  return next;
}

function clientNotification(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    title: item.title ? scrubVendorName(item.title) : item.title,
    body: item.body ? scrubVendorName(item.body) : item.body,
  };
}

function scrubChatForClient(chat) {
  const messages = (chat.messages || []).map((message) => {
    const next = { ...message, text: scrubVendorName(message.text) };
    if (!Array.isArray(message.attachments)) return next;
    next.attachments = message.attachments.map((attachment) => {
      if (attachment?.type === 'connector' && attachment.connector) {
        return {
          ...attachment,
          connector: {
            ...attachment.connector,
            id: publicBlockId(attachment.connector.id),
            name: scrubVendorName(attachment.connector.name),
            description: scrubVendorName(attachment.connector.description),
            logoUrl: attachment.connector.logoUrl ? scrubPublicAssetUrl(attachment.connector.logoUrl) : attachment.connector.logoUrl,
            url: attachment.connector.url && !/zernio/i.test(String(attachment.connector.url)) ? attachment.connector.url : undefined,
          },
        };
      }
      if (attachment?.type === 'widget' && attachment.widget) {
        return {
          ...attachment,
          widget: {
            ...attachment.widget,
            prompt: scrubVendorName(attachment.widget.prompt),
            helpText: attachment.widget.helpText ? scrubVendorName(attachment.widget.helpText) : attachment.widget.helpText,
          },
        };
      }
      if (attachment?.type === 'ig_preview') {
        return { ...attachment, caption: scrubVendorName(attachment.caption) };
      }
      return attachment;
    });
    return next;
  });
  return { ...chat, messages };
}

const APP_OPTIONS_ATTACHMENT = {
  type: 'widget',
  widget: {
    id: 'app-options',
    prompt: 'What should we do next?',
    options: [
      { label: "See today's post", value: "Show me today's post for this brand, including the caption and where it is scheduled.", style: 'primary' },
      { label: 'Approve or reject a draft', value: 'Show me the draft waiting for a decision so I can approve or reject it.' },
      { label: 'Connect Instagram', value: 'Help me connect Instagram for this brand. What is still missing, and what should I do next?' },
      { label: 'Ask what to post next', value: 'What should we post next for this brand? Suggest one idea that fits our voice and goals.' },
    ],
    allowCustom: false,
  },
};

function withScopeOptions(text) {
  const raw = String(text || '');
  if (!/I only help with this brand|I can't help you with that|I can’t help you with that/i.test(raw)) return [];
  return [APP_OPTIONS_ATTACHMENT];
}

/** Re-derive connector card status from the live channel records (never persisted; computed on read). */
function deriveChatBlocks(projectId, chat) {
  let channels = null;
  const messages = (chat.messages || []).map((m) => {
    if (!Array.isArray(m.attachments) || !m.attachments.some((a) => a?.type === 'connector' && a.connector?.platform)) return m;
    channels ||= readChannels(projectId);
    return {
      ...m,
      attachments: m.attachments.map((a) => {
        if (a?.type !== 'connector' || !a.connector?.platform) return a;
        const c = { ...a.connector };
        const ch = channels.find((x) => x.platform === c.platform);
        if (ch) {
          if (ch.status === 'connected') { c.status = 'added'; c.error = null; }
          else if (ch.status === 'connecting') { c.status = 'connecting'; c.error = null; }
          else if (c.status === 'needs_url') { /* keep inline URL input open */ }
          else if (ch.status === 'failed' && c.actedAt) { c.status = 'failed'; c.error = ch.message || c.error || null; }
          else { c.status = 'available'; }
        }
        return { ...a, connector: c };
      }),
    };
  });
  return scrubChatForClient({ ...chat, messages });
}

function pushUserChatMessage(projectId, files, text, meta = null) {
  const chat = readJson(files.chat, { messages: [], pendingReply: false });
  const inbox = readJson(files.chatInbox, { jobs: [] });
  const userMsg = {
    id: uid('msg'),
    role: 'user',
    text,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  chat.messages.push(userMsg);
  chat.pendingReply = true;
  const job = {
    id: uid('job'),
    text,
    messageId: userMsg.id,
    projectId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  if (meta) job.meta = meta;
  inbox.jobs.push(job);
  writeJson(files.chat, chat);
  writeJson(files.chatInbox, inbox);
  pingWebhook(projectId, 'chat', job.id);
  // Wake Relix immediately so Ask Relix replies don't wait for the 5-minute bridge run
  pingBridgeWebhook({ type: 'chat', id: job.id, projectId, text: String(text || '').slice(0, 500) });
  return { userMsg, job, chat };
}

function findChatBlock(chat, messageId, type, blockId) {
  const msg = (chat.messages || []).find((m) => m.id === messageId);
  if (!msg) return { error: 'message not found' };
  const att = (msg.attachments || []).find((a) => {
    if (a?.type !== type) return false;
    const id = a[type]?.id;
    return id === blockId || (type === 'connector' && publicBlockId(id) === blockId);
  });
  if (!att) return { error: `${type} not found` };
  return { msg, att };
}

app.post('/api/projects/:projectId/chat/widget-answer', requireProject, (req, res) => {
  const { messageId, widgetId } = req.body || {};
  const value = String(req.body?.value ?? '').trim().slice(0, 2000);
  if (!messageId || !widgetId || !value) return res.status(400).json({ error: 'messageId, widgetId and value required' });
  const chat = readJson(req.files.chat, { messages: [], pendingReply: false });
  const found = findChatBlock(chat, messageId, 'widget', widgetId);
  if (found.error) return res.status(404).json({ error: found.error });
  const w = found.att.widget;
  if (w.answered) return res.status(409).json({ error: 'already answered', chat: deriveChatBlocks(req.projectId, chat) });
  const opt = (w.options || []).find((o) => (o.value ?? o.label) === value || o.label === value);
  if (!opt && !w.allowCustom) return res.status(400).json({ error: 'value is not one of the options' });
  const answerValue = opt ? (opt.value ?? opt.label) : value;
  w.answered = { value: answerValue, label: opt ? opt.label : value, at: new Date().toISOString() };
  writeJson(req.files.chat, chat);
  const { userMsg, job, chat: next } = pushUserChatMessage(req.projectId, req.files, answerValue, {
    kind: 'widget-answer', messageId, widgetId, prompt: w.prompt,
  });
  res.json({ ok: true, message: userMsg, jobId: job.id, chat: deriveChatBlocks(req.projectId, next) });
});

app.post('/api/projects/:projectId/chat/connector-action', requireProject, async (req, res) => {
  const { messageId, connectorId } = req.body || {};
  if (!messageId || !connectorId) return res.status(400).json({ error: 'messageId and connectorId required' });
  const chat = readJson(req.files.chat, { messages: [], pendingReply: false });
  const found = findChatBlock(chat, messageId, 'connector', connectorId);
  if (found.error) return res.status(404).json({ error: found.error });
  const c = found.att.connector;
  c.actedAt = new Date().toISOString();
  const done = (extra = {}) => {
    writeJson(req.files.chat, chat);
    const derived = deriveChatBlocks(req.projectId, chat);
    const card =
      findChatBlock(derived, messageId, 'connector', publicBlockId(connectorId)).att?.connector ||
      findChatBlock(derived, messageId, 'connector', connectorId).att?.connector ||
      c;
    res.json({ ok: true, connector: card, chat: derived, ...extra });
  };
  if (c.platform) {
    const ch = readChannels(req.projectId).find((x) => x.platform === c.platform);
    if (ch?.status === 'connected') { c.status = 'added'; return done(); }
    if (OAUTH_PLATFORMS.includes(c.platform)) {
      const r = await startChannelConnect(req.projectId, c.platform, '');
      if (!r.ok) {
        c.status = 'failed';
        c.error = r.error;
        return done({ ok: false, error: r.error });
      }
      c.status = 'connecting';
      c.error = null;
      return done({ authUrl: r.authUrl, channel: clientChannel(r.channel) });
    }
    const raw = String(req.body?.url || '').trim() || String(ch?.url || '').trim();
    if (!raw) { c.status = 'needs_url'; c.error = null; return done({ needsUrl: true }); }
    const r = startChannelConnect(req.projectId, c.platform, raw);
    if (!r.ok) { c.status = 'needs_url'; c.error = r.error; return done({ ok: false, error: r.error, needsUrl: true }); }
    c.status = 'connecting';
    c.error = null;
    c.channelJobId = r.job.id;
    return done({ channel: r.channel, job: r.job });
  }
  if (c.action === 'add_connector' && c.url) {
    c.status = 'added';
    c.error = null;
    return done({ openUrl: c.url });
  }
  return res.status(400).json({ error: 'connector has no platform or url to act on' });
});

// ——— IG (project-scoped) ———
app.get('/api/projects/:projectId/ig/queue', requireProject, (req, res) => {
  seedProject(req.projectId);
  const queue = readJson(req.files.igQueue, { items: [] });
  const before = new Map((queue.items || []).map((i) => [i.id, i.status]));
  if (expireStaleIgItems(queue)) {
    writeJson(req.files.igQueue, queue);
    for (const i of queue.items || []) {
      if (i.status === 'expired' && before.get(i.id) !== 'expired') {
        addNotification(req.projectId, { title: 'Draft expired without approval', body: firstLine(i.caption, 70), kind: 'error', section: 'preview' });
      }
    }
  }
  if (req.authKind === 'worker') return res.json(queue);
  res.json({
    ...queue,
    items: (queue.items || []).map((item) => {
      if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, 'zernioPostId')) return item;
      const next = { ...item };
      delete next.zernioPostId;
      return next;
    }),
  });
});

app.post('/api/projects/:projectId/ig/queue', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const body = req.body || {};
  const createdAt = new Date().toISOString();
  const postDate = body.postDate ? String(body.postDate) : undefined;
  const expiresAt = body.expiresAt
    ? String(body.expiresAt)
    : nextMorningExpiresAt(postDate || createdAt);
  const item = {
    id: uid('ig'),
    platform: 'instagram',
    imageUrl: body.imageUrl || '',
    caption: body.caption || '',
    hashtags: parseHashtags(body.hashtags),
    status: 'pending',
    feedback: null,
    createdAt,
    updatedAt: createdAt,
  };
  if (body.calendarPostId) item.calendarPostId = String(body.calendarPostId);
  if (postDate) item.postDate = postDate;
  item.expiresAt = expiresAt;
  queue.items.unshift(item);
  writeJson(req.files.igQueue, queue);
  res.json({ ok: true, item, queue });
});

function applyApproval(projectId, itemId, via) {
  const files = projectFiles(projectId);
  const queue = readJson(files.igQueue, { items: [] });
  const actions = readJson(files.igActions, { actions: [] });
  const item = (queue.items || []).find((i) => i.id === itemId);
  if (!item) return { error: 'not found', status: 404 };
  if (!['pending', 'changes_requested'].includes(item.status)) {
    return { error: `already ${item.status}`, status: 409, item };
  }
  item.status = 'approved';
  item.updatedAt = new Date().toISOString();
  item.approvedAt = item.updatedAt;
  item.approvedVia = String(via || 'relix');
  item.feedback = null;
  const action = {
    id: uid('iga'),
    postId: item.id,
    action: 'publish',
    status: 'pending',
    projectId,
    publishOn: item.postDate || null,
    publishTimeIst: item.timeIst || '10:10',
    post: { ...item },
    createdAt: new Date().toISOString(),
  };
  actions.actions.push(action);
  writeJson(files.igQueue, queue);
  writeJson(files.igActions, actions);
  pingWebhook(projectId, 'ig_publish', action.id);
  return { item, action };
}

app.post('/api/projects/:projectId/ig/:id/approve', requireProject, (req, res) => {
  const applied = applyApproval(req.projectId, req.params.id, req.body?.via || 'relix');
  if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
  res.json({ ok: true, item: applied.item, action: applied.action });
});

app.post('/api/projects/:projectId/ig/:id/request-changes', requireProject, (req, res) => {
  const feedback = String(req.body?.feedback || '').trim();
  if (!feedback) return res.status(400).json({ error: 'feedback required' });

  const queue = readJson(req.files.igQueue, { items: [] });
  const actions = readJson(req.files.igActions, { actions: [] });
  const item = queue.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });

  if (['approved', 'published', 'rejected'].includes(item.status)) {
    return res.status(409).json({ error: `already ${item.status}` });
  }
  item.status = 'changes_requested';
  item.feedback = feedback;
  item.changesVia = String(req.body?.via || 'relix');
  item.updatedAt = new Date().toISOString();

  const action = {
    id: uid('iga'),
    postId: item.id,
    action: 'revise',
    status: 'pending',
    projectId: req.projectId,
    feedback,
    post: { ...item },
    createdAt: new Date().toISOString(),
  };
  actions.actions.push(action);

  writeJson(req.files.igQueue, queue);
  writeJson(req.files.igActions, actions);
  pingWebhook(req.projectId, 'ig_revise', action.id);

  res.json({ ok: true, item, action });
});

app.post('/api/projects/:projectId/ig/:id/reject', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const item = queue.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (['published', 'approved', 'rejected'].includes(item.status)) {
    return res.status(409).json({ error: `already ${item.status}` });
  }
  item.status = 'rejected';
  item.rejectedVia = String(req.body?.via || 'relix');
  const reason = String(req.body?.reason || '').trim();
  if (reason) item.feedback = reason;
  item.rejectedAt = new Date().toISOString();
  item.updatedAt = item.rejectedAt;
  const actions = readJson(req.files.igActions, { actions: [] });
  for (const a of actions.actions) {
    if (a.postId === item.id && a.status === 'pending') { a.status = 'cancelled'; a.cancelledAt = item.rejectedAt; }
  }
  writeJson(req.files.igQueue, queue);
  writeJson(req.files.igActions, actions);
  res.json({ ok: true, item });
});

app.post('/api/projects/:projectId/ig/:id/update', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const item = queue.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const { caption, hashtags, imageUrl } = req.body || {};
  if (caption !== undefined) item.caption = String(caption);
  if (imageUrl !== undefined) item.imageUrl = String(imageUrl);
  if (hashtags !== undefined) {
    item.hashtags = parseHashtags(hashtags);
  }
  if (item.feedback) item.lastFeedback = item.feedback;
  item.revision = (item.revision || 1) + 1;
  if (item.approvalEmail) {
    item.pastApprovalEmails = [...(item.pastApprovalEmails || []), item.approvalEmail];
    delete item.approvalEmail;
  }
  item.status = 'pending';
  item.feedback = null;
  item.updatedAt = new Date().toISOString();

  const actions = readJson(req.files.igActions, { actions: [] });
  for (const a of actions.actions) {
    if (a.postId === item.id && a.action === 'revise' && ['pending', 'in_progress'].includes(a.status)) {
      a.status = 'done';
      a.completedAt = item.updatedAt;
    }
  }
  writeJson(req.files.igActions, actions);
  writeJson(req.files.igQueue, queue);
  res.json({ ok: true, item });
});

app.post('/api/projects/:projectId/ig/:id/email-sent', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const item = queue.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  item.approvalEmail = {
    threadId: String(req.body?.threadId || ''),
    messageId: String(req.body?.messageId || ''),
    to: String(req.body?.to || ''),
    sentAt: new Date().toISOString(),
  };
  writeJson(req.files.igQueue, queue);
  res.json({ ok: true, item });
});

app.get('/api/projects/:projectId/ig/actions/pending', requireProject, (req, res) => {
  const actions = readJson(req.files.igActions, { actions: [] });
  res.json({
    actions: (actions.actions || [])
      .filter((a) => a.status === 'pending')
      .map((a) => ({ ...a, projectId: req.projectId })),
  });
});

function publishFailure(result) {
  if (result == null || result === '') return null;
  if (typeof result === 'string') return /fail/i.test(result) ? result : null;
  if (typeof result !== 'object') return null;
  if (result.error) return String(result.error);
  if (result.status === 'failed' || result.ok === false) {
    return String(result.message || result.error || 'publish failed');
  }
  return null;
}

function externalPostIdFrom(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.externalPostId || result.zernioPostId || result.postId || '').trim();
}

function completeIgAction(projectId, actionId, result) {
  const files = projectFiles(projectId);
  const actions = readJson(files.igActions, { actions: [] });
  const action = (actions.actions || []).find((a) => a.id === actionId);
  if (!action) return { error: 'not found', status: 404 };
  const now = new Date().toISOString();
  const failure = action.action === 'publish' ? publishFailure(result) : null;
  action.completedAt = now;
  if (result !== undefined) action.result = result;
  action.status = failure ? 'failed' : 'done';

  if (action.action === 'publish') {
    const queue = readJson(files.igQueue, { items: [] });
    const item = (queue.items || []).find((i) => i.id === action.postId);
    if (item) {
      item.updatedAt = now;
      if (failure) {
        item.status = 'failed';
        item.failReason = failure;
      } else {
        item.status = 'published';
        item.publishedAt = (result && typeof result === 'object' && result.publishedAt) || now;
        const externalPostId = externalPostIdFrom(result);
        if (externalPostId) {
          item.externalPostId = externalPostId;
          item.zernioPostId = externalPostId;
        }
        if (item.failReason) delete item.failReason;
      }
      writeJson(files.igQueue, queue);
      action.post = { ...item };
    }
  }
  writeJson(files.igActions, actions);

  if (
    !failure &&
    result &&
    typeof result === 'object' &&
    (result.metrics || result.thumbnailUrl || result.platformPostUrl || result.zernioPostId || result.externalPostId)
  ) {
    const store = readAnalytics(files);
    upsertAnalyticsPosts(
      store,
      [
        {
          id: result.id || result.externalPostId || result.zernioPostId || action.postId,
          zernioPostId: result.zernioPostId || result.externalPostId,
          calendarPostId: result.calendarPostId || action.post?.calendarPostId,
          caption: result.caption || action.post?.caption || '',
          publishedAt: result.publishedAt || action.completedAt,
          platformPostUrl: result.platformPostUrl || '',
          thumbnailUrl:
            (action.post?.imageUrl && String(action.post.imageUrl).startsWith('/media/')
              ? action.post.imageUrl
              : null) ||
            (result.thumbnailUrl && !isFragileRemoteThumb(result.thumbnailUrl)
              ? result.thumbnailUrl
              : null) ||
            action.post?.imageUrl ||
            result.thumbnailUrl ||
            '',
          localImageUrl: action.post?.imageUrl || undefined,
          metrics: result.metrics || {},
        },
      ],
      result.account,
    );
    writeJson(files.analytics, store);
  }
  return { action };
}

app.post('/api/projects/:projectId/ig/actions/:id/complete', requireProject, (req, res) => {
  const applied = completeIgAction(req.projectId, req.params.id, req.body?.result);
  if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
  res.json({ ok: true, action: applied.action });
});

app.post('/api/projects/:projectId/ig/:id/retry', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const item = (queue.items || []).find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (item.status !== 'failed') return res.status(409).json({ error: `already ${item.status}` });
  const now = new Date().toISOString();
  item.status = 'approved';
  item.updatedAt = now;
  item.retriedAt = now;
  const actions = readJson(req.files.igActions, { actions: [] });
  const action = {
    id: uid('iga'),
    postId: item.id,
    action: 'publish',
    status: 'pending',
    projectId: req.projectId,
    publishOn: item.postDate || null,
    publishTimeIst: item.timeIst || '10:10',
    post: { ...item },
    createdAt: now,
    retryOf: item.failReason || null,
  };
  actions.actions.push(action);
  writeJson(req.files.igQueue, queue);
  writeJson(req.files.igActions, actions);
  pingWebhook(req.projectId, 'ig_publish', action.id);
  res.json({ ok: true, item, action });
});


app.post('/api/projects/:projectId/ig/morning-draft', requireProject, (req, res) => {
  const body = req.body || {};
  const calendarPostId = String(body.calendarPostId || '').trim();
  if (!calendarPostId) return res.status(400).json({ error: 'calendarPostId required' });
  if (!body.imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!body.caption) return res.status(400).json({ error: 'caption required' });

  const queue = readJson(req.files.igQueue, { items: [] });
  expireStaleIgItems(queue);

  const now = new Date().toISOString();
  // Preview rule: drafts are for TOMORROW, shown today for approve / changes
  const postDate = body.postDate ? String(body.postDate) : tomorrowIstYmd();
  const expiresAt = body.expiresAt
    ? String(body.expiresAt)
    : nextMorningExpiresAt(postDate);
  const hashtags = parseHashtags(body.hashtags);

  const existing = (queue.items || []).find(
    (i) =>
      i.calendarPostId === calendarPostId &&
      (i.status === 'pending' || i.status === 'changes_requested')
  );

  let item;
  if (existing) {
    existing.imageUrl = String(body.imageUrl);
    existing.caption = String(body.caption);
    existing.hashtags = hashtags;
    if (postDate) existing.postDate = postDate;
    existing.expiresAt = expiresAt;
    existing.status = 'pending';
    existing.feedback = null;
    existing.updatedAt = now;
    item = existing;
  } else {
    item = {
      id: uid('ig'),
      platform: 'instagram',
      imageUrl: String(body.imageUrl),
      caption: String(body.caption),
      hashtags,
      status: 'pending',
      feedback: null,
      calendarPostId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    if (postDate) item.postDate = postDate;
    queue.items.unshift(item);
  }

  // Expire other pending/changes_requested items for older postDates when inserting a newer day
  if (postDate) {
    for (const other of queue.items || []) {
      if (other.id === item.id) continue;
      if (other.status !== 'pending' && other.status !== 'changes_requested') continue;
      if (other.postDate && other.postDate < postDate) {
        other.status = 'expired';
        other.updatedAt = now;
      }
    }
  }

  writeJson(req.files.igQueue, queue);
  res.json({ ok: true, item, queue });
});

// ——— Analytics (project-scoped) ———
function clientAnalyticsPost(post) {
  if (!post || typeof post !== 'object') return post;
  const next = { ...post };
  delete next.zernioPostId;
  if (next.thumbnailUrl) next.thumbnailUrl = String(next.thumbnailUrl).replace(/-zernio-/g, '-post-');
  if (next.platformPostUrl && /zernio/i.test(String(next.platformPostUrl))) delete next.platformPostUrl;
  return next;
}

app.get('/api/projects/:projectId/analytics', requireProject, (req, res) => {
  const store = enrichAnalyticsPosts(req.projectId, readAnalytics(req.files), req.files);
  res.json({
    account: store.account || '',
    updatedAt: store.updatedAt || null,
    posts: (store.posts || []).map(clientAnalyticsPost),
  });
});

app.get('/api/projects/:projectId/analytics/:postId', requireProject, (req, res) => {
  const store = enrichAnalyticsPosts(req.projectId, readAnalytics(req.files), req.files);
  const postId = req.params.postId;
  const post = (store.posts || []).find(
    (p) => p.id === postId || p.zernioPostId === postId || p.calendarPostId === postId
  );
  if (!post) return res.status(404).json({ error: 'post not found' });
  res.json({ post: clientAnalyticsPost(post), account: store.account || '' });
});

app.post('/api/projects/:projectId/analytics/sync', requireProject, (req, res) => {
  const body = req.body || {};
  const posts = Array.isArray(body.posts) ? body.posts : [];
  const store = readAnalytics(req.files);
  upsertAnalyticsPosts(store, posts, body.account);
  writeJson(req.files.analytics, store);
  res.json({
    ok: true,
    account: store.account || '',
    updatedAt: store.updatedAt,
    posts: store.posts || [],
  });
});

function connectionHint(apiKey) {
  const value = String(apiKey || '');
  if (!value) return { connected: false, hint: '' };
  return { connected: true, hint: value.slice(-4) };
}

function publicConnections(stored) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const ig = src.instagram && typeof src.instagram === 'object' ? src.instagram : {};
  const wa = src.whatsapp && typeof src.whatsapp === 'object' ? src.whatsapp : {};
  const em = src.email && typeof src.email === 'object' ? src.email : {};
  return {
    instagram: { ...connectionHint(ig.apiKey), account: String(ig.account || '') },
    whatsapp: { ...connectionHint(wa.apiKey), number: String(wa.number || '') },
    email: { ...connectionHint(em.apiKey), from: String(em.from || '') },
  };
}

/** Settings returned to the client. Raw API keys stay in the stored document. */
function publicSettings(doc) {
  const src = doc && typeof doc === 'object' ? doc : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === 'connections') continue;
    if (/apiKey|api_key|secret|token|password/i.test(key)) continue;
    out[key] = value;
  }
  out.webhookUrl = String(src.webhookUrl || '');
  out.connections = publicConnections(src.connections);
  return out;
}

function keepStoredSecret(current, incoming) {
  if (incoming == null) return String(current || '');
  const next = String(incoming).trim();
  if (!next) return String(current || '');
  return next;
}

function keepStoredText(current, incoming) {
  if (incoming == null) return String(current || '');
  return String(incoming).trim();
}

function mergeConnectionSecrets(current, incoming) {
  const cur = current && typeof current === 'object' ? current : {};
  const ig = cur.instagram && typeof cur.instagram === 'object' ? cur.instagram : {};
  const wa = cur.whatsapp && typeof cur.whatsapp === 'object' ? cur.whatsapp : {};
  const em = cur.email && typeof cur.email === 'object' ? cur.email : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    instagram: {
      apiKey: keepStoredSecret(ig.apiKey, inc.instagramApiKey),
      account: keepStoredText(ig.account, inc.instagramAccount),
    },
    whatsapp: {
      apiKey: keepStoredSecret(wa.apiKey, inc.whatsappApiKey),
      number: keepStoredText(wa.number, inc.whatsappNumber),
    },
    email: {
      apiKey: keepStoredSecret(em.apiKey, inc.emailApiKey),
      from: keepStoredText(em.from, inc.fromEmail),
    },
  };
}

// ——— Settings (project-scoped) ———
app.get('/api/projects/:projectId/settings', requireProject, (req, res) => {
  const prefs = req.user ? publicSession(req.user) : {};
  res.json({ ...publicSettings(readJson(req.files.settings, { webhookUrl: '' })), ...prefs });
});

app.post('/api/projects/:projectId/settings', requireProject, (req, res) => {
  const current = readJson(req.files.settings, { webhookUrl: '' });
  const body = req.body || {};
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(body, 'webhookUrl')) {
    next.webhookUrl = String(body.webhookUrl ?? '');
  }
  // Display-name / webhook saves omit connections, so stored keys stay put.
  // A blank API key on this request also keeps the stored key.
  if (body.connections && typeof body.connections === 'object') {
    next.connections = mergeConnectionSecrets(current.connections, body.connections);
  }
  writeJson(req.files.settings, next);
  if (req.user && (
    body.displayName !== undefined ||
    body.emailNotifications !== undefined ||
    body.pushNotifications !== undefined ||
    body.weeklyDigest !== undefined ||
    body.confirmBeforeProceed !== undefined
  )) {
    const users = readUsers();
    const user = users.users.find((u) => u.email === req.user.email);
    if (user) {
      if (body.displayName !== undefined && String(body.displayName).trim()) {
        user.displayName = String(body.displayName).trim().slice(0, 80);
      }
      if (body.emailNotifications !== undefined) user.emailNotifications = Boolean(body.emailNotifications);
      if (body.pushNotifications !== undefined) user.pushNotifications = Boolean(body.pushNotifications);
      if (body.weeklyDigest !== undefined) user.weeklyDigest = Boolean(body.weeklyDigest);
      if (body.confirmBeforeProceed !== undefined) user.confirmBeforeProceed = Boolean(body.confirmBeforeProceed);
      writeUsers(users);
      req.user = user;
    }
  }
  res.json({ ok: true, settings: { ...publicSettings(next), ...(req.user ? publicSession(req.user) : {}) } });
});

app.post('/api/projects/:projectId/connections/test', requireProject, (req, res) => {
  const raw = String(req.body?.platform || '').toLowerCase().trim();
  const alias = raw === 'x' ? 'twitter' : raw;
  let platforms;
  if (!alias) platforms = CREDENTIAL_PLATFORMS.slice();
  else if (!CREDENTIAL_PLATFORMS.includes(alias)) {
    return res.status(400).json({ error: 'platform must be whatsapp or email' });
  } else platforms = [alias];
  const results = platforms.map((platform) => {
    const r = applyCredentialChannel(req.projectId, platform, req.body?.url);
    return {
      platform,
      ok: r.ok,
      verified: false,
      message: r.message,
      channel: r.channel,
    };
  });
  res.json({ ok: results.every((r) => r.ok), verified: false, results });
});

// ——— Cross-project pending (Relix bridge) ———
app.get('/api/chat/pending-all', (_req, res) => {
  const jobs = [];
  for (const p of listProjects()) {
    seedProject(p.id);
    const files = projectFiles(p.id);
    const inbox = readJson(files.chatInbox, { jobs: [] });
    for (const j of inbox.jobs || []) {
      if (j.status === 'pending') {
        jobs.push({ ...j, projectId: p.id });
      }
    }
  }
  res.json({ jobs });
});

app.get('/api/ig/actions/pending-all', (_req, res) => {
  const actions = [];
  for (const p of listProjects()) {
    seedProject(p.id);
    const files = projectFiles(p.id);
    const store = readJson(files.igActions, { actions: [] });
    for (const a of store.actions || []) {
      if (a.status === 'pending') {
        actions.push({ ...a, projectId: p.id });
      }
    }
  }
  res.json({ actions });
});

// Reply / complete with projectId in body (bridge convenience)
app.post('/api/chat/reply', (req, res) => {
  const { jobId, text, attachments, projectId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  if (!projectId || !isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'projectId required' });
  }
  seedProject(projectId);
  const files = projectFiles(projectId);

  const applied = applyChatReply(projectId, files, jobId, text, attachments);
  if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
  res.json({ ok: true, message: applied.assistantMsg, chat: deriveChatBlocks(projectId, applied.chat), projectId });
});

app.post('/api/ig/actions/:id/complete', (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId || !isValidProjectId(projectId)) {
    return res.status(400).json({ error: 'projectId required' });
  }
  seedProject(projectId);
  const applied = completeIgAction(projectId, req.params.id, req.body?.result);
  if (applied.error) return res.status(applied.status || 400).json({ error: applied.error });
  res.json({ ok: true, action: applied.action, projectId });
});

app.get('/api/projects/:projectId/notifications', requireProject, (req, res) => {
  const file = notifFile(req.projectId);
  const store = readJson(file, { items: [] });
  const items = pruneNotifs(store.items);
  if (items.length !== (store.items || []).length) writeJson(file, { items });
  const global = pruneNotifs(readJson(GLOBAL_NOTIF_FILE, { items: [] }).items);
  const all = [...items, ...global].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ items: all.map(clientNotification), ttlHours: 48, serverTime: new Date().toISOString() });
});

app.post('/api/projects/:projectId/notifications', requireProject, (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const kind = ['success', 'info', 'warning', 'error'].includes(req.body?.kind) ? req.body.kind : 'info';
  const n = addNotification(req.projectId, { title, body: req.body?.body || '', kind, section: req.body?.section || null });
  res.json({ ok: true, notification: n });
});

// ——— Channels (real connection requests; worker picks up data/channel-jobs.json) ———
const CHANNEL_JOBS_FILE = path.join(DATA_DIR, 'channel-jobs.json');
const CHANNEL_PLATFORMS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
  pinterest: 'Pinterest',
  whatsapp: 'WhatsApp',
  email: 'Email / Newsletter',
};
const CHANNEL_STATUSES = ['disconnected', 'connecting', 'connected', 'failed'];
const CREDENTIAL_PLATFORMS = ['whatsapp', 'email'];
const OAUTH_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter', 'youtube', 'tiktok', 'threads', 'pinterest'];

function channelsFile(projectId) {
  return path.join(projectDir(projectId), 'channels.json');
}

function blankChannel(platform) {
  return {
    platform,
    url: '',
    status: 'disconnected',
    message: '',
    connector: null,
    connectUrl: null,
    accountId: null,
    username: null,
    updatedAt: null,
  };
}

function readChannels(projectId) {
  const store = readJson(channelsFile(projectId), { items: [] });
  const list = Array.isArray(store) ? store : store.items || [];
  return Object.keys(CHANNEL_PLATFORMS).map((p) => ({
    ...blankChannel(p),
    ...(list.find((c) => c && c.platform === p) || {}),
    platform: p,
    name: CHANNEL_PLATFORMS[p],
  }));
}

function saveChannel(projectId, platform, patch) {
  const file = channelsFile(projectId);
  const store = readJson(file, { items: [] });
  const list = Array.isArray(store) ? store : store.items || [];
  const idx = list.findIndex((c) => c && c.platform === platform);
  const prev = idx >= 0 ? list[idx] : blankChannel(platform);
  const next = { ...blankChannel(platform), ...prev, ...patch, platform, updatedAt: new Date().toISOString() };
  delete next.name;
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  writeJson(file, { items: list });
  return { ...next, name: CHANNEL_PLATFORMS[platform] };
}

function readChannelJobs() {
  const j = readJson(CHANNEL_JOBS_FILE, { jobs: [] });
  return Array.isArray(j) ? { jobs: j } : { jobs: j.jobs || [] };
}

function parseUrlLoose(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

function hostIs(u, ...domains) {
  const h = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  return domains.includes(h);
}

/** Returns { ok, url } or { ok:false, error } */
function validateChannelUrl(platform, raw) {
  const s = String(raw || '').trim();
  const label = CHANNEL_PLATFORMS[platform];
  if (!s) return { ok: false, error: `Paste your ${label} URL first.` };
  if (platform === 'email') {
    if (isValidEmail(s)) return { ok: true, url: s.toLowerCase() };
    const u = parseUrlLoose(s);
    if (u && u.hostname.includes('.') && /\./.test(u.hostname)) return { ok: true, url: u.toString() };
    return { ok: false, error: 'Enter an email address (you@brand.com) or your newsletter URL (e.g. https://brand.substack.com).' };
  }
  const u = parseUrlLoose(s);
  const seg = u ? u.pathname.split('/').filter(Boolean) : [];
  const handleRe = /^[A-Za-z0-9._-]{1,64}$/;
  if (platform === 'instagram') {
    const reserved = ['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv'];
    if (u && hostIs(u, 'instagram.com') && seg[0] && /^[A-Za-z0-9._]{1,30}$/.test(seg[0]) && !reserved.includes(seg[0].toLowerCase())) {
      return { ok: true, url: `https://www.instagram.com/${seg[0]}/` };
    }
    return { ok: false, error: 'That is not an Instagram profile URL. Use https://www.instagram.com/<handle>/' };
  }
  if (platform === 'linkedin') {
    if (u && hostIs(u, 'linkedin.com') && ['company', 'in', 'showcase', 'school'].includes((seg[0] || '').toLowerCase()) && seg[1] && handleRe.test(decodeURIComponent(seg[1]).replace(/[^\w.-]/g, '_'))) {
      return { ok: true, url: `https://www.linkedin.com/${seg[0].toLowerCase()}/${seg[1]}/` };
    }
    return { ok: false, error: 'That is not a LinkedIn page URL. Use https://www.linkedin.com/company/<name>/ or https://www.linkedin.com/in/<name>/' };
  }
  if (platform === 'twitter') {
    const reserved = ['home', 'explore', 'i', 'search', 'settings', 'intent', 'share', 'messages', 'notifications'];
    if (u && hostIs(u, 'x.com', 'twitter.com') && seg[0] && /^[A-Za-z0-9_]{1,15}$/.test(seg[0]) && !reserved.includes(seg[0].toLowerCase())) {
      return { ok: true, url: `https://x.com/${seg[0]}` };
    }
    return { ok: false, error: 'That is not an X / Twitter profile URL. Use https://x.com/<handle>' };
  }
  if (platform === 'youtube') {
    if (u && hostIs(u, 'youtube.com')) {
      if (seg[0] && /^@[A-Za-z0-9._-]{2,100}$/.test(seg[0])) return { ok: true, url: `https://www.youtube.com/${seg[0]}` };
      if (seg[0] === 'channel' && seg[1] && /^UC[A-Za-z0-9_-]{10,}$/.test(seg[1])) return { ok: true, url: `https://www.youtube.com/channel/${seg[1]}` };
    }
    return { ok: false, error: 'That is not a YouTube channel URL. Use https://www.youtube.com/@<handle> or https://www.youtube.com/channel/<id>' };
  }
  if (platform === 'whatsapp') {
    const digits = raw.replace(/^https?:\/\/(wa\.me|api\.whatsapp\.com\/send\?phone=)\/?/i, '').replace(/[^0-9]/g, '');
    if (digits.length >= 8 && digits.length <= 15) return { ok: true, url: `https://wa.me/${digits}` };
    return { ok: false, error: 'That is not a WhatsApp number. Use https://wa.me/<countrycode+number> or the number with country code.' };
  }
  return { ok: false, error: 'Unsupported platform.' };
}

function requireChannelPlatform(req, res, next) {
  const platform = String(req.params.platform || '').toLowerCase();
  const alias = platform === 'x' ? 'twitter' : platform;
  if (!CHANNEL_PLATFORMS[alias]) {
    return res.status(404).json({ error: `Unknown platform "${req.params.platform}". Use one of: ${Object.keys(CHANNEL_PLATFORMS).join(', ')}` });
  }
  req.platform = alias;
  next();
}

app.get('/api/projects/:projectId/channels', requireProject, (req, res) => {
  const items = readChannels(req.projectId);
  const project = listProjects().find((p) => p.id === req.projectId);
  if (req.authKind === 'worker') {
    return res.json({
      items,
      providerProfileRef: project?.providerProfileRef || null,
      providerConfigured: Boolean(getSocialProvider()),
      serverTime: new Date().toISOString(),
    });
  }
  res.json({
    items: items.map(clientChannel),
    providerConfigured: Boolean(getSocialProvider()),
    serverTime: new Date().toISOString(),
  });
});

function readProjectSettings(projectId) {
  return readJson(projectFiles(projectId).settings, { webhookUrl: '' });
}

function credentialKeyLooksValid(apiKey) {
  const value = String(apiKey || '').trim();
  if (value.length < 8 || value.length > 400) return false;
  return /^[A-Za-z0-9_\-./+=]+$/.test(value);
}

function connectionAccountLabel(platform, connections) {
  const bag = connections?.[platform] && typeof connections[platform] === 'object' ? connections[platform] : {};
  if (platform === 'instagram') return String(bag.account || '');
  if (platform === 'whatsapp') return String(bag.number || '');
  if (platform === 'email') return String(bag.from || '');
  return '';
}

function cancelPendingChannelJobs(projectId, platform) {
  const jobs = readChannelJobs();
  let touched = false;
  for (const j of jobs.jobs) {
    if (j.projectId === projectId && j.platform === platform && j.status === 'pending') {
      j.status = 'cancelled';
      j.updatedAt = new Date().toISOString();
      touched = true;
    }
  }
  if (touched) writeJson(CHANNEL_JOBS_FILE, jobs);
}

/** Format-check a saved Settings key and write the channels document. No network call. */
function applyCredentialChannel(projectId, platform, rawUrl) {
  const label = CHANNEL_PLATFORMS[platform];
  const settings = readProjectSettings(projectId);
  const connections = settings.connections && typeof settings.connections === 'object' ? settings.connections : {};
  const bag = connections[platform] && typeof connections[platform] === 'object' ? connections[platform] : {};
  const key = String(bag.apiKey || '').trim();
  const account = connectionAccountLabel(platform, connections);
  let url = '';
  const trimmed = String(rawUrl || '').trim();
  if (trimmed) {
    const v = validateChannelUrl(platform, trimmed);
    if (!v.ok) {
      const channel = saveChannel(projectId, platform, {
        url: trimmed, status: 'failed', message: v.error, connector: null, connectUrl: null, accountId: null, jobId: null,
      });
      addNotification(projectId, { title: 'Connection failed', body: `${label}: ${v.error}`, kind: 'error', section: 'channels' });
      return { ok: false, verified: false, platform, message: v.error, error: v.error, channel };
    }
    url = v.url;
  } else {
    const current = readChannels(projectId).find((c) => c.platform === platform);
    url = current?.url || '';
  }
  cancelPendingChannelJobs(projectId, platform);
  const prior = readChannels(projectId).find((c) => c.platform === platform);
  const note = (title, body, kind, channel) => {
    if (!prior || prior.status !== channel.status || prior.message !== channel.message) {
      addNotification(projectId, { title, body, kind, section: 'channels' });
    }
  };
  if (!key) {
    const message = `No ${label} API key saved. Paste it in Settings, then try again.`;
    const channel = saveChannel(projectId, platform, {
      url, status: 'failed', message, connector: null, connectUrl: null, accountId: null, jobId: null,
    });
    note(`${label} connection failed`, message, 'error', channel);
    return { ok: false, verified: false, platform, message, error: message, channel };
  }
  if (!credentialKeyLooksValid(key)) {
    const message = `${label} key format looks wrong. Saved, not verified with the network.`;
    const channel = saveChannel(projectId, platform, {
      url, status: 'failed', message, connector: null, connectUrl: null, accountId: account || null, jobId: null,
    });
    note(`${label} connection failed`, message, 'error', channel);
    return { ok: false, verified: false, platform, message, error: message, channel };
  }
  const message = 'saved, not verified with the network';
  const channel = saveChannel(projectId, platform, {
    url,
    status: 'connected',
    message,
    connector: platform === 'email' ? null : 'Relix posting',
    accountId: account || null,
    jobId: null,
  });
  note(`${label} connected`, message, 'success', channel);
  return { ok: true, verified: false, platform, message, channel };
}

function publicBaseUrl() {
  const raw = String(process.env.PUBLIC_BASE_URL || process.env.WEB_ORIGIN || 'http://localhost:5173');
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

function setProviderProfileRef(projectId, profileRef) {
  const projects = listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  project.providerProfileRef = profileRef;
  writeJson(path.join(DATA_DIR, 'projects.json'), projects);
}

function connectFailure(error) {
  const raw = error instanceof Error ? error.message : '';
  console.error('[relix-api] connect failed');
  if (/not configured/i.test(raw) || !getSocialProvider()) {
    return { status: 503, error: 'Posting service not configured' };
  }
  return { status: 502, error: 'Could not start connect. Try again.' };
}

function browserAuthUrl(state) {
  return `${publicBaseUrl()}/api/channels/go?s=${encodeURIComponent(state)}`;
}

function redirectChannels(res, projectId, platform, failed) {
  const target = `${publicBaseUrl()}/p/${encodeURIComponent(projectId)}/channels?${failed ? 'error' : 'connected'}=${encodeURIComponent(platform)}`;
  res.redirect(target);
}

function finishChannelConnection(projectId, platform, { accountId, username, message, status }) {
  const label = CHANNEL_PLATFORMS[platform] || platform;
  const channel = saveChannel(projectId, platform, {
    status,
    accountId: accountId || null,
    username: username || null,
    message: message || (status === 'connected' ? (username ? `Connected · @${username}` : 'Connected') : 'Connection failed.'),
    connector: status === 'connected' ? 'Relix' : null,
    connectUrl: null,
    jobId: null,
  });
  addNotification(projectId, {
    title: status === 'connected' ? `${label} connected` : `${label} connection failed`,
    body: channel.message,
    kind: status === 'connected' ? 'success' : 'error',
    section: 'channels',
  });
  return channel;
}

async function startProviderConnect(projectId, platform, options = {}) {
  const provider = getSocialProvider();
  if (!provider) return { ok: false, status: 503, error: 'Posting service not configured' };
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) return { ok: false, status: 404, error: 'project not found' };
  try {
    let profileRef = project.providerProfileRef || '';
    if (!profileRef) {
      const created = await provider.createCustomerProfile(projectId, project.name || projectId);
      profileRef = created.profileRef;
      setProviderProfileRef(projectId, profileRef);
    }
    const state = signConnectState(projectId, platform);
    const redirectUrl = `${publicBaseUrl()}/api/channels/callback?s=${encodeURIComponent(state)}`;
    const { authUrl } = await provider.getConnectUrl({
      profileRef,
      platform,
      redirectUrl,
      state,
      headless: options.headless,
    });
    rememberHandoff(state, authUrl);
    const channel = saveChannel(projectId, platform, {
      status: 'connecting',
      message: 'Waiting for you to approve access.',
      connector: 'Relix',
      connectUrl: null,
      jobId: null,
    });
    pingBridgeWebhook({ type: 'channel_connect', projectId, platform });
    return { ok: true, authUrl: browserAuthUrl(state), channel, state };
  } catch (error) {
    const failure = connectFailure(error);
    return { ok: false, ...failure, channel: null };
  }
}

/** Shared channel connect flow (Channels page + chat connector cards). */
async function startChannelConnect(projectId, platform, raw) {
  if (OAUTH_PLATFORMS.includes(platform)) return startProviderConnect(projectId, platform);
  if (CREDENTIAL_PLATFORMS.includes(platform)) {
    const r = applyCredentialChannel(projectId, platform, raw);
    if (!r.ok) return { ok: false, error: r.error, channel: r.channel };
    return { ok: true, channel: r.channel, job: null, verified: false, message: r.message };
  }
  const label = CHANNEL_PLATFORMS[platform];
  const v = validateChannelUrl(platform, String(raw || '').trim());
  if (!v.ok) {
    const channel = saveChannel(projectId, platform, {
      url: String(raw || '').trim(), status: 'failed', message: v.error, connector: null, connectUrl: null, accountId: null,
    });
    addNotification(projectId, { title: 'Connection failed', body: `${label}: ${v.error}`, kind: 'error', section: 'channels' });
    return { ok: false, error: v.error, channel };
  }
  const jobs = readChannelJobs();
  // Supersede any older pending job for the same project/platform.
  for (const j of jobs.jobs) {
    if (j.projectId === projectId && j.platform === platform && j.status === 'pending') {
      j.status = 'superseded';
      j.updatedAt = new Date().toISOString();
    }
  }
  const job = { id: uid('chj'), projectId, platform, url: v.url, status: 'pending', createdAt: new Date().toISOString() };
  jobs.jobs.push(job);
  writeJson(CHANNEL_JOBS_FILE, jobs);
  const channel = saveChannel(projectId, platform, {
    url: v.url, status: 'connecting', message: 'Finding a free connector…', connector: null, connectUrl: null, accountId: null, jobId: job.id,
  });
  addNotification(projectId, { title: `Connecting ${label}...`, body: v.url, kind: 'info', section: 'channels' });
  return { ok: true, channel, job };
}

app.post('/api/projects/:projectId/channels/:platform/connect', requireProject, requireChannelPlatform, async (req, res) => {
  try {
    const r = await startChannelConnect(req.projectId, req.platform, req.body?.url);
    if (!r.ok) {
      return res.status(r.status || 400).json({ error: r.error, channel: r.channel ? clientChannel(r.channel) : undefined });
    }
    res.json({
      ok: true,
      channel: clientChannel(r.channel),
      job: r.job || null,
      ...(r.authUrl ? { authUrl: r.authUrl } : {}),
    });
  } catch (error) {
    const failure = connectFailure(error);
    res.status(failure.status).json({ error: failure.error });
  }
});

app.post('/api/projects/:projectId/channels/:platform/disconnect', requireProject, requireChannelPlatform, (req, res) => {
  const { projectId, platform } = req;
  const label = CHANNEL_PLATFORMS[platform];
  const jobs = readChannelJobs();
  let touched = false;
  for (const j of jobs.jobs) {
    if (j.projectId === projectId && j.platform === platform && j.status === 'pending') {
      j.status = 'cancelled';
      j.updatedAt = new Date().toISOString();
      touched = true;
    }
  }
  if (touched) writeJson(CHANNEL_JOBS_FILE, jobs);
  const previous = readChannels(projectId).find((c) => c.platform === platform);
  const priorAccount = previous?.accountId || '';
  const channel = saveChannel(projectId, platform, {
    status: 'disconnected', message: '', connector: null, connectUrl: null, accountId: null, username: null, jobId: null,
  });
  const provider = getSocialProvider();
  if (provider && priorAccount) {
    provider.disconnect(priorAccount).catch(() => {});
  }
  addNotification(projectId, { title: `${label} disconnected`, body: channel.url || '', kind: 'info', section: 'channels' });
  res.json({ ok: true, channel: clientChannel(channel) });
});

app.get('/api/channel-jobs', (req, res) => {
  const status = String(req.query.status || '').trim();
  let jobs = readChannelJobs().jobs;
  if (status) jobs = jobs.filter((j) => j.status === status);
  res.json({ jobs });
});

app.post('/api/channel-jobs/:id/result', (req, res) => {
  const jobs = readChannelJobs();
  const job = jobs.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  const b = req.body || {};
  if (!['connected', 'failed'].includes(b.status)) {
    return res.status(400).json({ error: 'status must be "connected" or "failed"' });
  }
  if (job.status !== 'pending') {
    return res.status(409).json({ error: `job is already ${job.status}`, job });
  }
  const label = CHANNEL_PLATFORMS[job.platform] || job.platform;
  const message = scrubVendorName(String(b.message || '').slice(0, 400));
  const connector = b.connector ? String(b.connector).slice(0, 80) : null;
  const connectUrl = b.connectUrl ? String(b.connectUrl).slice(0, 1000) : null;
  const accountId = b.accountId ? String(b.accountId).slice(0, 120) : null;
  const username = b.username ? String(b.username).replace(/^@/, '').slice(0, 80) : null;
  job.status = b.status;
  job.result = { status: b.status, message, connector: connector || 'Relix', connectUrl, accountId, username };
  job.completedAt = new Date().toISOString();
  writeJson(CHANNEL_JOBS_FILE, jobs);
  let channel = null;
  if (isValidProjectId(job.projectId)) {
    const current = readChannels(job.projectId).find((c) => c.platform === job.platform);
    // Only apply if this job is still the live one for the channel.
    if (!current?.jobId || current.jobId === job.id) {
      channel = saveChannel(job.projectId, job.platform, {
        url: job.url,
        status: b.status,
        username,
        message: message || (b.status === 'connected' ? (username ? `Connected · @${username}` : 'Connected') : 'Connection failed'),
        connector: b.status === 'connected' ? 'Relix' : connector,
        connectUrl: b.status === 'failed' ? connectUrl : null,
        accountId: b.status === 'connected' ? accountId : null,
        jobId: null,
      });
    }
    if (b.status === 'connected') {
      addNotification(job.projectId, {
        title: `${label} connected`,
        body: channel?.message || (username ? `Connected · @${username}` : 'Connected'),
        kind: 'success',
        section: 'channels',
      });
    } else {
      addNotification(job.projectId, {
        title: `${label} connection failed`,
        body: `${message || 'Connection failed.'}${connectUrl ? ` Finish connecting: ${connectUrl}` : ''}`,
        kind: 'error',
        section: 'channels',
      });
    }
  }
  res.json({ ok: true, job, channel });
});

function queryValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function callbackQuery(req) {
  const out = {};
  for (const [key, value] of Object.entries(req.query || {})) out[key] = queryValue(value);
  return out;
}

app.get('/api/channels/go', (req, res) => {
  const state = queryValue(req.query.s);
  const url = peekHandoff(state);
  if (!url || !verifyConnectState(state)) {
    return res.status(400).type('html').send('<p>This connect link expired. Go back to Channels and try again.</p>');
  }
  res.redirect(url);
});

app.get('/api/channels/callback', async (req, res) => {
  const query = callbackQuery(req);
  const state = verifyConnectState(query.s || '');
  if (!state) return res.status(400).type('html').send('<p>This connect link expired. Go back to Channels and try again.</p>');
  const provider = getSocialProvider();
  if (!provider) {
    finishChannelConnection(state.projectId, state.platform, { status: 'failed', message: 'Posting service not configured' });
    return redirectChannels(res, state.projectId, state.platform, true);
  }
  try {
    const result = await provider.handleCallback(query);
    if ('selection' in result && result.selection) {
      return res.type('html').send(selectionPage({
        title: result.selection.title,
        options: result.selection.options,
        state: query.s,
        step: result.selection.step,
        tempToken: result.selection.tempToken,
        connectToken: result.selection.connectToken,
        profileRef: result.selection.profileRef,
        platform: state.platform,
      }));
    }
    if ('useStandardConnect' in result && result.useStandardConnect) {
      const restarted = await startProviderConnect(state.projectId, state.platform, { headless: false });
      if (restarted.ok && restarted.state) {
        const url = peekHandoff(restarted.state);
        if (url) return res.redirect(url);
      }
    }
    if ('error' in result) {
      const message = result.userFixable ? scrubVendorName(result.error) : 'Connection failed. Try again.';
      finishChannelConnection(state.projectId, state.platform, { status: 'failed', message });
      return redirectChannels(res, state.projectId, state.platform, true);
    }
    finishChannelConnection(state.projectId, state.platform, {
      status: 'connected',
      accountId: result.accountId,
      username: result.username,
    });
    return redirectChannels(res, state.projectId, state.platform, false);
  } catch (error) {
    console.error('[relix-api] connect callback failed');
    finishChannelConnection(state.projectId, state.platform, { status: 'failed', message: 'Connection failed. Try again.' });
    return redirectChannels(res, state.projectId, state.platform, true);
  }
});

app.post('/api/channels/callback/select', async (req, res) => {
  const body = req.body || {};
  const state = verifyConnectState(String(body.s || ''));
  if (!state) return res.status(400).type('html').send('<p>This connect link expired. Go back to Channels and try again.</p>');
  const provider = getSocialProvider();
  if (!provider) {
    finishChannelConnection(state.projectId, state.platform, { status: 'failed', message: 'Posting service not configured' });
    return redirectChannels(res, state.projectId, state.platform, true);
  }
  try {
    const selected = await provider.completeSelection({
      step: String(body.step || ''),
      tempToken: String(body.tempToken || ''),
      connectToken: String(body.connectToken || ''),
      profileRef: String(body.profileRef || ''),
      choiceId: String(body.choiceId || ''),
      platform: state.platform,
    });
    finishChannelConnection(state.projectId, state.platform, {
      status: 'connected',
      accountId: selected.accountId,
      username: selected.username,
    });
    return redirectChannels(res, state.projectId, state.platform, false);
  } catch (error) {
    console.error('[relix-api] account selection failed');
    finishChannelConnection(state.projectId, state.platform, { status: 'failed', message: 'Could not save that account. Try again.' });
    return redirectChannels(res, state.projectId, state.platform, true);
  }
});

app.post('/api/projects/:projectId/channels/:platform/sync', requireProject, requireChannelPlatform, (req, res) => {
  const body = req.body || {};
  const status = ['connected', 'disconnected', 'failed', 'connecting'].includes(body.status) ? body.status : 'connected';
  const username = body.username ? String(body.username).replace(/^@/, '').slice(0, 80) : null;
  const channel = saveChannel(req.projectId, req.platform, {
    status,
    username,
    accountId: body.accountId ? String(body.accountId).slice(0, 120) : null,
    message: scrubVendorName(String(body.message || (username ? `Connected · @${username}` : ''))),
    connector: status === 'connected' ? 'Relix' : null,
  });
  res.json({ ok: true, channel });
});

function brandDir(projectId) {
  return path.join(PUBLIC_MEDIA, 'brands', projectId);
}

function safeBrandFile(name) {
  const base = path.basename(String(name || ''));
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(base)) return '';
  if (!/\.(png|jpe?g|webp)$/i.test(base)) return '';
  return base;
}

app.get('/api/worker/projects', (_req, res) => {
  res.json({
    projects: listProjects().map((project) => ({
      id: project.id,
      name: project.name,
      ownerEmail: project.ownerEmail || '',
      providerProfileRef: project.providerProfileRef || null,
    })),
  });
});

app.get('/api/projects/:projectId/brand-references', requireProject, (req, res) => {
  const dir = brandDir(req.projectId);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => safeBrandFile(name)).map((name) => ({
      name,
      url: `/media/brands/${req.projectId}/${name}`,
    }))
    : [];
  res.json({ files });
});

app.post('/api/projects/:projectId/brand-references', requireProject, (req, res) => {
  const name = safeBrandFile(req.body?.filename);
  const data = String(req.body?.dataBase64 || '');
  if (!name || !data) return res.status(400).json({ error: 'filename and dataBase64 required' });
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'image is empty or too large' });
  const dir = brandDir(req.projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
  res.json({ ok: true, file: { name, url: `/media/brands/${req.projectId}/${name}` } });
});

app.get('/api/ig/awaiting-email', (_req, res) => {
  const secret = String(process.env.JWT_SECRET || '');
  const items = [];
  for (const project of listProjects()) {
    const queue = readJson(projectFiles(project.id).igQueue, { items: [] });
    for (const item of queue.items || []) {
      if (item.status !== 'pending') continue;
      if (item.approvalEmail?.sentAt) continue;
      const to = String(project.ownerEmail || '').trim();
      if (!to) continue;
      const token = signEmailAction({ projectId: project.id, itemId: item.id, action: 'approve' }, secret);
      items.push({
        projectId: project.id,
        id: item.id,
        caption: String(item.caption || ''),
        to,
        approveUrl: `${publicBaseUrl()}/api/ig/email-action?token=${encodeURIComponent(token)}`,
      });
    }
  }
  res.json({ items });
});

app.get('/api/ig/email-action', (req, res) => {
  const secret = String(process.env.JWT_SECRET || '');
  const parsed = verifyEmailAction(String(req.query.token || ''), secret);
  if (!parsed) {
    return res.status(400).type('html').send('<!doctype html><title>Relix</title><p>This approval link is not valid or has expired.</p>');
  }
  const applied = applyApproval(parsed.projectId, parsed.itemId, 'email');
  const dest = `${publicBaseUrl()}/p/${encodeURIComponent(parsed.projectId)}/preview`;
  if (applied.error && applied.status !== 409) {
    return res.status(applied.status || 400).type('html').send('<!doctype html><title>Relix</title><p>This post could not be approved.</p>');
  }
  res.redirect(302, dest);
});

app.get('/api/ig/needs-image', (_req, res) => {
  const items = [];
  for (const project of listProjects()) {
    const files = projectFiles(project.id);
    const queue = readJson(files.igQueue, { items: [] });
    const actions = readJson(files.igActions, { actions: [] });
    for (const action of actions.actions || []) {
      if (action.action !== 'revise' || action.status !== 'pending' || !action.postId) continue;
      const item = (queue.items || []).find((row) => row.id === action.postId);
      if (!item || ['approved', 'published', 'rejected'].includes(item.status)) continue;
      items.push({
        projectId: project.id,
        id: item.id,
        kind: 'revise',
        actionId: action.id,
        caption: String(item.caption || ''),
        hashtags: item.hashtags || [],
        feedback: String(action.feedback || item.feedback || ''),
      });
    }
    for (const item of queue.items || []) {
      if (!['pending', 'changes_requested'].includes(item.status)) continue;
      const missing = !String(item.imageUrl || '').trim() || item.needsImage === true;
      if (!missing) continue;
      if (items.some((row) => row.projectId === project.id && row.id === item.id)) continue;
      items.push({
        projectId: project.id,
        id: item.id,
        kind: 'missing',
        caption: String(item.caption || ''),
        hashtags: item.hashtags || [],
        feedback: String(item.feedback || ''),
      });
    }
  }
  res.json({ items });
});

app.post('/api/projects/:projectId/ig/:id/generated-image', requireProject, (req, res) => {
  const queue = readJson(req.files.igQueue, { items: [] });
  const item = (queue.items || []).find((row) => row.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (['approved', 'published', 'rejected'].includes(item.status)) {
    return res.status(409).json({ error: `already ${item.status}` });
  }
  const bytes = Buffer.from(String(req.body?.dataBase64 || ''), 'base64');
  if (!bytes.length) return res.status(400).json({ error: 'dataBase64 required' });
  const dir = path.join(PUBLIC_MEDIA, 'generated', req.projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${item.id.replace(/[^a-z0-9_-]/gi, '')}.png`;
  fs.writeFileSync(path.join(dir, filename), bytes);
  item.imageUrl = `/media/generated/${req.projectId}/${filename}`;
  item.needsImage = false;
  item.updatedAt = new Date().toISOString();
  writeJson(req.files.igQueue, queue);
  res.json({ ok: true, item: { id: item.id, status: item.status, imageUrl: item.imageUrl } });
});

app.use((err, _req, res, _next) => {
  console.error('[relix-api] unhandled error', err);
  if (!res.headersSent) res.status(500).json({ error: 'internal error' });
});

async function bootState() {
  loadEnvFile();
  if (!String(process.env.JWT_SECRET || '').trim()) {
    throw new Error('JWT_SECRET is required');
  }
  if (!String(process.env.RELIX_WORKER_API_KEY || '').trim()) {
    throw new Error('RELIX_WORKER_API_KEY is required');
  }
  if (String(process.env.SEED_ON_START || 'true') !== 'false') {
    await prepareDatabase();
  } else {
    await prepareDatabase({ skipImport: true });
  }
  await runExclusive(async () => {
    ensureSeeded();
    captureCompletedLeads();
    await flushStore();
  });
}

export function createApp() {
  return app;
}

export async function start() {
  await bootState();
  const port = Number(process.env.PORT || 8787);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[relix-api] http://0.0.0.0:${port}`);
    console.log('[relix-api] store: postgres');
    console.log(`[relix-api] projects: ${listProjects().map((p) => p.id).join(', ') || '(none yet)'}`);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  start().catch((error) => {
    console.error('[relix-api] failed to start', error);
    process.exit(1);
  });
}
