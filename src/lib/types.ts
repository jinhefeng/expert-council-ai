export interface TenantScoped {
  tenantId?: string; // 预留多租户字段，本地 MVP 默认为 "default-org"
  userId?: string;   // 预留用户隔离字段
}

export type Expert = TenantScoped & {
  id: string;
  name: string;
  title: string;
  lens: string;
  temperament: string;
  focus: string[];
  systemPrompt: string;
  debateIntensity: number; // 个人辩论强度 (1-5)
  isCustom?: boolean;      // 是否为自定义智能体
};

export type LLMEngineConfig = TenantScoped & {
  id: string;
  name: string;
  provider: "openai" | "qwen" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
};

export type Meeting = TenantScoped & {
  id: string;
  name: string;
  description: string;
  expertIds: string[];
  moderatorId: string;
  globalDebateIntensity: number; // 全局辩论强度 (1-5)
  turnOrderMode: "sequential" | "manual" | "relevance";
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ChatMessage = TenantScoped & {
  id: string;
  meetingId: string;
  role: "user" | "expert" | "moderator";
  senderId?: string; // expertId 或 moderatorId
  senderName: string;
  senderTitle?: string;
  content: string;
  expertStance?: {
    stance: string;
    concern: string;
    recommendation: string;
    tradeoff: string;
  };
  sources?: SourceItem[];
  createdAt: number;
};

export type SourceItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "document" | "text" | "file";
  previewUrl?: string;
  textSnippet?: string;
};
