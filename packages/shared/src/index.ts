export type NavSection =
  | 'chat'
  | 'preview'
  | 'analytics'
  | 'goals'
  | 'channels'
  | 'brief'
  | 'settings'
  | 'notifications';

export interface Session {
  email: string;
  role?: 'admin' | 'user';
  loggedInAt: string;
  displayName?: string;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  weeklyDigest?: boolean;
  confirmBeforeProceed?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  website?: string;
  industry?: string;
  ownerEmail?: string;
}

export interface TeamAgent {
  id: string;
  name: string;
  role: string;
}

export interface ProjectTeam {
  projectId?: string;
  status: 'pending' | 'ready';
  channelId: string | null;
  channelName: string | null;
  agents: TeamAgent[];
  goal?: string | null;
  businessName?: string | null;
  provisionedAt?: string;
}

export interface BrandData {
  brandName: string;
  website: string;
  industry: string;
  tagline: string;
  brandVoice: string;
  targetAudience: string;
  competitors: string;
  notes: string;
}

export interface GoalsData {
  objectives: string;
  primaryKpi: string;
  monthlyContentVolume: number;
  platforms: string[];
}

export interface ChannelItem {
  id: string;
  name: string;
  connected: boolean;
  handle: string;
}

export type ChannelPlatform = 'instagram' | 'linkedin' | 'twitter' | 'youtube' | 'whatsapp' | 'email';
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

export interface ChannelRecord {
  platform: ChannelPlatform;
  name: string;
  url: string;
  status: ChannelStatus;
  message: string;
  connector: string | null;
  connectUrl: string | null;
  accountId: string | null;
  updatedAt: string | null;
  jobId?: string | null;
}

export interface BriefItem {
  id: string;
  title: string;
  platform: string;
  tone: string;
  cta: string;
  keyMessage: string;
  deadline: string;
  notes: string;
  createdAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface ApprovalItem {
  id: string;
  title: string;
  type: string;
  agentName: string;
  timestamp: string;
  status: ApprovalStatus;
}

export interface SettingsConnectionStatus {
  connected: boolean;
  hint: string;
}

/** Public connection state only. API keys are never part of this shape. */
export interface SettingsConnections {
  instagram: SettingsConnectionStatus & { account: string };
  whatsapp: SettingsConnectionStatus & { number: string };
  email: SettingsConnectionStatus & { from: string };
}

/** Fields the customer can submit. Blank API keys must not clear a stored key. */
export interface SettingsConnectionInput {
  instagramApiKey?: string;
  whatsappApiKey?: string;
  emailApiKey?: string;
  instagramAccount?: string;
  whatsappNumber?: string;
  fromEmail?: string;
}

export interface SettingsData {
  displayName: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  weeklyDigest: boolean;
  confirmBeforeProceed: boolean;
  webhookUrl: string;
  connections: SettingsConnections;
}

export interface AppData {
  brand: BrandData;
  goals: GoalsData;
  channels: ChannelItem[];
  briefs: BriefItem[];
  approvals: ApprovalItem[];
  settings: SettingsData;
  lastUpdated: string | null;
}

export type ChatAttachmentType = 'image' | 'pdf' | 'ig_preview' | 'widget' | 'connector';

export interface ChatWidgetOption {
  label: string;
  value?: string;
  description?: string;
  style?: 'primary' | 'default' | 'danger';
}

export interface ChatWidget {
  id: string;
  prompt: string;
  helpText?: string;
  options: ChatWidgetOption[];
  allowCustom?: boolean;
  answered?: { value: string; label?: string; at: string } | null;
}

export type ChatConnectorStatus = 'available' | 'connecting' | 'added' | 'failed' | 'needs_url';

export interface ChatConnector {
  id: string;
  name: string;
  description: string;
  logoUrl?: string;
  tools?: number;
  platform?: ChannelPlatform;
  action: 'connect_channel' | 'add_connector';
  url?: string;
  status: ChatConnectorStatus;
  error?: string | null;
}

export interface ChatAttachment {
  type: ChatAttachmentType;
  url?: string;
  name?: string;
  caption?: string;
  hashtags?: string[];
  imageUrl?: string;
  /** Optional IG queue post id — used to open Preview on that draft. */
  postId?: string;
  widget?: ChatWidget;
  connector?: ChatConnector;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  jobId?: string;
}

export interface ChatThread {
  messages: ChatMessage[];
  pendingReply: boolean;
}

export type IgStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'published' | 'expired' | 'failed';

export interface IgPost {
  id: string;
  platform: string;
  imageUrl: string;
  caption: string;
  hashtags: string[];
  status: IgStatus;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
  calendarPostId?: string;
  postDate?: string;
  expiresAt?: string;
  externalPostId?: string;
  publishedAt?: string;
  failReason?: string;
}

export interface AnalyticsMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface AnalyticsPost {
  id: string;
  zernioPostId?: string;
  calendarPostId?: string;
  caption: string;
  publishedAt: string | null;
  platformPostUrl: string;
  thumbnailUrl: string;
  metrics: AnalyticsMetrics;
}

export interface AnalyticsPayload {
  account: string;
  updatedAt: string | null;
  posts: AnalyticsPost[];
}

export interface RelixNotification {
  id: string;
  projectId: string | null;
  title: string;
  body: string;
  kind: 'success' | 'info' | 'warning' | 'error';
  section: string | null;
  createdAt: string;
}
