export interface ConnectUrlInput {
  profileRef: string;
  platform: string;
  redirectUrl: string;
  state: string;
  headless?: boolean;
}

export interface PublishInput {
  accountIds: string[];
  caption: string;
  mediaUrls: string[];
  scheduledFor?: string;
  platform?: string;
}

export interface PublishResult {
  externalPostId: string;
  status: string;
  error?: string;
  metrics?: {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
  };
}

export interface ConnectedAccount {
  accountId: string;
  platform: string;
  username: string;
  followers?: number;
}

export interface SelectionOption {
  id: string;
  label: string;
}

export interface CallbackSelection {
  step: string;
  title: string;
  options: SelectionOption[];
  tempToken: string;
  connectToken: string;
  profileRef: string;
}

export type CallbackResult =
  | { platform: string; accountId: string; username: string }
  | { error: string; userFixable?: boolean; useStandardConnect?: boolean }
  | { selection: CallbackSelection };

export interface SocialProvider {
  readonly id: 'zernio' | 'ayrshare';
  createCustomerProfile(projectId: string, name: string): Promise<{ profileRef: string }>;
  getConnectUrl(input: ConnectUrlInput): Promise<{ authUrl: string }>;
  handleCallback(query: Record<string, string>): Promise<CallbackResult>;
  completeSelection(input: {
    step: string;
    tempToken: string;
    connectToken: string;
    profileRef: string;
    choiceId: string;
    platform: string;
  }): Promise<{ platform: string; accountId: string; username: string }>;
  listAccounts(profileRef: string): Promise<ConnectedAccount[]>;
  disconnect(accountId: string): Promise<void>;
  publish(input: PublishInput): Promise<PublishResult>;
  getPostStatus(externalPostId: string): Promise<PublishResult>;
}
