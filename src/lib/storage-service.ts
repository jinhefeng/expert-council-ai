import { Expert, LLMEngineConfig, Meeting, UserProfile } from "./types";

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
}

const MEETINGS_KEY = "design-council-meetings";
const CUSTOM_EXPERTS_KEY = "design-council-custom-experts";
const ENGINE_CONFIGS_KEY = "design-council-engine-configs";
const SYSTEM_EXPERTS_OVERRIDES_KEY = "design-council-system-experts-overrides";
const USER_PROFILE_KEY = "design-council-user-profile";

export class LocalStorageService implements StorageService {
  private isClient(): boolean {
    return typeof window !== "undefined";
  }

  async getMeetings(tenantId: string): Promise<Meeting[]> {
    if (!this.isClient()) return [];
    try {
      const data = window.localStorage.getItem(MEETINGS_KEY);
      if (!data) return [];
      const meetings = JSON.parse(data) as Meeting[];
      // 过滤当前租户的会议
      return meetings.filter(m => (m.tenantId || "default-org") === tenantId);
    } catch (e) {
      console.error("Failed to load meetings", e);
      return [];
    }
  }

  async saveMeeting(tenantId: string, meeting: Meeting): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = window.localStorage.getItem(MEETINGS_KEY);
      let meetings = data ? (JSON.parse(data) as Meeting[]) : [];
      
      // 过滤掉原本同名的进行覆盖
      meetings = meetings.filter(m => m.id !== meeting.id);
      
      // 附带 tenantId
      meetings.push({
        ...meeting,
        tenantId
      });

      window.localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
    } catch (e) {
      console.error("Failed to save meeting", e);
    }
  }

  async deleteMeeting(tenantId: string, id: string): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = window.localStorage.getItem(MEETINGS_KEY);
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
      const data = window.localStorage.getItem(CUSTOM_EXPERTS_KEY);
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
      const data = window.localStorage.getItem(CUSTOM_EXPERTS_KEY);
      let experts = data ? (JSON.parse(data) as Expert[]) : [];
      
      experts = experts.filter(e => e.id !== expert.id);
      experts.push({
        ...expert,
        tenantId
      });

      window.localStorage.setItem(CUSTOM_EXPERTS_KEY, JSON.stringify(experts));
    } catch (e) {
      console.error("Failed to save custom expert", e);
    }
  }

  async deleteCustomExpert(tenantId: string, id: string): Promise<void> {
    if (!this.isClient()) return;
    try {
      const data = window.localStorage.getItem(CUSTOM_EXPERTS_KEY);
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
      const data = window.localStorage.getItem(ENGINE_CONFIGS_KEY);
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
      // 存储时合并已有其他租户的，如果有多租户场景的话
      const data = window.localStorage.getItem(ENGINE_CONFIGS_KEY);
      let allConfigs = data ? (JSON.parse(data) as LLMEngineConfig[]) : [];
      
      // 过滤掉当前租户的所有引擎，然后追加最新的
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
      const data = window.localStorage.getItem(SYSTEM_EXPERTS_OVERRIDES_KEY);
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
      const data = window.localStorage.getItem(SYSTEM_EXPERTS_OVERRIDES_KEY);
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
      const data = window.localStorage.getItem(USER_PROFILE_KEY);
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
      window.localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({
        ...profile,
        tenantId
      }));
    } catch (e) {
      console.error("Failed to save user profile", e);
    }
  }
}
