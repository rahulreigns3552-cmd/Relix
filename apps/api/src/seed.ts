import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from './store.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');

function loadEnvFiles(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.resolve(here, '../.env'), path.resolve(here, '../../../.env')]) {
    if (!fs.existsSync(file)) continue;
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
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function readJson(file: string): unknown | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function adminEmail(): string {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) throw new Error('ADMIN_EMAIL is required');
  return email;
}

function adminPassword(): string {
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (password.length <= 6) throw new Error('ADMIN_PASSWORD must be more than 6 characters');
  return password;
}

export async function ensureAdmin(): Promise<void> {
  const email = adminEmail();
  const password = adminPassword();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        role: 'admin',
        displayName: 'Relix',
      },
    });
    return;
  }
  if (existing.role !== 'admin') {
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
  }
}

async function importUsers(ownerEmail: string): Promise<void> {
  const parsed = readJson(path.join(DATA_DIR, 'users.json'));
  const users = Array.isArray(asRecord(parsed).users) ? (asRecord(parsed).users as unknown[]) : [];
  for (const raw of users) {
    const user = asRecord(raw);
    const email = String(user.email || '').trim().toLowerCase();
    const passwordHash = String(user.passwordHash || '');
    if (!email || !passwordHash || email === ownerEmail) continue;
    const createdAt = user.createdAt ? new Date(String(user.createdAt)) : new Date();
    // Never reuse a password hash from the JSON snapshot. The only login is ADMIN_EMAIL.
    const hash = hashPassword(crypto.randomBytes(24).toString('hex'));
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: hash,
        role: 'user',
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
      },
      update: {},
    });
  }
}

async function importProjects(ownerEmail: string): Promise<void> {
  const parsed = readJson(path.join(DATA_DIR, 'projects.json'));
  const projects = Array.isArray(parsed) ? parsed : [];
  for (const raw of projects) {
    const project = asRecord(raw);
    const id = String(project.id || '').trim();
    if (!id) continue;
    const createdAt = project.createdAt ? new Date(String(project.createdAt)) : new Date();
    // Every seeded brand belongs to the admin from .env, not to an address stored in the JSON snapshot.
    const owner = ownerEmail;
    await prisma.project.upsert({
      where: { id },
      create: {
        id,
        name: String(project.name || id),
        description: String(project.description || ''),
        website: String(project.website || ''),
        industry: String(project.industry || ''),
        ownerEmail: owner,
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
      },
      update: {},
    });
    const dir = path.join(DATA_DIR, id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const body = readJson(path.join(dir, name));
      if (body == null) continue;
      await prisma.projectDoc.upsert({
        where: { projectId_docKey: { projectId: id, docKey: name } },
        create: { projectId: id, docKey: name, body: body as Prisma.InputJsonValue },
        update: {},
      });
    }
  }
}

async function importGlobals(): Promise<void> {
  const provision = asRecord(readJson(path.join(DATA_DIR, 'provision-queue.json')));
  const jobs = Array.isArray(provision.jobs) ? provision.jobs : [];
  let order = 0;
  for (const raw of jobs) {
    const job = asRecord(raw);
    const id = String(job.id || '');
    if (!id) continue;
    await prisma.provisionJob.upsert({
      where: { id },
      create: {
        id,
        status: String(job.status || 'pending'),
        projectId: job.projectId ? String(job.projectId) : null,
        email: job.email ? String(job.email) : null,
        sortOrder: order,
        body: job as Prisma.InputJsonValue,
      },
      update: {},
    });
    order += 1;
  }

  const channelFile = asRecord(readJson(path.join(DATA_DIR, 'channel-jobs.json')));
  const channelJobs = Array.isArray(channelFile.jobs) ? channelFile.jobs : [];
  order = 0;
  for (const raw of channelJobs) {
    const job = asRecord(raw);
    const id = String(job.id || '');
    if (!id) continue;
    await prisma.channelJob.upsert({
      where: { id },
      create: {
        id,
        projectId: job.projectId ? String(job.projectId) : null,
        platform: job.platform ? String(job.platform) : null,
        status: job.status ? String(job.status) : null,
        sortOrder: order,
        body: job as Prisma.InputJsonValue,
      },
      update: {},
    });
    order += 1;
  }

  const bridge = readJson(path.join(DATA_DIR, 'bridge-settings.json'));
  if (bridge && typeof bridge === 'object') {
    await prisma.bridgeSetting.upsert({
      where: { id: 1 },
      create: { id: 1, body: bridge as Prisma.InputJsonValue },
      update: {},
    });
  }
}

export async function importLegacyJson(): Promise<{ imported: boolean }> {
  if (!fs.existsSync(path.join(DATA_DIR, 'projects.json'))) return { imported: false };
  const owner = adminEmail();
  await importUsers(owner);
  await importProjects(owner);
  await importGlobals();
  return { imported: true };
}

export async function prepareDatabase(options: { skipImport?: boolean } = {}): Promise<void> {
  loadEnvFiles();
  if (!options.skipImport) await importLegacyJson();
  await ensureAdmin();
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  prepareDatabase()
    .then(async () => {
      const projects = await prisma.project.count();
      const users = await prisma.user.count();
      console.log(`[relix-seed] ready (${projects} projects, ${users} users)`);
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error('[relix-seed] failed', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
