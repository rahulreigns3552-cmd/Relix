import { Worker } from 'worker_threads';

const BUFFER_BYTES = 8 * 1024 * 1024;
const CALL_TIMEOUT_MS = 20000;

let worker = null;
let sab = null;
let ia = null;
let u8 = null;
let enabled = false;
let seq = 0;

function syncCall(op, payload) {
  const req = Buffer.from(JSON.stringify({ op, payload, id: ++seq }));
  if (req.length + 16 > sab.byteLength) {
    throw new Error('MySQL request exceeded buffer');
  }
  const deadline = Date.now() + CALL_TIMEOUT_MS;
  while (true) {
    const state = Atomics.load(ia, 0);
    if (state === 0) break;
    const wait = Atomics.wait(ia, 0, state, Math.max(1, deadline - Date.now()));
    if (wait === 'timed-out' && Date.now() >= deadline) {
      throw new Error('MySQL worker timed out waiting for idle');
    }
  }
  u8.set(req, 16);
  Atomics.store(ia, 1, req.length);
  Atomics.store(ia, 0, 1);
  Atomics.notify(ia, 0);
  while (true) {
    const state = Atomics.load(ia, 0);
    if (state === 2) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('MySQL worker timed out waiting for result');
    Atomics.wait(ia, 0, state, remaining);
  }
  const len = Atomics.load(ia, 1);
  const msg = JSON.parse(Buffer.from(u8.subarray(16, 16 + len)).toString('utf8'));
  Atomics.store(ia, 0, 0);
  Atomics.notify(ia, 0);
  if (msg.error) throw new Error(msg.error);
  return msg.result;
}

export function mysqlEnabled() {
  return enabled;
}

export function initMysql() {
  if (worker) return Promise.resolve(enabled);
  sab = new SharedArrayBuffer(BUFFER_BYTES);
  ia = new Int32Array(sab);
  u8 = new Uint8Array(sab);
  Atomics.store(ia, 0, 0);
  worker = new Worker(new URL('./mysql-worker.mjs', import.meta.url), {
    workerData: { sab },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      enabled = false;
      reject(new Error('MySQL worker startup timed out'));
    }, 15000);
    const fail = (err) => {
      clearTimeout(timer);
      enabled = false;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    worker.once('error', fail);
    worker.once('exit', (code) => {
      if (!enabled) fail(new Error(`MySQL worker exited (${code}) before ready`));
    });
    worker.once('message', (msg) => {
      clearTimeout(timer);
      if (msg && msg.ready) {
        enabled = true;
        resolve(true);
      } else {
        enabled = false;
        reject(new Error(msg?.error || 'MySQL worker failed to start'));
      }
    });
  });
}

export function readDoc(rel) {
  return syncCall('read', { rel });
}

export function writeDoc(rel, value) {
  return syncCall('write', { rel, value });
}

export function docExists(rel) {
  return syncCall('exists', { rel });
}

export function saveChatLeads(leads) {
  return syncCall('leads_save', { leads });
}

export function listPendingChatLeads() {
  return syncCall('leads_pending', {});
}

export function markChatLeadSent(id, emailedAt) {
  return syncCall('lead_mark_sent', { id, emailedAt });
}

export function deleteChatLead(id) {
  return syncCall('lead_delete', { id });
}
