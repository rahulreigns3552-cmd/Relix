import crypto from 'node:crypto';

export interface EmailAction {
  projectId: string;
  itemId: string;
  action: 'approve';
}

/** Short-lived HMAC token for an approval link. The secret is JWT_SECRET. */
export function signEmailAction(input: EmailAction, secret: string, ttlSeconds = 7 * 24 * 60 * 60): string {
  const body = Buffer.from(JSON.stringify({
    p: input.projectId,
    i: input.itemId,
    a: input.action,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyEmailAction(token: string, secret: string): EmailAction | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      p?: string;
      i?: string;
      a?: string;
      e?: number;
    };
    if (parsed.a !== 'approve' || !parsed.p || !parsed.i) return null;
    if (!parsed.e || parsed.e < Math.floor(Date.now() / 1000)) return null;
    return { projectId: parsed.p, itemId: parsed.i, action: 'approve' };
  } catch {
    return null;
  }
}
