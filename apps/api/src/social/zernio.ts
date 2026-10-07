import { asList, asRecord, readJson, type FetchLike } from './http.js';
import type {
  CallbackResult,
  ConnectUrlInput,
  ConnectedAccount,
  PublishInput,
  PublishResult,
  SelectionOption,
  SocialProvider,
} from './types.js';

const HEADLESS_PLATFORMS = new Set(['facebook', 'linkedin']);

function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseUserProfile(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const attempts = [raw];
  try {
    attempts.unshift(decodeURIComponent(raw));
  } catch {
    /* already decoded */
  }
  for (const attempt of attempts) {
    try {
      return asRecord(JSON.parse(attempt));
    } catch {
      /* try the next shape */
    }
  }
  return {};
}

function optionsFrom(value: unknown, idKeys: string[], labelKeys: string[]): SelectionOption[] {
  return asList(value)
    .map((row) => ({
      id: firstString(...idKeys.map((key) => row[key])),
      label: firstString(...labelKeys.map((key) => row[key]), 'Account'),
    }))
    .filter((row) => row.id);
}

export class ZernioProvider implements SocialProvider {
  readonly id = 'zernio' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://zernio.com/api/v1',
  ) {}

  private async request(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}${queryString(query || {})}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(res);
    if (!res.ok) {
      const error = new Error(firstString(data.error, data.message) || `HTTP ${res.status}`);
      (error as Error & { status?: number; details?: unknown }).status = res.status;
      (error as Error & { details?: unknown }).details = data.details;
      throw error;
    }
    return data;
  }

  async createCustomerProfile(projectId: string, name: string): Promise<{ profileRef: string }> {
    try {
      const data = await this.request('POST', '/profiles', {
        name: `relix_${projectId}`,
        description: name,
      });
      const profile = asRecord(data.profile);
      const profileRef = firstString(profile._id, data.profileId);
      if (!profileRef) throw new Error('profile id missing');
      return { profileRef };
    } catch (error) {
      const details = asRecord((error as { details?: unknown }).details);
      const existing = firstString(details.existingProfileId);
      if (existing) return { profileRef: existing };
      throw error;
    }
  }

  async getConnectUrl(input: ConnectUrlInput): Promise<{ authUrl: string }> {
    const headless = input.headless ?? HEADLESS_PLATFORMS.has(input.platform);
    const data = await this.request('GET', `/connect/${encodeURIComponent(input.platform)}`, undefined, {
      profileId: input.profileRef,
      redirect_url: input.redirectUrl,
      headless: headless ? 'true' : 'false',
    });
    const authUrl = firstString(data.authUrl);
    if (!authUrl) throw new Error('connect url missing');
    return { authUrl };
  }

  async handleCallback(query: Record<string, string>): Promise<CallbackResult> {
    const platform = firstString(query.platform, query.connected);
    if (query.error) {
      const userFixable = query.is_user_fixable === 'true';
      return {
        error: userFixable ? firstString(query.error_message, 'Connection was cancelled.') : 'Connection failed.',
        userFixable,
      };
    }
    const step = firstString(query.step);
    if (step === 'select_page' || step === 'select_organization') {
      const profile = parseUserProfile(query.userProfile);
      const pending = await this.safePending(firstString(query.tempToken, query.pendingDataToken, query.connect_token));
      const source = Object.keys(profile).length ? profile : pending;
      const options = step === 'select_page'
        ? optionsFrom(source.pages || pending.pages, ['id', 'pageId', '_id'], ['name', 'title', 'username'])
        : optionsFrom(
          source.organizations || source.orgs || pending.organizations,
          ['id', 'organizationId', '_id'],
          ['name', 'localizedName', 'vanityName'],
        );
      return {
        selection: {
          step,
          title: step === 'select_page' ? 'Choose a Facebook Page' : 'Choose a LinkedIn organization',
          options,
          tempToken: firstString(query.tempToken),
          connectToken: firstString(query.connect_token),
          profileRef: firstString(query.profileId),
        },
      };
    }
    if (step) return { error: 'This network needs the standard connect window.', useStandardConnect: true };
    const accountId = firstString(query.accountId);
    const username = firstString(query.username);
    if (!accountId) return { error: 'Connection did not finish.' };
    return { platform: platform || 'instagram', accountId, username };
  }

  async completeSelection(input: {
    step: string;
    tempToken: string;
    connectToken: string;
    profileRef: string;
    choiceId: string;
    platform: string;
  }): Promise<{ platform: string; accountId: string; username: string }> {
    const path = input.step === 'select_organization'
      ? '/connect/linkedin/select-organization'
      : '/connect/facebook/select-page';
    const data = await this.request('POST', path, {
      profileId: input.profileRef,
      tempToken: input.tempToken,
      connect_token: input.connectToken,
      pageId: input.step === 'select_page' ? input.choiceId : undefined,
      organizationId: input.step === 'select_organization' ? input.choiceId : undefined,
    });
    const account = asRecord(data.account);
    const accountId = firstString(data.accountId, account._id, account.accountId);
    const username = firstString(data.username, account.username, account.name);
    if (!accountId) throw new Error('selection did not return an account');
    return { platform: input.platform, accountId, username };
  }

  async listAccounts(profileRef: string): Promise<ConnectedAccount[]> {
    const data = await this.request('GET', '/accounts', undefined, { profileId: profileRef });
    return asList(data.accounts).map((account) => ({
      accountId: firstString(account._id, account.accountId),
      platform: firstString(account.platform).toLowerCase(),
      username: firstString(account.username, account.displayName),
      followers: Number.isFinite(Number(account.followers)) ? Number(account.followers) : undefined,
    })).filter((account) => account.accountId);
  }

  async disconnect(accountId: string): Promise<void> {
    await this.request('DELETE', `/accounts/${encodeURIComponent(accountId)}`);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const platform = input.platform || 'instagram';
    const data = await this.request('POST', '/posts', {
      content: input.caption,
      publishNow: !input.scheduledFor,
      scheduledFor: input.scheduledFor,
      mediaItems: input.mediaUrls.filter(Boolean).map((url) => ({ type: 'image', url })),
      platforms: input.accountIds.map((accountId) => ({ platform, accountId })),
    });
    const post = asRecord(data.post);
    const externalPostId = firstString(post._id, data.postId, data.id);
    const status = firstString(post.status, data.status) || 'published';
    if (!externalPostId) return { externalPostId: '', status: 'failed', error: 'publish did not return an id' };
    return { externalPostId, status };
  }

  async getPostStatus(externalPostId: string): Promise<PublishResult> {
    const data = await this.request('GET', `/posts/${encodeURIComponent(externalPostId)}`);
    const post = asRecord(data.post || data);
    const metrics = asRecord(post.analytics || post.metrics);
    const read = (key: string) => {
      const value = Number(metrics[key]);
      return Number.isFinite(value) ? value : undefined;
    };
    const impressions = read('impressions');
    const reach = read('reach');
    const likes = read('likes');
    const comments = read('comments');
    const shares = read('shares');
    const saves = read('saves');
    const hasMetrics = [impressions, reach, likes, comments, shares, saves].some((value) => value != null);
    return {
      externalPostId,
      status: firstString(post.status) || 'unknown',
      error: firstString(post.error) || undefined,
      metrics: hasMetrics ? { impressions, reach, likes, comments, shares, saves } : undefined,
    };
  }

  private async safePending(token: string): Promise<Record<string, unknown>> {
    if (!token) return {};
    try {
      return await this.request('GET', '/connect/pending-oauth-data', undefined, { token });
    } catch {
      return {};
    }
  }
}
