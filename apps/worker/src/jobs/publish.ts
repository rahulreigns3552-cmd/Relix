import type { SocialProvider } from '@relix/api/social';
import type { PublishAction, WorkerClient } from '../api.js';

export interface PublishDeps {
  client: WorkerClient;
  provider: SocialProvider | null;
  publishEnabled: boolean;
  publicBaseUrl: string;
  log?: (message: string) => void;
}

function absoluteMedia(url: string, base: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') && base) return `${base.replace(/\/$/, '')}${url}`;
  return url;
}

export async function runPublish(deps: PublishDeps): Promise<{ published: number; skipped: number; failed: number }> {
  const { actions } = await deps.client.getPendingActions();
  let published = 0;
  let skipped = 0;
  let failed = 0;
  for (const action of actions || []) {
    const outcome = await publishOne(deps, action);
    if (outcome === 'published') published += 1;
    else if (outcome === 'failed') failed += 1;
    else skipped += 1;
  }
  return { published, skipped, failed };
}

async function publishOne(deps: PublishDeps, action: PublishAction): Promise<'published' | 'failed' | 'skipped'> {
  if (action.action !== 'publish' || !action.id || !action.projectId) return 'skipped';
  const queue = await deps.client.getIgQueue(action.projectId);
  const live = (queue.items || []).find((item) => item.id === (action.postId || action.post?.id));
  if (!live || live.status !== 'approved') return 'skipped';
  if (!deps.publishEnabled) {
    deps.log?.(`publish skipped for ${action.id}; WORKER_PUBLISH_ENABLED is false`);
    return 'skipped';
  }
  if (!deps.provider) {
    await deps.client.completeAction(action.id, action.projectId, {
      status: 'failed',
      error: 'Posting service not configured',
    });
    return 'failed';
  }
  const channels = await deps.client.getChannels(action.projectId);
  const account = (channels.items || []).find((item) => item.platform === 'instagram' && item.status === 'connected' && item.accountId);
  if (!account?.accountId) {
    await deps.client.completeAction(action.id, action.projectId, {
      status: 'failed',
      error: 'Instagram is not connected',
    });
    return 'failed';
  }
  try {
    const media = absoluteMedia(String(live.imageUrl || ''), deps.publicBaseUrl);
    const result = await deps.provider.publish({
      accountIds: [account.accountId],
      platform: 'instagram',
      caption: String(live.caption || ''),
      mediaUrls: media ? [media] : [],
      scheduledFor: live.postDate,
    });
    if (!result.externalPostId || result.status === 'failed') {
      await deps.client.completeAction(action.id, action.projectId, {
        status: 'failed',
        error: result.error || 'publish failed',
      });
      return 'failed';
    }
    await deps.client.completeAction(action.id, action.projectId, {
      externalPostId: result.externalPostId,
      status: result.status || 'published',
    });
    return 'published';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'publish failed';
    await deps.client.completeAction(action.id, action.projectId, { status: 'failed', error: message });
    return 'failed';
  }
}
