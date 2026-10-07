import { asRecord, readJson, type FetchLike } from './http.js';
import type { ConnectUrlInput, PublishInput, PublishResult, SocialProvider } from './types.js';

const NOT_CONFIGURED = 'not configured';

export class AyrshareProvider implements SocialProvider {
  readonly id = 'ayrshare' as const;

  constructor(
    private readonly apiKey: string,
    private readonly privateKey: string,
    private readonly domain: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://app.ayrshare.com/api',
  ) {}

  private assertConfigured(needsJwt = false): void {
    if (!this.apiKey) throw new Error(NOT_CONFIGURED);
    if (needsJwt && (!this.privateKey || !this.domain)) throw new Error(NOT_CONFIGURED);
  }

  private async request(method: string, path: string, body?: unknown, profileKey?: string) {
    this.assertConfigured();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (profileKey) headers['Profile-Key'] = profileKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error('request failed');
    return data;
  }

  async createCustomerProfile(projectId: string, name: string): Promise<{ profileRef: string }> {
    const data = await this.request('POST', '/profiles/profile', { title: name || projectId });
    const profileRef = String(data.profileKey || asRecord(data.profile).profileKey || '');
    if (!profileRef) throw new Error(NOT_CONFIGURED);
    return { profileRef };
  }

  async getConnectUrl(input: ConnectUrlInput): Promise<{ authUrl: string }> {
    this.assertConfigured(true);
    const data = await this.request('POST', '/profiles/generateJWT', {
      domain: this.domain,
      privateKey: this.privateKey,
      profileKey: input.profileRef,
      redirect: input.redirectUrl,
    });
    const authUrl = String(data.url || data.jwtUrl || '');
    if (!authUrl) throw new Error(NOT_CONFIGURED);
    return { authUrl };
  }

  async handleCallback(query: Record<string, string>): Promise<{ platform: string; accountId: string; username: string } | { error: string; userFixable?: boolean }> {
    this.assertConfigured();
    if (query.error) return { error: 'Connection failed.', userFixable: true };
    const accountId = query.accountId || query.profileKey || '';
    if (!accountId) return { error: 'Connection did not finish.' };
    return { platform: query.platform || 'instagram', accountId, username: query.username || '' };
  }

  async completeSelection(): Promise<{ platform: string; accountId: string; username: string }> {
    throw new Error(NOT_CONFIGURED);
  }

  async listAccounts(profileRef: string): Promise<{ accountId: string; platform: string; username: string }[]> {
    const data = await this.request('GET', '/user', undefined, profileRef);
    const display = asRecord(data.displayNames);
    return Object.entries(display).map(([platform, value]) => {
      const row = asRecord(value);
      return {
        accountId: String(row.id || platform),
        platform,
        username: String(row.username || row.displayName || ''),
      };
    });
  }

  async disconnect(accountId: string): Promise<void> {
    await this.request('DELETE', '/profiles/profile', { profileKey: accountId });
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const profileKey = input.accountIds[0];
    const data = await this.request('POST', '/post', {
      post: input.caption,
      platforms: input.platform ? [input.platform] : undefined,
      mediaUrls: input.mediaUrls,
      scheduleDate: input.scheduledFor,
    }, profileKey);
    const externalPostId = String(data.id || data.postId || '');
    if (!externalPostId) return { externalPostId: '', status: 'failed', error: 'publish did not return an id' };
    return { externalPostId, status: String(data.status || 'success') };
  }

  async getPostStatus(externalPostId: string): Promise<PublishResult> {
    const data = await this.request('GET', `/post/${encodeURIComponent(externalPostId)}`);
    return { externalPostId, status: String(data.status || 'unknown') };
  }
}
