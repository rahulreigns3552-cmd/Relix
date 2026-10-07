import net from 'node:net';
import tls from 'node:tls';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

export function smtpConfigFrom(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = String(env.SMTP_HOST || '').trim();
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '').trim();
  const from = String(env.SMTP_FROM || '').trim();
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, pass, from };
}

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (!/^\d{3} /.test(last)) return;
      socket.off('data', onData);
      socket.off('error', onError);
      const code = Number(last.slice(0, 3));
      if (code >= 400) reject(new Error(`SMTP ${last}`));
      else resolve(buf);
    };
    const onError = (error: Error) => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function say(socket: net.Socket, line: string): Promise<string> {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

/** Sends one plain-text message. Port 465 uses TLS immediately; other ports use STARTTLS. */
export async function sendSmtp(config: SmtpConfig, message: OutboundMail): Promise<void> {
  const socket = config.port === 465
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', () => resolve());
  });
  try {
    await readReply(socket);
    await say(socket, 'EHLO relix');
    let active: net.Socket = socket;
    if (config.port !== 465) {
      await say(socket, 'STARTTLS');
      active = tls.connect({ socket, servername: config.host });
      await new Promise<void>((resolve, reject) => {
        active.once('error', reject);
        active.once('secureConnect', () => resolve());
      });
      await say(active, 'EHLO relix');
    }
    await say(active, 'AUTH LOGIN');
    await say(active, Buffer.from(config.user).toString('base64'));
    await say(active, Buffer.from(config.pass).toString('base64'));
    await say(active, `MAIL FROM:<${config.from}>`);
    await say(active, `RCPT TO:<${message.to}>`);
    await say(active, 'DATA');
    const body = [
      `From: ${config.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject.replace(/[\r\n]/g, ' ')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      dotStuff(message.text),
      '.',
    ].join('\r\n');
    active.write(`${body}\r\n`);
    await readReply(active);
    await say(active, 'QUIT');
    active.end();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
