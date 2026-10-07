import crypto from 'node:crypto';
import type { WorkerClient } from '../api.js';

const ROLES: [string, string][] = [
  ['Strategy', 'Strategy & Calendar'],
  ['Content', 'Content Creation'],
  ['Creative', 'Creative/Image'],
  ['Publishing', 'Publishing'],
  ['Analytics', 'Analytics'],
  ['Marketing', 'Marketing Manager'],
];

/** Creates the six in-app brand roles and marks the job done. No external service. */
export async function runProvision(client: WorkerClient): Promise<{ completed: number }> {
  const queue = await client.getProvisionQueue();
  let completed = 0;
  for (const job of queue.jobs || []) {
    if (job.status && job.status !== 'pending') continue;
    const brand = String(job.businessName || job.projectId || 'Brand');
    const agents = ROLES.map(([name, role]) => ({
      id: crypto.randomUUID(),
      name: `${brand} ${name}`,
      role,
    }));
    await client.completeProvision(job.id, {
      agentIds: agents.map((agent) => agent.id),
      agents,
      channelId: crypto.randomUUID(),
      channelName: brand,
    });
    completed += 1;
  }
  return { completed };
}
