import type { SocialProvider } from '@relix/api/social';
import type { WorkerClient } from '../api.js';

export async function runChannelSync(deps: {
  client: WorkerClient;
  provider: SocialProvider | null;
}): Promise<{ updated: number }> {
  const { jobs } = await deps.client.getChannelJobs();
  if (!deps.provider) return { updated: 0 };
  let updated = 0;
  const seen = new Set<string>();
  for (const job of jobs || []) {
    if (!job.projectId || !job.platform) continue;
    const key = `${job.projectId}:${job.platform}`;
    const channels = await deps.client.getChannels(job.projectId);
    const profileRef = channels.providerProfileRef || '';
    if (!profileRef) continue;
    const accounts = await deps.provider.listAccounts(profileRef);
    const match = accounts.find((account) => account.platform === job.platform || (job.platform === 'twitter' && account.platform === 'x'));
    if (!match) continue;
    const username = match.username.replace(/^@/, '');
    await deps.client.completeChannelJob(job.id, {
      status: 'connected',
      message: username ? `Connected · @${username}` : 'Connected',
      connector: 'Relix',
      accountId: match.accountId,
      username,
    });
    if (typeof match.followers === 'number') {
      await deps.client.syncAnalytics(job.projectId, { account: username ? `@${username}` : '', posts: [] });
    }
    seen.add(key);
    updated += 1;
  }
  return { updated };
}
