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
  const { projects } = await deps.client.getWorkerProjects();
  for (const project of projects || []) {
    if (!project.id || !project.providerProfileRef) continue;
    const accounts = await deps.provider.listAccounts(project.providerProfileRef);
    for (const account of accounts) {
      const platform = account.platform === 'x' ? 'twitter' : account.platform;
      const key = `${project.id}:${platform}`;
      if (seen.has(key)) continue;
      const username = account.username.replace(/^@/, '');
      await deps.client.syncChannel(project.id, platform, {
        status: 'connected',
        username,
        accountId: account.accountId,
        message: username ? `Connected · @${username}` : 'Connected',
      });
      seen.add(key);
      updated += 1;
    }
  }
  return { updated };
}
