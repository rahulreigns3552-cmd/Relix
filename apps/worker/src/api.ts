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
  completeProvision(id: string, body: Record<string, unknown>): Promise<unknown>;
  getWorkerProjects(): Promise<{ projects: WorkerProject[] }>;
  getPendingLeads(): Promise<{ leads: LeadRecord[] }>;
  markLeadSent(id: string): Promise<unknown>;
  getAwaitingEmail(): Promise<{ items: ApprovalMail[] }>;
  markApprovalEmailSent(projectId: string, itemId: string, to: string): Promise<unknown>;
  getImageWork(): Promise<{ items: ImageWork[] }>;
  getBrandReferences(projectId: string): Promise<{ files: { name: string; url: string }[] }>;
  saveGeneratedImage(projectId: string, itemId: string, dataBase64: string): Promise<{ item?: { imageUrl?: string; status?: string } }>;
  updateIgItem(projectId: string, itemId: string, body: Record<string, unknown>): Promise<unknown>;
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
  externalPostId?: string;
  publishedAt?: string;
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
  projectId?: string;
  businessName?: string;
  goal?: string;
}

export interface WorkerProject {
  id: string;
  name?: string;
  ownerEmail?: string;
  providerProfileRef?: string | null;
}

export interface LeadRecord {
  id: string;
  projectId?: string;
  to?: string;
  transcript?: { role: string; text: string }[];
}

export interface ApprovalMail {
  projectId: string;
  id: string;
  caption?: string;
  to: string;
  approveUrl: string;
}

export interface ImageWork {
  projectId: string;
  id: string;
  kind?: string;
  caption?: string;
  feedback?: string;
  hashtags?: string[];
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
    completeProvision: (id, body) => call(`/api/provision/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    getWorkerProjects: () => call('/api/worker/projects'),
    getPendingLeads: () => call('/api/leads/pending'),
    markLeadSent: (id) => call(`/api/leads/${encodeURIComponent(id)}/sent`, { method: 'POST', body: '{}' }),
    getAwaitingEmail: () => call('/api/ig/awaiting-email'),
    markApprovalEmailSent: (projectId, itemId, to) => call(`/api/projects/${encodeURIComponent(projectId)}/ig/${encodeURIComponent(itemId)}/email-sent`, {
      method: 'POST',
      body: JSON.stringify({ to, threadId: 'smtp', messageId: 'smtp' }),
    }),
    getImageWork: () => call('/api/ig/needs-image'),
    getBrandReferences: (projectId) => call(`/api/projects/${encodeURIComponent(projectId)}/brand-references`),
    saveGeneratedImage: (projectId, itemId, dataBase64) => call(`/api/projects/${encodeURIComponent(projectId)}/ig/${encodeURIComponent(itemId)}/generated-image`, {
      method: 'POST',
      body: JSON.stringify({ dataBase64 }),
    }),
    updateIgItem: (projectId, itemId, body) => call(`/api/projects/${encodeURIComponent(projectId)}/ig/${encodeURIComponent(itemId)}/update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  };
}
