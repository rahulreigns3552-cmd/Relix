export interface WorkerClient {
  getPendingChat(): Promise<{ jobs: ChatJob[] }>;
  replyChat(projectId: string, jobId: string, text: string): Promise<unknown>;
  getPendingActions(): Promise<{ actions: PublishAction[] }>;
  getIgQueue(projectId: string): Promise<{ items: QueueItem[] }>;
  completeAction(actionId: string, projectId: string, result: Record<string, unknown>): Promise<unknown>;
  getChannelJobs(): Promise<{ jobs: ChannelJob[] }>;
  completeChannelJob(id: string, body: Record<string, unknown>): Promise<unknown>;
  getChannels(projectId: string): Promise<{ items: WorkerChannel[]; providerProfileRef?: string | null }>;
  syncChannel(projectId: string, platform: string, body: Record<string, unknown>): Promise<unknown>;
  syncAnalytics(projectId: string, body: Record<string, unknown>): Promise<unknown>;
  getProvisionQueue(): Promise<{ jobs: ProvisionJob[] }>;
  completeProvision(id: string): Promise<unknown>;
}

export interface ChatJob {
  id: string;
  projectId: string;
  text?: string;
}

export interface QueueItem {
  id: string;
  status?: string;
  caption?: string;
  imageUrl?: string;
  postDate?: string;
}

export interface PublishAction {
  id: string;
  projectId: string;
  action?: string;
  postId?: string;
  post?: QueueItem;
}

export interface ChannelJob {
  id: string;
  projectId?: string;
  platform?: string;
  status?: string;
  url?: string;
}

export interface WorkerChannel {
  platform: string;
  status?: string;
  accountId?: string | null;
  username?: string | null;
}

export interface ProvisionJob {
  id: string;
  status?: string;
}

export function createWorkerClient(baseUrl: string, workerKey: string, fetchImpl: typeof fetch = fetch): WorkerClient {
  const root = baseUrl.replace(/\/$/, '');
  async function call(path: string, init?: RequestInit) {
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Relix-Worker-Key': workerKey,
        ...(init?.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return body;
  }
  return {
    getPendingChat: () => call('/api/chat/pending-all'),
    replyChat: (projectId, jobId, text) => call('/api/chat/reply', {
      method: 'POST',
      body: JSON.stringify({ projectId, jobId, text }),
    }),
    getPendingActions: () => call('/api/ig/actions/pending-all'),
    getIgQueue: (projectId) => call(`/api/projects/${encodeURIComponent(projectId)}/ig/queue`),
    completeAction: (actionId, projectId, result) => call(`/api/ig/actions/${encodeURIComponent(actionId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ projectId, result }),
    }),
    getChannelJobs: () => call('/api/channel-jobs?status=pending'),
    completeChannelJob: (id, body) => call(`/api/channel-jobs/${encodeURIComponent(id)}/result`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    getChannels: (projectId) => call(`/api/projects/${encodeURIComponent(projectId)}/channels`),
    syncChannel: (projectId, platform, body) => call(`/api/projects/${encodeURIComponent(projectId)}/channels/${encodeURIComponent(platform)}/sync`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    syncAnalytics: (projectId, body) => call(`/api/projects/${encodeURIComponent(projectId)}/analytics/sync`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    getProvisionQueue: () => call('/api/provision/queue'),
    completeProvision: (id) => call(`/api/provision/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  };
}
