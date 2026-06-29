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

import defaultConfig from "@/config/default-config.json";

export const DEFAULT_LLM_PARAMS: LLMParamsConfig = defaultConfig.llmParams as LLMParamsConfig;
export const DEFAULT_SYSTEM_PROMPTS: SystemPromptsConfig = defaultConfig.systemPrompts as SystemPromptsConfig;
export const DEFAULT_BUSINESS_DEFAULTS: BusinessDefaultsConfig = defaultConfig.businessDefaults as BusinessDefaultsConfig;

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

      // 物理热检测并自动重置旧的主持人提示词（避免用户本地 LocalStorage 提示词滞后引起大模型依然输出纯 JSON 块）
      if (config.synthesisPrompt && config.synthesisPrompt.includes("你必须输出一个纯 JSON 块")) {
        console.log("[Migration] Detected legacy synthesisPrompt. Overriding with aligned default...");
        config.synthesisPrompt = DEFAULT_SYSTEM_PROMPTS.synthesisPrompt;
        // 同步回写存盘，避免后续再次触发热检测
        await this.saveSystemPromptsConfig(tenantId, config);
      }

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
