import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

type Tx = Prisma.TransactionClient;
type Mem = Map<string, unknown>;

const memory: Mem = new Map();
const dirty = new Set<string>();
let loaded = false;
let queue: Promise<void> = Promise.resolve();

const current = new AsyncLocalStorage<true>();

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function storeReady(): boolean {
  return loaded && current.getStore() === true;
}

export function readDoc(key: string): unknown | undefined {
  if (!memory.has(key)) return undefined;
  return jsonClone(memory.get(key));
}

export function hasDoc(key: string): boolean {
  return memory.has(key);
}

export function writeDoc(key: string, value: unknown): void {
  memory.set(key, jsonClone(value));
  dirty.add(key);
}

export async function invalidateStore(): Promise<void> {
  await queue;
  memory.clear();
  dirty.clear();
  loaded = false;
}

async function loadAll(): Promise<void> {
  const [users, projects, docs, provisions, channels, bridge, appDocs, leads] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.project.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.projectDoc.findMany(),
    prisma.provisionJob.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.channelJob.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.bridgeSetting.findUnique({ where: { id: 1 } }),
    prisma.appDocument.findMany(),
    prisma.chatLead.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  memory.clear();
  dirty.clear();

  memory.set('users.json', {
    users: users.map((user) => ({
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      displayName: user.displayName,
      emailNotifications: user.emailNotifications,
      pushNotifications: user.pushNotifications,
      weeklyDigest: user.weeklyDigest,
      confirmBeforeProceed: user.confirmBeforeProceed,
      createdAt: user.createdAt.toISOString(),
    })),
  });

  memory.set(
    'projects.json',
    projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      website: project.website,
      industry: project.industry,
      ownerEmail: project.ownerEmail,
      createdAt: project.createdAt.toISOString(),
    })),
  );

  for (const doc of docs) {
    memory.set(`${doc.projectId}/${doc.docKey}`, doc.body);
  }

  memory.set(
    'provision-queue.json',
    { jobs: provisions.map((job) => job.body) },
  );
  memory.set(
    'channel-jobs.json',
    { jobs: channels.map((job) => job.body) },
  );
  if (bridge) memory.set('bridge-settings.json', bridge.body);
  for (const doc of appDocs) memory.set(doc.docKey, doc.body);
  memory.set('chat-leads.json', {
    leads: leads.map((lead) => ({
      id: lead.id,
      projectId: lead.projectId,
      createdAt: lead.createdAt,
      to: lead.toEmail,
      exchangeKey: lead.exchangeKey,
      emailedAt: lead.emailedAt,
      transcript: lead.transcript,
    })),
  });

  loaded = true;
}

async function persistUsers(tx: Tx, value: unknown): Promise<void> {
  const bag = asRecord(value);
  const users = Array.isArray(bag.users) ? bag.users : Array.isArray(value) ? value : [];
  for (const raw of users) {
    const user = asRecord(raw);
    const email = String(user.email || '').toLowerCase();
    if (!email || !user.passwordHash) continue;
    const createdAt = user.createdAt ? new Date(String(user.createdAt)) : new Date();
    const data = {
      passwordHash: String(user.passwordHash),
      role: user.role === 'admin' ? 'admin' : 'user',
      displayName: String(user.displayName || 'Relix'),
      emailNotifications: user.emailNotifications !== false,
      pushNotifications: user.pushNotifications === true,
      weeklyDigest: user.weeklyDigest !== false,
      confirmBeforeProceed: user.confirmBeforeProceed !== false,
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
    await tx.user.upsert({
      where: { email },
      create: { email, ...data },
      update: data,
    });
  }
}

async function persistProjects(tx: Tx, value: unknown): Promise<void> {
  const projects = Array.isArray(value) ? value : [];
  for (const raw of projects) {
    const project = asRecord(raw);
    const id = String(project.id || '').trim();
    if (!id) continue;
    const createdAt = project.createdAt ? new Date(String(project.createdAt)) : new Date();
    const data = {
      name: String(project.name || id),
      description: String(project.description || ''),
      website: String(project.website || ''),
      industry: String(project.industry || ''),
      ownerEmail: String(project.ownerEmail || ''),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
    await tx.project.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }
}

async function persistProvision(tx: Tx, value: unknown): Promise<void> {
  const jobs = Array.isArray(asRecord(value).jobs) ? (asRecord(value).jobs as unknown[]) : [];
  await tx.provisionJob.deleteMany();
  let order = 0;
  for (const raw of jobs) {
    const job = asRecord(raw);
    const id = String(job.id || '');
    if (!id) continue;
    await tx.provisionJob.create({
      data: {
        id,
        status: String(job.status || 'pending'),
        projectId: job.projectId ? String(job.projectId) : null,
        email: job.email ? String(job.email) : null,
        sortOrder: order,
        body: jsonClone(job) as Prisma.InputJsonValue,
      },
    });
    order += 1;
  }
}

async function persistChannelJobs(tx: Tx, value: unknown): Promise<void> {
  const jobs = Array.isArray(asRecord(value).jobs) ? (asRecord(value).jobs as unknown[]) : [];
  await tx.channelJob.deleteMany();
  let order = 0;
  for (const raw of jobs) {
    const job = asRecord(raw);
    const id = String(job.id || '');
    if (!id) continue;
    await tx.channelJob.create({
      data: {
        id,
        projectId: job.projectId ? String(job.projectId) : null,
        platform: job.platform ? String(job.platform) : null,
        status: job.status ? String(job.status) : null,
        sortOrder: order,
        body: jsonClone(job) as Prisma.InputJsonValue,
      },
    });
    order += 1;
  }
}

async function persistLeads(tx: Tx, value: unknown): Promise<void> {
  const leads = Array.isArray(asRecord(value).leads) ? (asRecord(value).leads as unknown[]) : [];
  for (const raw of leads) {
    const lead = asRecord(raw);
    const id = String(lead.id || '');
    const exchangeKey = String(lead.exchangeKey || '');
    if (!id || !exchangeKey) continue;
    const data = {
      projectId: String(lead.projectId || ''),
      createdAt: String(lead.createdAt || new Date().toISOString()),
      toEmail: String(lead.to || ''),
      emailedAt: lead.emailedAt ? String(lead.emailedAt) : null,
      transcript: (lead.transcript ?? []) as Prisma.InputJsonValue,
    };
    await tx.chatLead.upsert({
      where: { id },
      create: { id, exchangeKey, ...data },
      update: data,
    });
  }
}

async function persistKey(tx: Tx, key: string, value: unknown): Promise<void> {
  const body = jsonClone(value ?? null) as Prisma.InputJsonValue;
  if (key === 'users.json') return persistUsers(tx, value);
  if (key === 'projects.json') return persistProjects(tx, value);
  if (key === 'provision-queue.json') return persistProvision(tx, value);
  if (key === 'channel-jobs.json') return persistChannelJobs(tx, value);
  if (key === 'bridge-settings.json') {
    await tx.bridgeSetting.upsert({
      where: { id: 1 },
      create: { id: 1, body },
      update: { body },
    });
    return;
  }
  if (key === 'chat-leads.json') return persistLeads(tx, value);
  const slash = key.indexOf('/');
  if (slash > 0 && key.endsWith('.json')) {
    const projectId = key.slice(0, slash);
    const docKey = key.slice(slash + 1);
    if (!projectId.includes('/') && (await tx.project.findUnique({ where: { id: projectId } }))) {
      await tx.projectDoc.upsert({
        where: { projectId_docKey: { projectId, docKey } },
        create: { projectId, docKey, body },
        update: { body },
      });
      return;
    }
  }
  await tx.appDocument.upsert({
    where: { docKey: key },
    create: { docKey: key, body },
    update: { body },
  });
}

export async function flushStore(): Promise<void> {
  if (!dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  try {
    await prisma.$transaction(async (tx) => {
      // Projects must exist before project documents that reference them.
      const ordered = [...keys].sort((a, b) => {
        if (a === 'projects.json') return -1;
        if (b === 'projects.json') return 1;
        return a.localeCompare(b);
      });
      for (const key of ordered) {
        await persistKey(tx, key, memory.get(key));
      }
    });
  } catch (error) {
    for (const key of keys) dirty.add(key);
    throw error;
  }
}

/** Serialize request work so the in-memory snapshot and Postgres stay aligned. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    if (!loaded) await loadAll();
    return current.run(true, fn);
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
