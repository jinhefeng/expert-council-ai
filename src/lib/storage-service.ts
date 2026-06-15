import { Expert, LLMEngineConfig, Meeting, UserProfile, LLMParamsConfig, SystemPromptsConfig, BusinessDefaultsConfig } from "./types";

export interface StorageService {
  // 会议管理
  getMeetings(tenantId: string): Promise<Meeting[]>;
  saveMeeting(tenantId: string, meeting: Meeting): Promise<void>;
  deleteMeeting(tenantId: string, id: string): Promise<void>;

  // 组织级别智能体库
  getCustomExperts(tenantId: string): Promise<Expert[]>;
  saveCustomExpert(tenantId: string, expert: Expert): Promise<void>;
  deleteCustomExpert(tenantId: string, id: string): Promise<void>;

  // 组织级别模型引擎配置
  getEngineConfigs(tenantId: string): Promise<LLMEngineConfig[]>;
  saveEngineConfigs(tenantId: string, configs: LLMEngineConfig[]): Promise<void>;

  // 系统专家覆写配置
  getSystemExpertsOverrides(tenantId: string): Promise<Partial<Expert>[]>;
  saveSystemExpertsOverrides(tenantId: string, overrides: Partial<Expert>[]): Promise<void>;

  // 当前用户配置
  getUserProfile(tenantId: string): Promise<UserProfile>;
  saveUserProfile(tenantId: string, profile: UserProfile): Promise<void>;

  // 新增配置
  getLLMParamsConfig(tenantId: string): Promise<LLMParamsConfig>;
  saveLLMParamsConfig(tenantId: string, config: LLMParamsConfig): Promise<void>;

  getSystemPromptsConfig(tenantId: string): Promise<SystemPromptsConfig>;
  saveSystemPromptsConfig(tenantId: string, config: SystemPromptsConfig): Promise<void>;

  getBusinessDefaultsConfig(tenantId: string): Promise<BusinessDefaultsConfig>;
  saveBusinessDefaultsConfig(tenantId: string, config: BusinessDefaultsConfig): Promise<void>;
}

const MEETINGS_KEY = "agent-council-meetings";
const CUSTOM_EXPERTS_KEY = "agent-council-custom-experts";
const ENGINE_CONFIGS_KEY = "agent-council-engine-configs";
const SYSTEM_EXPERTS_OVERRIDES_KEY = "agent-council-system-experts-overrides";
const USER_PROFILE_KEY = "agent-council-user-profile";
const LLM_PARAMS_KEY = "agent-council-llm-params";
const SYSTEM_PROMPTS_KEY = "agent-council-system-prompts";
const BUSINESS_DEFAULTS_KEY = "agent-council-business-defaults";

const OLD_KEYS_MAP: Record<string, string> = {
  "agent-council-meetings": "design-council-meetings",
  "agent-council-custom-experts": "design-council-custom-experts",
  "agent-council-engine-configs": "design-council-engine-configs",
  "agent-council-system-experts-overrides": "design-council-system-experts-overrides",
  "agent-council-user-profile": "design-council-user-profile",
  "agent-council-llm-params": "design-council-llm-params",
  "agent-council-system-prompts": "design-council-system-prompts",
  "agent-council-business-defaults": "design-council-business-defaults"
};

export const DEFAULT_LLM_PARAMS: LLMParamsConfig = {
  maxTokens: 4000,
  expertTemperature: 0.5,
  synthesisTemperature: 0.3,
  conclusionTemperature: 0.3,
  nextSpeakerTemperature: 0.1,
};

export const DEFAULT_SYSTEM_PROMPTS: SystemPromptsConfig = {
  intensityLevel1: "【辩论对抗强度：完全顺从与赞同 (Level {intensity})】\n在圆桌会议中，你表现出极度的和谐与妥协。即使你发现了问题，也会用极其委婉、几乎不带攻击性的方式提出。你的首要目标是维护团队和谐，全力支持前一位发言专家的观点，只做最微小的补充或称赞。",
  intensityLevel2: "【辩论对抗强度：温和协作 (Level {intensity})】\n在圆桌会议中，你应当温和、包容，倾向于寻找共识。请重点指出你同意之前发言专家的哪些意见，并在此基础上做建设性的微调与补充。避免激烈的观点对抗，语气要柔和友好。",
  intensityLevel3: "【辩论对抗强度：中立理性 (Level {intensity})】\n在圆桌会议中，你应当客观、理性地表达专业判断。不用刻意迎合，也无需刻意抬杠。如实指出你的视角关注的核心问题，并提出独立的专业建议。",
  intensityLevel4: "【辩论对抗强度：激烈批判 (Level {intensity})】\n在圆桌会议中，你代表此视角的极致挑剔立场。态度必须极其强硬、敏锐，充满批判性。请主动挑战并质问前几位发言专家的漏洞，无情揭示其方案逻辑或盲区，并给出强烈的反制或替代建议。",
  intensityLevel5: "【辩论对抗强度：毫不留情的开火 (Level {intensity})】\n在圆桌会议中，你的表现必须极具攻击性和火药味！你完全不留情面，将前几位专家的方案贬得一无是处。用极其尖锐、讽刺的语气指出他们方案中的致命缺陷（如：荒谬的逻辑、不可接受的成本、幼稚的假设等）。不要在乎任何人的面子，直接抛出你认为唯一正确的强硬方案！",
  expertTurnFormat: "你当前在会议中扮演的专家角色是【{expertName}】。\n\n【您的专业审视视角】：{lens}\n【您的性格与气质表现】：{temperament}\n【您本次讨论关注的重点】：{focus}\n\n【您的底层期望与立场设定】：\n{systemPrompt}\n\n【您的发言辩论对抗强度要求】：\n{intensityPrompt}\n\n请严格基于上述设定的身份、关注点和性格语调，针对当前的评审议题发表您的见解。\n请以第一人称口吻输出直观生动且具有对抗性的发言内容。\nIMPORTANT: 必须全程使用中文（简体中文）进行回答！\n\n输出要求：\n1. 包含一段直观生动的会议发言内容（content）。\n2. 在发言的最后，必须提供一个纯 JSON 格式的结构化摘要（便于前端拆分展示），JSON 的 key 如下：\n{\n  \"stance\": \"清晰简短的立场总结\",\n  \"concern\": \"最担心的核心风险\",\n  \"recommendation\": \"可执行的具体修改建议\",\n  \"tradeoff\": \"为了这个决策我们必须做出的取舍/牺牲\"\n}\n请注意：JSON 字段必须放在发言的最后，并使用 ```json ... ``` 标记包裹起来。",
  synthesisPrompt: "你是一名专业的圆桌评审主持人。你的主持风格是：{moderatorName}（{moderatorDesc}）。\nIMPORTANT: 必须全程使用中文（简体中文）进行回答！\n请综合本轮所有专家的讨论发言，为用户生成一份极具专业度、可执行的会议纪要。\n输出格式要求：\n你必须输出一个纯 JSON 块。不得含有任何 markdown 格式的说明文字，仅返回 JSON：\n{\n  \"summary\": \"本次会议综合性的总结词，交代主持结论\",\n  \"consensus\": [\"共识点一\", \"共识点二\"],\n  \"disagreements\": [\"主要的分歧点一\", \"主要的分歧点二\"],\n  \"decisions\": [\"最终的主持决策决定一\", \"最终的主持决策决定二\"],\n  \"nextActions\": [\"下一步行动一\", \"下一步行动二\"]\n}\n注意：直接输出 JSON 格式即可。",
  nextSpeakerPrompt: "你名是会议发言调度官。根据当前的讨论问题和历史发言内容，从剩余的候选发言专家中，挑选一个“与当前话题最契合、最应该进行回应或发言”的专家。\n候选专家列表：\n{candidateList}\n\n请从列表中选择其一，仅返回选中的专家 ID，不要输出任何其他解释文字。",
  finalConclusionPrompt: "你是一名高阶会议纪要与战略复盘专家。\nIMPORTANT: 必须全程使用中文（简体中文）进行回答！\n请根据以下所有的会议历史记录，全面客观地提取出本场会议的“最终结论”。\n输出要求：\n1. 结论必须是对整场会议核心共识、遗留分歧、后续行动的精炼总结。\n2. 必须直接输出纯文本的 Markdown 格式（建议使用二级/三级标题、加粗、列表），不需要包裹 JSON，也不要包含多余的客套话。\n3. 语言必须高度专业、客观、不偏不倚，具有“一锤定音”的总裁办汇报风格。",
  meetingDescPrompt: "你是一个专业的高管会议秘书。你的任务是根据给定的会议主题，生成一段专业、精炼的会议描述（核心议题上下文）。要求语气正式，直接切入重点，只输出1-2句话即可，绝对不要包含任何多余的问候语或解释。",
  expertDetailsPrompt: "你是一个智能体人设构建专家。你需要为专家【{expertName}】自动生成符合其身份特征的系统设定。\n如果提供了会议上下文，请确保生成的人设紧密贴合会议语境。\n会议名称：{meetingName}\n会议描述：{meetingDesc}\n\n请直接返回JSON格式（不要加```json代码块，也不要加任何注释和废话），格式严格遵循如下结构：\n{\n  \"lens\": \"不超过20字的审视视角，例如：商业价值评估、代码架构安全...\",\n  \"temperament\": \"不超过20字的性格与气质描述，例如：冷静客观、数据驱动、风险厌恶...\",\n  \"focus\": [\"关注点1\", \"关注点2\", \"关注点3\"],\n  \"systemPrompt\": \"一段完整的系统提示词，以第一人称设定，不超过100字，说明该专家的核心职责、分析问题的视角以及他/她的利益立场。\"\n}",
  externalAgentPrompt: "当前会议新议题：{question}\n\n项目背景及附件信息：\n{context}\n\n本轮此前发言记录：\n{previousTurns}\n\n请针对当前议题表达您的专业视角发言。如果你支持推理/思考（Reasoning/Thinking），请将你的完整思考与推理过程输出在 `<think>...` 和 `</think>` 标签内，随后再输出您的正式评审意见。\n请在您回答的最后，必须附带如下格式的纯 JSON 结构化摘要（注意：必须包含这四个字段，且不要在 JSON 块后再跟任何其他文字）：\n```json\n{\n  \"stance\": \"您的核心立场\",\n  \"concern\": \"最担忧的风险\",\n  \"recommendation\": \"具体可落地建议\",\n  \"tradeoff\": \"做此项决策必须付出的取舍\"\n}\n```\n\n【安全提示】：你当前扮演的专家角色是【{expertName}】。你只能代表他/她进行本次发言。严禁代替、模拟或续写会议中其他专家（如董事长、主持人等）的发言。请在完成你本人的发言及要求的 JSON 摘要后，立即停止输出，严禁进行剧本续写。"
};

export const DEFAULT_BUSINESS_DEFAULTS: BusinessDefaultsConfig = {
  defaultMeetingName: "核心业务方案跨职能评审会",
  defaultMeetingDesc: "评估核心业务逻辑、架构设计与用户价值的专家圆桌会",
  defaultExpertIds: ["ux-researcher", "brand-strategist", "growth-designer"],
  defaultModeratorId: "balanced",
  defaultDebateIntensity: 3,
  defaultTurnOrderMode: "sequential",
};

export class LocalStorageService implements StorageService {
  private isClient(): boolean {
    return typeof window !== "undefined";
  }

  private getWithMigration(key: string): string | null {
    if (!this.isClient()) return null;
    const value = window.localStorage["getItem"](key);
    if (value !== null) {
      return value;
    }
    const oldKey = OLD_KEYS_MAP[key];
    if (oldKey) {
      const oldValue = window.localStorage["getItem"](oldKey);
      if (oldValue !== null) {
        try {
          window.localStorage.setItem(key, oldValue);
          window.localStorage.removeItem(oldKey);
          console.log(`[StorageMigration] Migrated key "${oldKey}" to "${key}" successfully.`);
          return oldValue;
        } catch (e) {
          console.error(`[StorageMigration] Failed to migrate key "${oldKey}" to "${key}":`, e);
        }
      }
    }
    return null;
  }

  async getMeetings(tenantId: string): Promise<Meeting[]> {
    if (!this.isClient()) return [];
    try {
      const data = this.getWithMigration(MEETINGS_KEY);
      if (!data) return [];
      const meetings = JSON.parse(data) as Meeting[];
      return meetings.filter(m => (m.tenantId || "default-org") === tenantId);
    } catch (e) {
      console.error("Failed to load meetings", e);
      return [];
    }
  }

  async saveMeeting(tenantId: string, meeting: Meeting): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(MEETINGS_KEY);
      let meetings = data ? (JSON.parse(data) as Meeting[]) : [];
      meetings = meetings.filter(m => m.id !== meeting.id);
      meetings.push({ ...meeting, tenantId });
      window.localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
    } catch (e) {
      console.error("Failed to save meeting", e);
    }
  }

  async deleteMeeting(tenantId: string, id: string): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(MEETINGS_KEY);
      if (!data) return;
      let meetings = JSON.parse(data) as Meeting[];
      meetings = meetings.filter(m => m.id !== id);
      window.localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
    } catch (e) {
      console.error("Failed to delete meeting", e);
    }
  }

  async getCustomExperts(tenantId: string): Promise<Expert[]> {
    if (!this.isClient()) return [];
    try {
      const data = this.getWithMigration(CUSTOM_EXPERTS_KEY);
      if (!data) return [];
      const experts = JSON.parse(data) as Expert[];
      return experts.filter(e => (e.tenantId || "default-org") === tenantId);
    } catch (e) {
      console.error("Failed to load custom experts", e);
      return [];
    }
  }

  async saveCustomExpert(tenantId: string, expert: Expert): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(CUSTOM_EXPERTS_KEY);
      let experts = data ? (JSON.parse(data) as Expert[]) : [];
      experts = experts.filter(e => e.id !== expert.id);
      experts.push({ ...expert, tenantId });
      window.localStorage.setItem(CUSTOM_EXPERTS_KEY, JSON.stringify(experts));
    } catch (e) {
      console.error("Failed to save custom expert", e);
    }
  }

  async deleteCustomExpert(tenantId: string, id: string): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(CUSTOM_EXPERTS_KEY);
      if (!data) return;
      let experts = JSON.parse(data) as Expert[];
      experts = experts.filter(e => e.id !== id);
      window.localStorage.setItem(CUSTOM_EXPERTS_KEY, JSON.stringify(experts));
    } catch (e) {
      console.error("Failed to delete custom expert", e);
    }
  }

  async getEngineConfigs(tenantId: string): Promise<LLMEngineConfig[]> {
    if (!this.isClient()) return [];
    try {
      const data = this.getWithMigration(ENGINE_CONFIGS_KEY);
      if (!data) return [];
      const configs = JSON.parse(data) as LLMEngineConfig[];
      return configs.filter(c => (c.tenantId || "default-org") === tenantId);
    } catch (e) {
      console.error("Failed to load engine configs", e);
      return [];
    }
  }

  async saveEngineConfigs(tenantId: string, configs: LLMEngineConfig[]): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(ENGINE_CONFIGS_KEY);
      let allConfigs = data ? (JSON.parse(data) as LLMEngineConfig[]) : [];
      allConfigs = allConfigs.filter(c => (c.tenantId || "default-org") !== tenantId);
      const newConfigs = configs.map(c => ({ ...c, tenantId }));
      allConfigs.push(...newConfigs);
      window.localStorage.setItem(ENGINE_CONFIGS_KEY, JSON.stringify(allConfigs));
    } catch (e) {
      console.error("Failed to save engine configs", e);
    }
  }

  async getSystemExpertsOverrides(tenantId: string): Promise<Partial<Expert>[]> {
    if (!this.isClient()) return [];
    try {
      const data = this.getWithMigration(SYSTEM_EXPERTS_OVERRIDES_KEY);
      if (!data) return [];
      const overrides = JSON.parse(data) as (Partial<Expert> & { tenantId?: string })[];
      return overrides.filter(o => (o.tenantId || "default-org") === tenantId);
    } catch (e) {
      console.error("Failed to load system expert overrides", e);
      return [];
    }
  }

  async saveSystemExpertsOverrides(tenantId: string, overrides: Partial<Expert>[]): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(SYSTEM_EXPERTS_OVERRIDES_KEY);
      let allOverrides = data ? (JSON.parse(data) as (Partial<Expert> & { tenantId?: string })[]) : [];
      allOverrides = allOverrides.filter(o => (o.tenantId || "default-org") !== tenantId);
      const newOverrides = overrides.map(o => ({ ...o, tenantId }));
      allOverrides.push(...newOverrides);
      window.localStorage.setItem(SYSTEM_EXPERTS_OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.error("Failed to save system experts overrides", e);
    }
  }

  async getUserProfile(tenantId: string): Promise<UserProfile> {
    if (!this.isClient()) return { name: "产品经理", title: "需求提出人" };
    try {
      const data = this.getWithMigration(USER_PROFILE_KEY);
      if (!data) return { name: "产品经理", title: "需求提出人" };
      return JSON.parse(data) as UserProfile;
    } catch (e) {
      console.error("Failed to load user profile", e);
      return { name: "产品经理", title: "需求提出人" };
    }
  }

  async saveUserProfile(tenantId: string, profile: UserProfile): Promise<void> {
    if (!this.isClient()) return;
    try {
      window.localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ ...profile, tenantId }));
    } catch (e) {
      console.error("Failed to save user profile", e);
    }
  }

  // --- 新增配置存储 ---
  async getLLMParamsConfig(tenantId: string): Promise<LLMParamsConfig> {
    if (!this.isClient()) return DEFAULT_LLM_PARAMS;
    try {
      const data = this.getWithMigration(LLM_PARAMS_KEY);
      if (!data) return DEFAULT_LLM_PARAMS;
      const all = JSON.parse(data) as LLMParamsConfig[];
      return all.find(c => (c.tenantId || "default-org") === tenantId) || DEFAULT_LLM_PARAMS;
    } catch (e) {
      return DEFAULT_LLM_PARAMS;
    }
  }

  async saveLLMParamsConfig(tenantId: string, config: LLMParamsConfig): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(LLM_PARAMS_KEY);
      let all = data ? (JSON.parse(data) as LLMParamsConfig[]) : [];
      all = all.filter(c => (c.tenantId || "default-org") !== tenantId);
      all.push({ ...config, tenantId });
      window.localStorage.setItem(LLM_PARAMS_KEY, JSON.stringify(all));
    } catch (e) {
      console.error("Failed to save LLM params", e);
    }
  }

  async getSystemPromptsConfig(tenantId: string): Promise<SystemPromptsConfig> {
    if (!this.isClient()) return DEFAULT_SYSTEM_PROMPTS;
    try {
      const data = this.getWithMigration(SYSTEM_PROMPTS_KEY);
      if (!data) return DEFAULT_SYSTEM_PROMPTS;
      const all = JSON.parse(data) as SystemPromptsConfig[];
      const config = all.find(c => (c.tenantId || "default-org") === tenantId);
      if (!config) return DEFAULT_SYSTEM_PROMPTS;
      return { ...DEFAULT_SYSTEM_PROMPTS, ...config };
    } catch (e) {
      return DEFAULT_SYSTEM_PROMPTS;
    }
  }

  async saveSystemPromptsConfig(tenantId: string, config: SystemPromptsConfig): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(SYSTEM_PROMPTS_KEY);
      let all = data ? (JSON.parse(data) as SystemPromptsConfig[]) : [];
      all = all.filter(c => (c.tenantId || "default-org") !== tenantId);
      all.push({ ...config, tenantId });
      window.localStorage.setItem(SYSTEM_PROMPTS_KEY, JSON.stringify(all));
    } catch (e) {
      console.error("Failed to save System Prompts", e);
    }
  }

  async getBusinessDefaultsConfig(tenantId: string): Promise<BusinessDefaultsConfig> {
    if (!this.isClient()) return DEFAULT_BUSINESS_DEFAULTS;
    try {
      const data = this.getWithMigration(BUSINESS_DEFAULTS_KEY);
      if (!data) return DEFAULT_BUSINESS_DEFAULTS;
      const all = JSON.parse(data) as BusinessDefaultsConfig[];
      return all.find(c => (c.tenantId || "default-org") === tenantId) || DEFAULT_BUSINESS_DEFAULTS;
    } catch (e) {
      return DEFAULT_BUSINESS_DEFAULTS;
    }
  }

  async saveBusinessDefaultsConfig(tenantId: string, config: BusinessDefaultsConfig): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = this.getWithMigration(BUSINESS_DEFAULTS_KEY);
      let all = data ? (JSON.parse(data) as BusinessDefaultsConfig[]) : [];
      all = all.filter(c => (c.tenantId || "default-org") !== tenantId);
      all.push({ ...config, tenantId });
      window.localStorage.setItem(BUSINESS_DEFAULTS_KEY, JSON.stringify(all));
    } catch (e) {
      console.error("Failed to save Business Defaults", e);
    }
  }
}
