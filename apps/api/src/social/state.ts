import crypto from 'node:crypto';

export interface ConnectState {
  projectId: string;
  platform: string;
  nonce: string;
  exp: number;
}

function secret(): string {
  const value = String(process.env.JWT_SECRET || '').trim();
  if (!value) throw new Error('JWT_SECRET is required');
  return value;
}

export function signConnectState(projectId: string, platform: string, ttlMs = 15 * 60 * 1000): string {
  const body = Buffer.from(JSON.stringify({
    p: projectId,
    f: platform,
    n: crypto.randomBytes(8).toString('hex'),
    e: Date.now() + ttlMs,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyConnectState(token: string): ConnectState | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      p?: string;
      f?: string;
      n?: string;
      e?: number;
    };
    if (!parsed.p || !parsed.f || !parsed.n || !parsed.e) return null;
    if (parsed.e < Date.now()) return null;
    return { projectId: parsed.p, platform: parsed.f, nonce: parsed.n, exp: parsed.e };
  } catch {
    return null;
  }
}
