import request from 'supertest';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from './domain.js';
import { prepareDatabase } from './seed.js';
import { prisma } from './store.js';

const app = createApp();
const worker = process.env.RELIX_WORKER_API_KEY || '';
const adminEmail = process.env.ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';

function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const first = list[0] || '';
  return first.split(';')[0] || '';
}

beforeAll(async () => {
  await prisma.chatLead.deleteMany();
  await prisma.projectDoc.deleteMany();
  await prisma.provisionJob.deleteMany();
  await prisma.channelJob.deleteMany();
  await prisma.bridgeSetting.deleteMany();
  await prisma.appDocument.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prepareDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('unauthenticated API calls are rejected', async () => {
  const res = await request(app).get('/api/projects');
  expect(res.status).toBe(401);
});

test('health stays public and does not list projects', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.projects).toBeUndefined();
});

test('seeded admin can log in and sees Sanctum', async () => {
  const login = await request(app).post('/api/auth/login').send({
    email: adminEmail,
    password: adminPassword,
  });
  expect(login.status).toBe(200);
  expect(login.body.email).toBe(adminEmail);
  const cookie = cookieFrom(login);
  expect(cookie.startsWith('relix_session=')).toBe(true);

  const projects = await request(app).get('/api/projects').set('Cookie', cookie);
  expect(projects.status).toBe(200);
  const sanctum = (projects.body.projects || []).find((project: { id: string }) => project.id === 'sanctum');
  expect(sanctum?.name).toBe('Sanctum');

  const queue = await request(app).get('/api/projects/sanctum/ig/queue').set('Cookie', cookie);
  expect(queue.status).toBe(200);
  expect(Array.isArray(queue.body.items)).toBe(true);
  expect(queue.body.items.length).toBeGreaterThan(0);
});

test('a non-owner cannot read another brand', async () => {
  const signup = await request(app).post('/api/auth/signup').send({
    email: 'outsider@example.com',
    password: 'more-than-six',
  });
  expect(signup.status).toBe(200);
  const cookie = cookieFrom(signup);
  const denied = await request(app).get('/api/projects/sanctum/chat').set('Cookie', cookie);
  expect(denied.status).toBe(403);
});

test('worker routes require the worker API key header', async () => {
  const open = await request(app).get('/api/chat/pending-all');
  expect(open.status).toBe(401);

  const locked = await request(app).get('/api/chat/pending-all').set('X-Relix-Worker-Key', worker);
  expect(locked.status).toBe(200);
  expect(Array.isArray(locked.body.jobs)).toBe(true);
});

test('publish complete marks the queue item published, failed, then retry', async () => {
  const created = await request(app)
    .post('/api/projects/sanctum/ig/queue')
    .set('X-Relix-Worker-Key', worker)
    .send({ caption: 'Lifecycle draft', imageUrl: '/media/sanctum-ig.png', postDate: '2099-01-02' });
  expect(created.status).toBe(200);
  const itemId = created.body.item.id as string;

  const approved = await request(app)
    .post(`/api/projects/sanctum/ig/${itemId}/approve`)
    .set('X-Relix-Worker-Key', worker)
    .send({ via: 'email' });
  expect(approved.status).toBe(200);
  expect(approved.body.item.status).toBe('approved');
  const actionId = approved.body.action.id as string;

  const failed = await request(app)
    .post(`/api/projects/sanctum/ig/actions/${actionId}/complete`)
    .set('X-Relix-Worker-Key', worker)
    .send({ result: { status: 'failed', error: 'upstream timeout' } });
  expect(failed.status).toBe(200);
  expect(failed.body.action.status).toBe('failed');

  const login = await request(app).post('/api/auth/login').send({
    email: adminEmail,
    password: adminPassword,
  });
  const cookie = cookieFrom(login);
  const queue = await request(app).get('/api/projects/sanctum/ig/queue').set('Cookie', cookie);
  const failedItem = (queue.body.items || []).find((item: { id: string }) => item.id === itemId);
  expect(failedItem.status).toBe('failed');

  const retried = await request(app)
    .post(`/api/projects/sanctum/ig/${itemId}/retry`)
    .set('Cookie', cookie)
    .send({});
  expect(retried.status).toBe(200);
  expect(retried.body.item.status).toBe('approved');
  const nextAction = retried.body.action.id as string;

  const published = await request(app)
    .post('/api/ig/actions/' + nextAction + '/complete')
    .set('X-Relix-Worker-Key', worker)
    .send({
      projectId: 'sanctum',
      result: { externalPostId: 'ext-post-1', status: 'published' },
    });
  expect(published.status).toBe(200);

  const after = await request(app).get('/api/projects/sanctum/ig/queue').set('Cookie', cookie);
  const done = (after.body.items || []).find((item: { id: string }) => item.id === itemId);
  expect(done.status).toBe('published');
  expect(done.externalPostId).toBe('ext-post-1');
});

test('password change and goals are stored on the server', async () => {
  const signup = await request(app).post('/api/auth/signup').send({
    email: 'goals@example.com',
    password: 'first-password',
  });
  const cookie = cookieFrom(signup);
  const created = await request(app).post('/api/projects').set('Cookie', cookie).send({ name: 'Goals Brand' });
  expect(created.status).toBe(200);
  const projectId = created.body.project.id as string;

  const saved = await request(app).put(`/api/projects/${projectId}/goals`).set('Cookie', cookie).send({
    objectives: 'Grow the waitlist',
    primaryKpi: 'Leads generated',
    monthlyContentVolume: 8,
    platforms: ['Instagram'],
  });
  expect(saved.status).toBe(200);

  const read = await request(app).get(`/api/projects/${projectId}/goals`).set('Cookie', cookie);
  expect(read.body.objectives).toBe('Grow the waitlist');

  const changed = await request(app).post('/api/auth/password').set('Cookie', cookie).send({
    currentPassword: 'first-password',
    newPassword: 'second-password',
  });
  expect(changed.status).toBe(200);

  const oldLogin = await request(app).post('/api/auth/login').send({
    email: 'goals@example.com',
    password: 'first-password',
  });
  expect(oldLogin.status).toBe(401);

  const newLogin = await request(app).post('/api/auth/login').send({
    email: 'goals@example.com',
    password: 'second-password',
  });
  expect(newLogin.status).toBe(200);
});
