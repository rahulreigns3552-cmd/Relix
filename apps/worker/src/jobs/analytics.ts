import type { SocialProvider } from '@relix/api/social';
import type { WorkerClient } from '../api.js';

export async function runAnalytics(deps: {
  client: WorkerClient;
  provider: SocialProvider | null;
  log?: (message: string) => void;
}): Promise<{ updated: number; skipped: number }> {
  if (!deps.provider) {
    deps.log?.('analytics skipped; posting provider is not configured');
    return { updated: 0, skipped: 0 };
  }
  const { projects } = await deps.client.getWorkerProjects();
  let updated = 0;
  let skipped = 0;
  for (const project of projects || []) {
    if (!project.providerProfileRef) {
      skipped += 1;
      continue;
    }
    try {
      const accounts = await deps.provider.listAccounts(project.providerProfileRef);
      const instagram = accounts.find((account) => account.platform === 'instagram') || accounts[0];
      const queue = await deps.client.getIgQueue(project.id);
      const posts = [];
      for (const item of queue.items || []) {
        if (item.status !== 'published' || !item.externalPostId) continue;
        const status = await deps.provider.getPostStatus(item.externalPostId);
        if (!status.metrics) continue;
        posts.push({
          id: item.externalPostId,
          caption: item.caption || '',
          publishedAt: item.publishedAt || '',
          thumbnailUrl: item.imageUrl || '',
          metrics: status.metrics,
        });
      }
      await deps.client.syncAnalytics(project.id, {
        account: instagram?.username ? `@${instagram.username.replace(/^@/, '')}` : '',
        posts,
      });
      updated += 1;
    } catch (error) {
      skipped += 1;
      deps.log?.(`analytics skipped for ${project.id}: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  return { updated, skipped };
}
