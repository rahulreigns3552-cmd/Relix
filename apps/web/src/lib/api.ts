import type {
  AnalyticsPayload,
  AnalyticsPost,
  BrandData,
  BriefItem,
  ChannelPlatform,
  ChannelRecord,
  ChatThread,
  GoalsData,
  IgPost,
  RelixNotification,
  Project,
  Session,
  SettingsConnectionInput,
  SettingsConnections,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET' && typeof window !== 'undefined') {
    window.setTimeout(() => window.dispatchEvent(new Event('relix:changed')), 150);
  }
  return res.json() as Promise<T>;
}

function p(projectId: string, suffix: string) {
  return `/api/projects/${encodeURIComponent(projectId)}${suffix}`;
}

export interface OnboardingCompleteBody {
  email: string;
  goal: string;
  businessName: string;
  website?: string;
  industry: string;
}

export interface OnboardingCompleteResult {
  project: Project;
  session: Session;
  provisionJobId: string;
  brand: BrandData;
  goals: { objectives: string };
}

export interface CreateProjectBody {
  name: string;
  description?: string;
  website?: string;
  industry?: string;
  email?: string;
  ownerEmail?: string;
}

export const api = {
  getNotifications: (projectId: string) =>
    request<{ items: RelixNotification[]; ttlHours: number; serverTime: string }>(
      p(projectId, '/notifications')
    ),

  addNotification: (
    projectId: string,
    n: { title: string; body?: string; kind?: RelixNotification['kind']; section?: string }
  ) =>
    request<{ ok: boolean; notification: RelixNotification }>(p(projectId, '/notifications'), {
      method: 'POST',
      body: JSON.stringify(n),
    }),

  health: () =>
    request<{ ok: boolean; projects?: string[] }>('/api/health'),

  signup: (email: string, password: string) =>
    request<Session>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  me: () => request<Session>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  completeOnboarding: (body: OnboardingCompleteBody) =>
    request<OnboardingCompleteResult>('/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listProjects: () => request<{ projects: Project[] }>('/api/projects'),

  createProject: (body: CreateProjectBody) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProject: (id: string) =>
    request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`),

  getProfile: (projectId: string) =>
    request<{ brand: BrandData }>(p(projectId, '/profile')),

  getGoals: (projectId: string) => request<GoalsData>(p(projectId, '/goals')),

  saveGoals: (projectId: string, goals: GoalsData) =>
    request<GoalsData>(p(projectId, '/goals'), {
      method: 'PUT',
      body: JSON.stringify(goals),
    }),

  getBriefs: (projectId: string) =>
    request<{ items: BriefItem[] }>(p(projectId, '/briefs')),

  createBrief: (projectId: string, brief: Omit<BriefItem, 'id' | 'createdAt'>) =>
    request<{ ok: boolean; item: BriefItem; items: BriefItem[] }>(p(projectId, '/briefs'), {
      method: 'POST',
      body: JSON.stringify(brief),
    }),

  deleteBrief: (projectId: string, briefId: string) =>
    request<{ ok: boolean; items: BriefItem[] }>(p(projectId, `/briefs/${encodeURIComponent(briefId)}`), {
      method: 'DELETE',
    }),

  saveProjectProfile: (
    projectId: string,
    body: Partial<BrandData> & { businessName?: string; goal?: string }
  ) =>
    request<{ ok: boolean; brand: BrandData; goal: string | null }>(
      p(projectId, '/profile'),
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),

  getChat: (projectId: string) =>
    request<ChatThread>(p(projectId, '/chat')),

  sendChat: (projectId: string, text: string) =>
    request<{ ok: boolean; chat: ChatThread; jobId: string }>(
      p(projectId, '/chat'),
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      }
    ),

  answerChatWidget: (projectId: string, body: { messageId: string; widgetId: string; value: string }) =>
    request<{ ok: boolean; chat: ChatThread; jobId?: string }>(p(projectId, '/chat/widget-answer'), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  chatConnectorAction: (projectId: string, body: { messageId: string; connectorId: string; url?: string }) =>
    request<{ ok: boolean; chat: ChatThread; error?: string; needsUrl?: boolean; openUrl?: string; authUrl?: string }>(
      p(projectId, '/chat/connector-action'),
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),

  refreshChat: (projectId: string) =>
    request<{ ok: boolean; chat: ChatThread }>(p(projectId, '/chat/refresh'), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  captureChatLead: (projectId: string) =>
    request<{
      ok: boolean;
      leads: { id: string; projectId: string; time: string; to: string; transcript: { role: 'user' | 'relix'; text: string }[] }[];
    }>(p(projectId, '/chat/completed'), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getIgQueue: (projectId: string) =>
    request<{ items: IgPost[] }>(p(projectId, '/ig/queue')),

  approveIg: (projectId: string, id: string) =>
    request<{ ok: boolean; item: IgPost }>(
      p(projectId, `/ig/${id}/approve`),
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),

  requestIgChanges: (projectId: string, id: string, feedback: string) =>
    request<{ ok: boolean; item: IgPost }>(
      p(projectId, `/ig/${id}/request-changes`),
      {
        method: 'POST',
        body: JSON.stringify({ feedback }),
      }
    ),

  rejectIg: (projectId: string, id: string, reason?: string) =>
    request<{ ok: boolean; item: IgPost }>(
      p(projectId, `/ig/${id}/reject`),
      {
        method: 'POST',
        body: JSON.stringify({ reason: reason || '' }),
      }
    ),

  retryIg: (projectId: string, id: string) =>
    request<{ ok: boolean; item: IgPost }>(p(projectId, `/ig/${id}/retry`), {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getSettings: (projectId: string) =>
    request<{ webhookUrl: string; connections: SettingsConnections } & Session>(p(projectId, '/settings')),

  saveSettings: (
    projectId: string,
    body: {
      webhookUrl?: string;
      displayName?: string;
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      weeklyDigest?: boolean;
      confirmBeforeProceed?: boolean;
    },
  ) =>
    request<{ ok: boolean; settings: { webhookUrl: string; connections: SettingsConnections } & Session }>(
      p(projectId, '/settings'),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  saveConnections: (projectId: string, connections: SettingsConnectionInput) =>
    request<{ ok: boolean; settings: { webhookUrl: string; connections: SettingsConnections } }>(
      p(projectId, '/settings'),
      {
        method: 'POST',
        body: JSON.stringify({ connections }),
      }
    ),

  getChannels: (projectId: string) =>
    request<{ items: ChannelRecord[]; serverTime: string; providerConfigured?: boolean }>(p(projectId, '/channels')),

  connectChannel: (projectId: string, platform: ChannelPlatform, url?: string) =>
    request<{ ok: boolean; channel: ChannelRecord; job?: { id: string } | null; authUrl?: string }>(
      p(projectId, `/channels/${platform}/connect`),
      { method: 'POST', body: JSON.stringify({ url }) }
    ),

  testConnections: (
    projectId: string,
    platform?: 'instagram' | 'whatsapp' | 'email',
    url?: string,
  ) =>
    request<{
      ok: boolean;
      verified: false;
      results: {
        platform: 'instagram' | 'whatsapp' | 'email';
        ok: boolean;
        verified: false;
        message: string;
        channel: ChannelRecord;
      }[];
    }>(p(projectId, '/connections/test'), {
      method: 'POST',
      body: JSON.stringify({
        ...(platform ? { platform } : {}),
        ...(url ? { url } : {}),
      }),
    }),

  agentReply: (projectId: string, jobId?: string) =>
    request<{ ok: boolean; chat: ChatThread }>(p(projectId, '/chat/agent-reply'), {
      method: 'POST',
      body: JSON.stringify(jobId ? { jobId } : {}),
    }),

  disconnectChannel: (projectId: string, platform: ChannelPlatform) =>
    request<{ ok: boolean; channel: ChannelRecord }>(
      p(projectId, `/channels/${platform}/disconnect`),
      { method: 'POST', body: JSON.stringify({}) }
    ),

  getAnalytics: (projectId: string) =>
    request<AnalyticsPayload>(p(projectId, '/analytics')),

  getAnalyticsPost: (projectId: string, postId: string) =>
    request<{ post: AnalyticsPost; account: string }>(
      p(projectId, `/analytics/${encodeURIComponent(postId)}`)
    ),
};
