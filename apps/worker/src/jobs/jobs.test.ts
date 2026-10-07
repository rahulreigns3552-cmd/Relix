import { RELIX_AGENT_SYSTEM_PROMPT } from '@relix/shared';
import { describe, expect, test } from 'vitest';
import type { SocialProvider } from '@relix/api/social';
import type { WorkerClient } from '../api.js';
import { runAnalytics } from './analytics.js';
import { runChannelSync } from './channel-sync.js';
import { runChatReplies } from './chat-replies.js';
import { runEmails } from './emails.js';
import { runImageGen } from './image-gen.js';
import { runProvision } from './provision.js';
import { runPublish } from './publish.js';
import { smtpConfigFrom } from '../mail.js';

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
    getWorkerProjects: async () => ({ projects: [] }),
    getPendingLeads: async () => ({ leads: [] }),
    markLeadSent: async () => ({}),
    getAwaitingEmail: async () => ({ items: [] }),
    markApprovalEmailSent: async () => ({}),
    getImageWork: async () => ({ items: [] }),
    getBrandReferences: async () => ({ files: [] }),
    saveGeneratedImage: async () => ({ item: { imageUrl: '/media/generated/sanctum/ig.png', status: 'pending' } }),
    updateIgItem: async () => ({}),
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

  test('email is skipped when SMTP is not configured and never claims a post was published', async () => {
    expect(smtpConfigFrom({})).toBeNull();
    const sent: string[] = [];
    const skipped = await runEmails({
      client: client({}),
      smtp: null,
      send: async (message) => { sent.push(message.text); },
    });
    expect(skipped.approvals).toBe(0);
    expect(sent).toEqual([]);
    await runEmails({
      client: client({
        getAwaitingEmail: async () => ({
          items: [{ projectId: 'sanctum', id: 'ig-1', caption: 'Draft', to: 'owner@example.com', approveUrl: 'http://localhost:8080/api/ig/email-action?token=abc' }],
        }),
      }),
      smtp: { host: 'smtp.example', port: 587, user: 'u', pass: 'p', from: 'relix@example.com' },
      send: async (message) => { sent.push(message.text); },
    });
    expect(sent[0].toLowerCase()).not.toContain('published');
    expect(sent[0]).toContain('http://localhost:8080/api/ig/email-action?token=abc');
    expect(sent[0].toLowerCase()).not.toContain('zernio');
  });

  test('image generation stays off unless the flag is enabled and never approves a post', async () => {
    let calls = 0;
    const result = await runImageGen({
      client: client({
        getImageWork: async () => ({ items: [{ projectId: 'sanctum', id: 'ig-1', kind: 'missing', caption: 'Hello' }] }),
      }),
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      enabled: false,
      apiBase: 'http://127.0.0.1:8787',
      fetchImpl: async () => { calls += 1; return new Response('{}'); },
    });
    expect(result.generated).toBe(0);
    expect(calls).toBe(0);
  });

  test('analytics does nothing without a provider', async () => {
    let calls = 0;
    const result = await runAnalytics({
      client: client({
        syncAnalytics: async () => { calls += 1; },
      }),
      provider: null,
    });
    expect(result.updated).toBe(0);
    expect(calls).toBe(0);
  });

  test('provision creates six local roles and does not call a network', async () => {
    let body: Record<string, unknown> = {};
    const result = await runProvision(client({
      getProvisionQueue: async () => ({ jobs: [{ id: 'prov-1', status: 'pending', businessName: 'Sanctum' }] }),
      completeProvision: async (_id, payload) => { body = payload; },
    }));
    const agents = body.agents as { name: string; role: string }[];
    expect(result.completed).toBe(1);
    expect(agents).toHaveLength(6);
    expect(agents[0].name).toContain('Sanctum');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('zernio');
  });
});
