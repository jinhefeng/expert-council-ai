export interface TenantScoped {
  tenantId?: string; // 预留多租户字段，本地 MVP 默认为 "default-org"
  userId?: string;   // 预留用户隔离字段
}

export type UserProfile = TenantScoped & {
  name: string;
  title: string;
};

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
  isHidden?: boolean;      // 是否在列表中被软删除（隐藏）
  meetingId?: string;      // 若为空，则为后台添加的全局自定义智能体；若有值，则为该会议专属
  
  // 外部小龙虾智能体(OpenClaw/QwenPaw)专属
  isExternalAgent?: boolean;
  agentType?: "openclaw" | "onebot"; // 智能体类型：小龙虾原生通道 或 OneBot协议
  wsEndpoint?: string;                // OneBot 连接地址，例如 ws://localhost:6199/ws
  botToken?: string;                  // OpenClaw 连接 Token
  onebotToken?: string;               // OneBot 鉴权 Token
  
  // 外部 RAG 数据库连接参数
  ragEnabled?: boolean;     // 是否启用外部 RAG 知识检索
  ragEndpoint?: string;     // 外部 RAG 接口地址
  ragToken?: string;        // 外部 RAG API 鉴权 Token
  ragDatasetId?: string;    // 目标知识库/数据集 ID (Collection ID)

  // 大模型路由配置
  modelMode?: "default" | "custom"; // 路由模式: "default" (跟随会议室) | "custom" (指定独立大模型)
  modelId?: string;                 // 独立大模型 ID (LLMEngineConfig.id)，当 modelMode 为 "custom" 时有效
};

export type LLMEngineConfig = TenantScoped & {
  id: string;
  name: string;
  provider: "openai" | "qwen" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
  isReasoningModel?: boolean;
  enableStreaming?: boolean;
  isSystem?: boolean; // 系统内置只读引擎标识
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
  finalConclusion?: string; // 会议最终结论（可由AI生成并被用户手动编辑）
  decisionState?: "approved" | "rejected" | "pending"; // 会议决议状态
  enableInquiryLoop?: boolean; // 会议追问索取信息开关
  moderatorAutonomy?: "passive" | "facilitative" | "autonomous"; // 三种主持人自主度模式
};

export type ChatMessage = TenantScoped & {
  id: string;
  meetingId: string;
  role: "user" | "expert" | "moderator";
  senderId?: string; // expertId 或 moderatorId
  senderName: string;
  senderTitle?: string;
  content: string;
  isStanceExtracting?: boolean; // 临时属性：是否正在提取立场摘要
  expertStance?: {
    stance: string;
    concern: string;
    recommendation: string;
    tradeoff: string;
  };
  moderatorSummary?: {
    consensus: string[];
    disagreements: string[];
    decisions: string[];
    nextActions: string[];
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

export type LLMParamsConfig = TenantScoped & {
  maxTokens: number;
  expertTemperature: number;
  synthesisTemperature: number;
  conclusionTemperature: number;
  nextSpeakerTemperature: number;
  maxAutonomousRounds?: number;           // 最大自主决策轮数
  autonomousCountdownSeconds?: number;   // 自主决策倒计时秒数
  streamInactiveTimeoutSeconds?: number;  // 流式无活动超时断流秒数
  expertFirstCharTimeoutSeconds?: number; // 外部智能体首字响应超时秒数
  expertStreamTimeoutSeconds?: number;    // 外部智能体流式断流超时秒数
};

export type SystemPromptsConfig = TenantScoped & {
  intensityLevel1: string;
  intensityLevel2: string;
  intensityLevel3: string;
  intensityLevel4: string;
  intensityLevel5: string;
  expertTurnFormat: string;
  synthesisPrompt: string;
  nextSpeakerPrompt: string;
  finalConclusionPrompt: string;
  meetingDescPrompt: string;
  expertDetailsPrompt: string;
  externalAgentPrompt: string; // 外部智能体全局发言提示词模板
  inquiryJudgmentPrompt: string; // 信息追问判定提示词模板
  decisionOptionsPrompt: string; // 决策方向意见提示词模板
  // --- 以下为新增的后台可配置属性 ---
  moderatorName: string;                   // AI 主持人的默认显示姓名
  moderatorTitle: string;                  // AI 主持人的默认核心头衔
  expertUserPromptFormat: string;          // 专家发言环节的 User Context 拼接模板
  synthesisUserPromptFormat: string;       // 主持人提炼纪要的 User Context 拼接模板
  nextSpeakerUserPromptFormat: string;     // 智能派单的 User Context 拼接模板
  finalConclusionUserPromptFormat: string; // 结案陈词的 User Context 拼接模板
  prevTurnsHeaderPrompt: string;           // 有历史专家发言时的前导引导语
  prevTurnsEmptyPrompt: string;            // 无历史发言（首位发言人）时的引导语
  cleanThinkForSynthesis?: boolean;        // 主持人总结时是否清洗专家思维链（<think>块）
  blockquoteFormatForTurns?: boolean;      // 历史发言/发言记录是否使用 Markdown 引用缩进格式（> 符号）
};

export type BusinessDefaultsConfig = TenantScoped & {
  defaultMeetingName: string;
  defaultMeetingDesc: string;
  defaultExpertIds: string[];
  defaultModeratorId: string;
  defaultDebateIntensity: number;
  defaultTurnOrderMode: "sequential" | "manual" | "relevance";
};
