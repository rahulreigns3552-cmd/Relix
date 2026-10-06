import type {
  AppData,
  ApprovalItem,
  BrandData,
  BriefItem,
  ChannelItem,
  ChatThread,
  GoalsData,
  SettingsData,
} from './types';

const ACTIVE_PROJECT_KEY = 'relix_activeProjectId';

export const defaultBrand: BrandData = {
  brandName: '',
  website: '',
  industry: '',
  tagline: '',
  brandVoice: '',
  targetAudience: '',
  competitors: '',
  notes: '',
};

export const defaultGoals: GoalsData = {
  objectives: '',
  primaryKpi: 'Engagement rate',
  monthlyContentVolume: 12,
  platforms: [],
};

export const defaultChannels: ChannelItem[] = [
  { id: 'instagram', name: 'Instagram', connected: false, handle: '' },
  { id: 'linkedin', name: 'LinkedIn', connected: false, handle: '' },
  { id: 'twitter', name: 'X / Twitter', connected: false, handle: '' },
  { id: 'youtube', name: 'YouTube', connected: false, handle: '' },
  { id: 'email', name: 'Email / Newsletter', connected: false, handle: '' },
  { id: 'other', name: 'Other', connected: false, handle: '' },
];

export const defaultSettings: SettingsData = {
  displayName: 'Relix',
  emailNotifications: true,
  pushNotifications: false,
  weeklyDigest: true,
  confirmBeforeProceed: true,
  webhookUrl: '',
  connections: {
    instagram: { connected: false, hint: '', account: '' },
    whatsapp: { connected: false, hint: '', number: '' },
    email: { connected: false, hint: '', from: '' },
  },
};

function seedApprovals(): ApprovalItem[] {
  const now = Date.now();
  return [
    {
      id: 'apr-1',
      title: 'Q4 LinkedIn carousel — product launch teaser',
      type: 'Content',
      agentName: 'Content Creation',
      timestamp: new Date(now - 1000 * 60 * 45).toISOString(),
      status: 'pending',
    },
    {
      id: 'apr-2',
      title: 'Instagram Reel script: behind-the-scenes week',
      type: 'Script',
      agentName: 'Creative/Image',
      timestamp: new Date(now - 1000 * 60 * 120).toISOString(),
      status: 'pending',
    },
    {
      id: 'apr-3',
      title: 'Weekly performance digest — send for review',
      type: 'Report',
      agentName: 'Analytics',
      timestamp: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
      status: 'pending',
    },
    {
      id: 'apr-4',
      title: 'Email nurture sequence — onboarding day 3',
      type: 'Email',
      agentName: 'Email Scheduler',
      timestamp: new Date(now - 1000 * 60 * 60 * 8).toISOString(),
      status: 'pending',
    },
  ];
}

export function defaultAppData(): AppData {
  return {
    brand: { ...defaultBrand },
    goals: { ...defaultGoals, platforms: [] },
    channels: defaultChannels.map((c) => ({ ...c })),
    briefs: [],
    approvals: seedApprovals(),
    settings: { ...defaultSettings },
    lastUpdated: null,
  };
}

function dataKey(projectId: string) {
  return `relix:${projectId}:data`;
}

function chatKey(projectId: string) {
  return `relix:${projectId}:chat`;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    localStorage.removeItem('opslead_session');
    localStorage.removeItem('opslead_activeProjectId');
    localStorage.removeItem('relix_session');
    localStorage.removeItem('ops_lead_session');
  } catch {
    /* ignore storage errors */
  }
}

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setActiveProjectId(projectId: string | null): void {
  if (!projectId) {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

export function getAppData(projectId: string): AppData {
  try {
    const raw = localStorage.getItem(dataKey(projectId));
    if (!raw) {
      // One-time migration from legacy global key
      const legacy = localStorage.getItem('relix_data');
      if (legacy && projectId === 'sanctum') {
        localStorage.setItem(dataKey(projectId), legacy);
        return mergeAppData(JSON.parse(legacy) as AppData);
      }
      const data = defaultAppData();
      localStorage.setItem(dataKey(projectId), JSON.stringify(data));
      return data;
    }
    return mergeAppData(JSON.parse(raw) as AppData);
  } catch {
    const data = defaultAppData();
    localStorage.setItem(dataKey(projectId), JSON.stringify(data));
    return data;
  }
}

function mergeAppData(parsed: AppData): AppData {
  const base = defaultAppData();
  return {
    ...base,
    ...parsed,
    brand: { ...base.brand, ...parsed.brand },
    goals: { ...base.goals, ...parsed.goals, platforms: parsed.goals?.platforms ?? [] },
    channels: parsed.channels?.length ? parsed.channels : base.channels,
    briefs: parsed.briefs ?? [],
    approvals: parsed.approvals?.length ? parsed.approvals : seedApprovals(),
    settings: {
      ...base.settings,
      ...parsed.settings,
      connections: {
        instagram: {
          ...base.settings.connections.instagram,
          ...parsed.settings?.connections?.instagram,
        },
        whatsapp: {
          ...base.settings.connections.whatsapp,
          ...parsed.settings?.connections?.whatsapp,
        },
        email: {
          ...base.settings.connections.email,
          ...parsed.settings?.connections?.email,
        },
      },
    },
  };
}

export function saveAppData(projectId: string, data: AppData): AppData {
  const next = { ...data, lastUpdated: new Date().toISOString() };
  localStorage.setItem(dataKey(projectId), JSON.stringify(next));
  return next;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getLocalChat(projectId: string): ChatThread | null {
  try {
    const raw = localStorage.getItem(chatKey(projectId));
    if (!raw) {
      if (projectId === 'sanctum') {
        const legacy = localStorage.getItem('relix_chat');
        if (legacy) {
          localStorage.setItem(chatKey(projectId), legacy);
          return JSON.parse(legacy) as ChatThread;
        }
      }
      return null;
    }
    return JSON.parse(raw) as ChatThread;
  } catch {
    return null;
  }
}

export function saveLocalChat(projectId: string, thread: ChatThread): void {
  localStorage.setItem(chatKey(projectId), JSON.stringify(thread));
}

export type { BriefItem, ApprovalItem };
