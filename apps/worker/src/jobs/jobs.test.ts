import { RELIX_AGENT_SYSTEM_PROMPT } from '@relix/shared';
import { describe, expect, test } from 'vitest';
import type { SocialProvider } from '@relix/api/social';
import type { WorkerClient } from '../api.js';
import { runChannelSync } from './channel-sync.js';
import { runChatReplies } from './chat-replies.js';
import { runPublish } from './publish.js';

function client(partial: Partial<WorkerClient>): WorkerClient {
  return {
    getPendingChat: async () => ({ jobs: [] }),
    replyChat: async () => ({}),
    getPendingActions: async () => ({ actions: [] }),
    getIgQueue: async () => ({ items: [] }),
    completeAction: async () => ({}),
    getChannelJobs: async () => ({ jobs: [] }),
    completeChannelJob: async () => ({}),
    getChannels: async () => ({ items: [] }),
    syncChannel: async () => ({}),
    syncAnalytics: async () => ({}),
    getProvisionQueue: async () => ({ jobs: [] }),
    completeProvision: async () => ({}),
    ...partial,
  };
}

describe('worker jobs', () => {
  test('chat replies scrub the vendor name and keep the shared prompt', async () => {
    let posted = '';
    let system = '';
    await runChatReplies({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      client: client({
        getPendingChat: async () => ({ jobs: [{ id: 'job-1', projectId: 'sanctum', text: 'What should we post?' }] }),
        replyChat: async (_project, _job, text) => {
          posted = text;
        },
      }),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}')) as { messages: { role: string; content: string }[] };
        system = body.messages[0].content;
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'Use Zernio at https://zernio.com/dashboard. I published it.' } }],
        }));
      },
    });
    expect(system).toBe(RELIX_AGENT_SYSTEM_PROMPT);
    expect(posted.toLowerCase()).not.toContain('zernio');
    expect(posted.toLowerCase()).not.toContain('published');
  });

  test('an unapproved item is never published', async () => {
    let calls = 0;
    const provider = { publish: async () => { calls += 1; return { externalPostId: 'x', status: 'published' }; } } as unknown as SocialProvider;
    const result = await runPublish({
      client: client({
        getPendingActions: async () => ({
          actions: [{ id: 'act-1', projectId: 'sanctum', action: 'publish', postId: 'post-1', post: { id: 'post-1', status: 'approved' } }],
        }),
        getIgQueue: async () => ({ items: [{ id: 'post-1', status: 'pending', caption: 'Draft' }] }),
      }),
      provider,
      publishEnabled: true,
      publicBaseUrl: 'http://localhost:8080',
    });
    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('publishing stays off unless the worker flag is enabled', async () => {
    let calls = 0;
    const provider = { publish: async () => { calls += 1; return { externalPostId: 'x', status: 'published' }; } } as unknown as SocialProvider;
    await runPublish({
      client: client({
        getPendingActions: async () => ({
          actions: [{ id: 'act-1', projectId: 'sanctum', action: 'publish', postId: 'post-1' }],
        }),
        getIgQueue: async () => ({ items: [{ id: 'post-1', status: 'approved', caption: 'Ready' }] }),
      }),
      provider,
      publishEnabled: false,
      publicBaseUrl: '',
    });
    expect(calls).toBe(0);
  });

  test('channel sync stores Relix as the connector and no vendor name', async () => {
    let body: Record<string, unknown> = {};
    const provider = {
      listAccounts: async () => [{ accountId: 'acc-1', platform: 'instagram', username: 'sanctum', followers: 10 }],
    } as unknown as SocialProvider;
    await runChannelSync({
      client: client({
        getChannelJobs: async () => ({ jobs: [{ id: 'job-1', projectId: 'sanctum', platform: 'instagram', status: 'pending' }] }),
        getChannels: async () => ({ items: [], providerProfileRef: 'profile-1' }),
        completeChannelJob: async (_id, payload) => {
          body = payload;
        },
      }),
      provider,
    });
    expect(body.connector).toBe('Relix');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('zernio');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('ayrshare');
  });
});
