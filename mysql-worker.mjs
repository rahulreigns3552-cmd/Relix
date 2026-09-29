import mysql from 'mysql2/promise';
import { parentPort, workerData } from 'worker_threads';
import { SCHEMA_STATEMENTS } from './mysql-schema.mjs';

const sab = workerData.sab;
const ia = new Int32Array(sab);
const u8 = new Uint8Array(sab);

function parseBody(value) {
  if (value == null) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function classify(rel) {
  if (rel === 'users.json') return { type: 'users' };
  if (rel === 'projects.json') return { type: 'projects' };
  if (rel === 'provision-queue.json') return { type: 'provision' };
  if (rel === 'bridge-settings.json') return { type: 'singleton', table: 'bridge_settings' };
  if (rel === 'channel-jobs.json') return { type: 'channel_jobs' };
  if (rel === 'channel-sync-state.json') return { type: 'singleton', table: 'channel_sync_state' };
  if (rel === 'notifications-global.json') return { type: 'singleton', table: 'notifications_global' };
  const nested = /^([^/]+)\/([^/]+)\.json$/.exec(rel);
  if (nested) return { type: 'project_doc', projectId: nested[1], docKey: nested[2] };
  if (!rel.includes('/') && rel.endsWith('.json')) {
    return { type: 'app_doc', key: rel.slice(0, -'.json'.length) };
  }
  return null;
}

let conn;

async function ensureSchema() {
  for (const sql of SCHEMA_STATEMENTS) {
    await conn.query(sql);
  }
}

async function readRel(rel) {
  const kind = classify(rel);
  if (!kind) return { found: false, unmapped: true };
  if (kind.type === 'users') {
    const [rows] = await conn.query('SELECT body FROM users ORDER BY sort_order ASC, email ASC');
    if (!rows.length) return { found: false };
    return { found: true, value: { users: rows.map((r) => parseBody(r.body)) } };
  }
  if (kind.type === 'projects') {
    const [rows] = await conn.query('SELECT body FROM projects ORDER BY sort_order ASC, id ASC');
    if (!rows.length) return { found: false };
    return { found: true, value: rows.map((r) => parseBody(r.body)) };
  }
  if (kind.type === 'provision') {
    const [rows] = await conn.query('SELECT body FROM provision_queue ORDER BY sort_order ASC, id ASC');
    if (!rows.length) return { found: false };
    return { found: true, value: { jobs: rows.map((r) => parseBody(r.body)) } };
  }
  if (kind.type === 'channel_jobs') {
    const [rows] = await conn.query('SELECT body FROM channel_jobs ORDER BY sort_order ASC, id ASC');
    if (!rows.length) return { found: false };
    return { found: true, value: { jobs: rows.map((r) => parseBody(r.body)) } };
  }
  if (kind.type === 'singleton') {
    const [rows] = await conn.query(`SELECT body FROM \`${kind.table}\` WHERE id = 1`);
    if (!rows.length) return { found: false };
    return { found: true, value: parseBody(rows[0].body) };
  }
  if (kind.type === 'project_doc') {
    const [rows] = await conn.query(
      'SELECT body FROM project_docs WHERE project_id = ? AND doc_key = ?',
      [kind.projectId, kind.docKey],
    );
    if (!rows.length) return { found: false };
    return { found: true, value: parseBody(rows[0].body) };
  }
  if (kind.type === 'app_doc') {
    const [rows] = await conn.query('SELECT body FROM app_documents WHERE doc_key = ?', [kind.key]);
    if (!rows.length) return { found: false };
    return { found: true, value: parseBody(rows[0].body) };
  }
  return { found: false, unmapped: true };
}

async function existsRel(rel) {
  const hit = await readRel(rel);
  if (hit.unmapped) return hit;
  return { found: Boolean(hit.found) };
}

async function writeRel(rel, value) {
  const kind = classify(rel);
  if (!kind) {
    const err = new Error(`unmapped data path: ${rel}`);
    err.unmapped = true;
    throw err;
  }
  if (kind.type === 'users') {
    const users = Array.isArray(value?.users) ? value.users : [];
    await conn.beginTransaction();
    try {
      await conn.query('DELETE FROM users');
      for (let i = 0; i < users.length; i++) {
        const user = users[i] || {};
        await conn.query(
          'INSERT INTO users (email, password_hash, created_at, sort_order, body) VALUES (?, ?, ?, ?, ?)',
          [String(user.email || ''), String(user.passwordHash || ''), user.createdAt || null, i, JSON.stringify(user)],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return { ok: true };
  }
  if (kind.type === 'projects') {
    const projects = Array.isArray(value) ? value : [];
    await conn.beginTransaction();
    try {
      await conn.query('DELETE FROM projects');
      for (let i = 0; i < projects.length; i++) {
        const project = projects[i] || {};
        await conn.query(
          `INSERT INTO projects
            (id, name, description, website, industry, owner_email, created_at, sort_order, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(project.id || ''),
            String(project.name || ''),
            project.description || null,
            project.website || null,
            project.industry || null,
            project.ownerEmail || null,
            project.createdAt || null,
            i,
            JSON.stringify(project),
          ],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return { ok: true };
  }
  if (kind.type === 'provision' || kind.type === 'channel_jobs') {
    const table = kind.type === 'provision' ? 'provision_queue' : 'channel_jobs';
    const jobs = Array.isArray(value?.jobs) ? value.jobs : [];
    await conn.beginTransaction();
    try {
      await conn.query(`DELETE FROM \`${table}\``);
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i] || {};
        const id = String(job.id || `${table}-${i}`);
        if (table === 'provision_queue') {
          await conn.query(
            'INSERT INTO provision_queue (id, status, project_id, email, sort_order, body) VALUES (?, ?, ?, ?, ?, ?)',
            [id, job.status || null, job.projectId || null, job.email || null, i, JSON.stringify(job)],
          );
        } else {
          await conn.query(
            'INSERT INTO channel_jobs (id, project_id, platform, status, sort_order, body) VALUES (?, ?, ?, ?, ?, ?)',
            [id, job.projectId || null, job.platform || null, job.status || null, i, JSON.stringify(job)],
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return { ok: true };
  }
  if (kind.type === 'singleton') {
    await conn.query(`REPLACE INTO \`${kind.table}\` (id, body) VALUES (1, ?)`, [JSON.stringify(value)]);
    return { ok: true };
  }
  if (kind.type === 'project_doc') {
    await conn.query(
      `INSERT INTO project_docs (project_id, doc_key, body) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE body = VALUES(body)`,
      [kind.projectId, kind.docKey, JSON.stringify(value ?? null)],
    );
    return { ok: true };
  }
  if (kind.type === 'app_doc') {
    await conn.query(
      `INSERT INTO app_documents (doc_key, body) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE body = VALUES(body)`,
      [kind.key, JSON.stringify(value ?? null)],
    );
    return { ok: true };
  }
  throw new Error(`cannot write ${rel}`);
}

async function handle(op, payload) {
  if (op === 'read') return readRel(payload.rel);
  if (op === 'exists') return existsRel(payload.rel);
  if (op === 'write') return writeRel(payload.rel, payload.value);
  if (op === 'ping') {
    const [rows] = await conn.query('SELECT DATABASE() AS db, COUNT(*) AS projects FROM projects');
    return { ok: true, db: rows[0].db, projects: Number(rows[0].projects) };
  }
  throw new Error(`unknown op ${op}`);
}

function reply(obj) {
  const out = Buffer.from(JSON.stringify(obj));
  if (out.length + 16 > sab.byteLength) {
    const err = Buffer.from(JSON.stringify({ error: 'MySQL response exceeded buffer' }));
    u8.set(err, 16);
    Atomics.store(ia, 1, err.length);
  } else {
    u8.set(out, 16);
    Atomics.store(ia, 1, out.length);
  }
  Atomics.store(ia, 0, 2);
  Atomics.notify(ia, 0);
}

try {
  conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    dateStrings: true,
    connectTimeout: 10000,
  });
  await ensureSchema();
  parentPort.postMessage({ ready: true });
} catch (err) {
  parentPort.postMessage({ ready: false, error: err.message });
  process.exit(1);
}

for (;;) {
  let state = Atomics.load(ia, 0);
  if (state !== 1) {
    Atomics.wait(ia, 0, state);
    continue;
  }
  let response;
  try {
    const len = Atomics.load(ia, 1);
    const raw = Buffer.from(u8.subarray(16, 16 + len)).toString('utf8');
    const msg = JSON.parse(raw);
    response = { result: await handle(msg.op, msg.payload) };
  } catch (err) {
    response = { error: err.message || String(err) };
  }
  reply(response);
}
