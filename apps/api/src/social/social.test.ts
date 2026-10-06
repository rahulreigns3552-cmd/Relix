import { scrubVendorText } from '@relix/shared';
import { describe, expect, test } from 'vitest';
import { AyrshareProvider } from './ayrshare.js';
import { ZernioProvider } from './zernio.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('posting provider adapters', () => {
  test('facebook connect asks for a headless url and instagram uses the standard window', async () => {
    const urls: string[] = [];
    const provider = new ZernioProvider('test-key', async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/connect/facebook')) return jsonResponse({ authUrl: 'https://www.facebook.com/dialog/oauth?client_id=1' });
      if (url.includes('/connect/instagram')) return jsonResponse({ authUrl: 'https://www.instagram.com/oauth/authorize?client_id=1' });
      return jsonResponse({ profile: { _id: 'profile-1' } });
    });
    await provider.createCustomerProfile('sanctum', 'Sanctum');
    const facebook = await provider.getConnectUrl({
      profileRef: 'profile-1',
      platform: 'facebook',
      redirectUrl: 'http://localhost:5173/api/channels/callback?s=abc',
      state: 'abc',
    });
    const instagram = await provider.getConnectUrl({
      profileRef: 'profile-1',
      platform: 'instagram',
      redirectUrl: 'http://localhost:5173/api/channels/callback?s=abc',
      state: 'abc',
    });
    expect(facebook.authUrl).toContain('facebook.com');
    expect(instagram.authUrl).toContain('instagram.com');
    expect(urls.some((url) => url.includes('/connect/facebook') && url.includes('headless=true'))).toBe(true);
    expect(urls.some((url) => url.includes('/connect/instagram') && url.includes('headless=false'))).toBe(true);
  });

  test('callback keeps a user-fixable message and hides nothing the caller did not send', async () => {
    const provider = new ZernioProvider('test-key', async () => jsonResponse({}));
    const result = await provider.handleCallback({
      error: 'oauth_denied',
      error_message: 'You closed the window.',
      is_user_fixable: 'true',
      platform: 'facebook',
    });
    expect(result).toMatchObject({ error: 'You closed the window.', userFixable: true });
  });

  test('ayrshare stays unconfigured until its key is present', async () => {
    const provider = new AyrshareProvider('', '', '');
    await expect(provider.createCustomerProfile('sanctum', 'Sanctum')).rejects.toThrow(/not configured/);
  });
});

describe('vendor text', () => {
  test('drops the leftover Docs and Open lines', () => {
    const cleaned = scrubVendorText([
      'Connect it through Zernio.',
      '1. Open https://zernio.com/dashboard',
      'Docs: https://docs.zernio.com/guides/connecting-accounts',
      'Ayrshare is another option at https://www.ayrshare.com/docs',
    ].join('\n'));
    expect(cleaned.toLowerCase()).not.toContain('zernio');
    expect(cleaned.toLowerCase()).not.toContain('ayrshare');
    expect(cleaned).not.toMatch(/docs:\s*$/i);
    expect(cleaned).not.toMatch(/open\s*$/i);
    expect(cleaned).toContain('Relix');
  });
});
