import fs from 'node:fs';
import { AyrshareProvider } from './ayrshare.js';
import { ZernioProvider } from './zernio.js';
import type { SocialProvider } from './types.js';

function ayrsharePrivateKey(): string {
  const inline = String(process.env.AYRSHARE_PRIVATE_KEY || '').trim();
  if (inline) return inline;
  const file = String(process.env.AYRSHARE_PRIVATE_KEY_PATH || '').trim();
  if (!file || !fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

export type { SocialProvider, PublishInput, PublishResult, CallbackResult, ConnectedAccount } from './types.js';
export { signConnectState, verifyConnectState } from './state.js';
export { rememberHandoff, peekHandoff } from './handoff.js';
export { selectionPage } from './selection-page.js';

export function socialProviderName(): string {
  return String(process.env.SOCIAL_PROVIDER || 'none').trim().toLowerCase() || 'none';
}

export function getSocialProvider(): SocialProvider | null {
  const name = socialProviderName();
  if (name === 'zernio') {
    const apiKey = String(process.env.ZERNIO_API_KEY || '').trim();
    if (!apiKey) return null;
    return new ZernioProvider(apiKey);
  }
  if (name === 'ayrshare') {
    const apiKey = String(process.env.AYRSHARE_API_KEY || '').trim();
    if (!apiKey) return null;
    return new AyrshareProvider(
      apiKey,
      ayrsharePrivateKey(),
      String(process.env.AYRSHARE_DOMAIN || '').trim(),
    );
  }
  return null;
}
