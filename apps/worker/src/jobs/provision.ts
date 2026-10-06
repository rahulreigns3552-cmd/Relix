import type { WorkerClient } from '../api.js';

/** Marks queued provision jobs done. No external side effects. */
export async function runProvision(client: WorkerClient): Promise<{ completed: number }> {
  const queue = await client.getProvisionQueue();
  let completed = 0;
  for (const job of queue.jobs || []) {
    if (job.status && job.status !== 'pending') continue;
    await client.completeProvision(job.id);
    completed += 1;
  }
  return { completed };
}
