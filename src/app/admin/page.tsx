"use client";

import { useEffect, useMemo, useState } from "react";
import { LocalStorageService } from "@/lib/storage-service";
import { Expert, LLMEngineConfig, UserProfile, LLMParamsConfig, SystemPromptsConfig, BusinessDefaultsConfig } from "@/lib/types";
import { DEFAULT_LLM_PARAMS, DEFAULT_SYSTEM_PROMPTS, DEFAULT_BUSINESS_DEFAULTS } from "@/lib/storage-service";
import { experts as defaultExperts, mergeSystemExperts } from "@/lib/experts";
import { ExpertModal } from "@/components/ExpertModal";

const TENANT_ID = "default-org";




function getHelpPlaceholders(fieldKey: keyof SystemPromptsConfig): React.ReactNode {
  const placeholders: Record<string, string[]> = {
    intensityLevel1: [
      "{intensity} - 当前设定的辩论对抗强度等级数字（如 1）"
    ],
    intensityLevel2: [
      "{intensity} - 当前设定的辩论对抗强度等级数字（如 2）"
    ],
    intensityLevel3: [
      "{intensity} - 当前设定的辩论对抗强度等级数字（如 3）"
    ],
    intensityLevel4: [
      "{intensity} - 当前设定的辩论对抗强度等级数字（如 4）"
    ],
    intensityLevel5: [
      "{intensity} - 当前设定的辩论对抗强度等级数字（如 5）"
    ],
    expertTurnFormat: [
      "{expertName} - 专家姓名（例如：小蔚）",
      "{expertTitle} - 专家的核心岗位头衔（例如：资深架构师）",
      "{lens} - 专家的专业审视视角说明",
      "{temperament} - 专家的性格与气质风格描述",
      "{focus} - 本轮专家的发言关注点",
      "{systemPrompt} - 专家底层系统预设/利益立场说明",
      "{intensityPrompt} - 计算后的当前对抗强度要求指令文本"
    ],
    externalAgentPrompt: [
      "{question} - 当前人类决策者的提问或干预指令内容",
      "{context} - 当前会议的背景描述及相关附件等上下文",
      "{previousTurns} - 此前圆桌会议中，其他已发言专家的记录",
      "{expertName} - 外部智能体扮演的专家角色姓名",
      "{expertTitle} - 外部智能体扮演的专家核心岗位头衔",
      "{userTitle} - 人类决策者的岗位/头衔名称",
      "{userName} - 人类决策者的具体姓名"
    ],
    nextSpeakerPrompt: [
      "{candidateList} - 剩余发言候选专家的列表信息（含 ID 和 姓名）"
    ],
    synthesisPrompt: [
      "{moderatorName} - AI 主持人的姓名",
      "{moderatorDesc} - AI 主持人提炼纪要的风格描述"
    ],
    finalConclusionPrompt: [
      "此阶段无特定占位符。用于指示模型根据会议全程历史记录生成 Markdown 结案报告。"
    ],
    meetingDescPrompt: [
      "此阶段无特定占位符。用于根据输入的会议主题自动提炼背景信息。"
    ],
    expertDetailsPrompt: [
      "{expertName} - 专家角色姓名",
      "{meetingName} - 会议名称",
      "{meetingDesc} - 会议背景描述"
    ],
    expertUserPromptFormat: [
      "{question} - 当前人类决策者的提问或干预指令内容",
      "{context} - 当前会议的背景描述及相关附件等上下文",
      "{previousTurns} - 此前圆桌会议中，其他已发言专家的记录",
      "{userTitle} - 人类决策者的岗位/头衔名称",
      "{userName} - 人类决策者的具体姓名"
    ],
    synthesisUserPromptFormat: [
      "{question} - 当前会议的主题议题",
      "{context} - 附件及背景项目说明等上下文",
      "{expertTurns} - 本轮中各位参会专家的详细发言文字记录"
    ],
    nextSpeakerUserPromptFormat: [
      "{question} - 当前会议的主题议题",
      "{previousTurns} - 本轮中已经进行的专家发言历史记录"
    ],
    finalConclusionUserPromptFormat: [
      "{context} - 圆桌会议各轮次的所有详细讨论记录（作为上下文）"
    ],
    prevTurnsHeaderPrompt: [
      "此阶段无特定占位符。用于包裹历史发言记录时，放置在发言内容列表的顶部作为引导词。"
    ],
    prevTurnsEmptyPrompt: [
      "此阶段无特定占位符。当本轮中尚无任何专家发言时，作为首个发言专家的引导语。"
    ]
  };

  const list = placeholders[fieldKey] || ["暂无特定占位符变量"];
  return list.map((item, idx) => (
    <li key={idx} style={{ marginBottom: "4px" }}>
      <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 4px", borderRadius: "4px", marginRight: "6px", fontFamily: "monospace" }}>{item.split(" - ")[0]}</code>: {item.split(" - ")[1] || ""}
    </li>
  ));
}

const CommonHelpButton = ({ title, text, onShowHelp }: { title: string; text: string; onShowHelp: (title: string, text: string) => void }) => (
  <button
    type="button"
    onClick={() => onShowHelp(title, text)}
    style={{
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      border: "1px solid var(--line)",
      background: "transparent",
      color: "var(--muted-light)",
      fontSize: "10px",
      fontWeight: "bold",
      marginLeft: "6px",
      verticalAlign: "middle",
      marginBottom: "2px",
      padding: 0,
      outline: "none"
    }}
    title="查看帮助说明"
  >
    ?
  </button>
);

export default function AdminPage() {
  const storage = useMemo(() => new LocalStorageService(), []);

  // 状态
  const [engineConfigs, setEngineConfigs] = useState<LLMEngineConfig[]>([]);
  const [activeHelp, setActiveHelp] = useState<{ title: string; content: React.ReactNode } | null>(null);
  const [systemOverrides, setSystemOverrides] = useState<Partial<Expert>[]>([]);
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: "产品经理", title: "需求提出人" });
  const [llmParams, setLlmParams] = useState<LLMParamsConfig>(DEFAULT_LLM_PARAMS);
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptsConfig>(DEFAULT_SYSTEM_PROMPTS);
  const [businessDefaults, setBusinessDefaults] = useState<BusinessDefaultsConfig>(DEFAULT_BUSINESS_DEFAULTS);
  
  const showCommonHelp = (title: string, text: string) => {
    setActiveHelp({
      title,
      content: (
        <div style={{ fontSize: "13.5px", color: "var(--ink-soft)", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
          {text}
        </div>
      )
    });
  };

  // 大模型表单 Modal
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [engineDraft, setEngineDraft] = useState<LLMEngineConfig>({
    id: "", name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o", isActive: false, isReasoningModel: false, enableStreaming: false,
  });

  // 单模型导入 Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");

  // 专家编辑 Modal
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false);
  const [expertModalMode, setExpertModalMode] = useState<"create" | "edit">("create");
  const [expertDraft, setExpertDraft] = useState<Partial<Expert>>({});

  // 全站配置导入 Modal
  const [isFullImportModalOpen, setIsFullImportModalOpen] = useState(false);
  const [fullImportDraft, setFullImportDraft] = useState("");

  // 全局确认 Modal
  const [confirmConfig, setConfirmConfig] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void}>({
    isOpen: false, title: "", message: "", onConfirm: () => {}
  });

  const confirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm });
  };

  useEffect(() => {
    async function load() {
      setEngineConfigs(await storage.getEngineConfigs(TENANT_ID));
      setSystemOverrides(await storage.getSystemExpertsOverrides(TENANT_ID));
      const allCustom = await storage.getCustomExperts(TENANT_ID);
      setCustomExperts(allCustom.filter(e => !e.meetingId));
      setUserProfile(await storage.getUserProfile(TENANT_ID));
      setLlmParams(await storage.getLLMParamsConfig(TENANT_ID));
      setSystemPrompts(await storage.getSystemPromptsConfig(TENANT_ID));
      setBusinessDefaults(await storage.getBusinessDefaultsConfig(TENANT_ID));
      setLlmParams(await storage.getLLMParamsConfig(TENANT_ID));
      setSystemPrompts(await storage.getSystemPromptsConfig(TENANT_ID));
      setBusinessDefaults(await storage.getBusinessDefaultsConfig(TENANT_ID));
    }
    void load();
  }, [storage]);

  // 计算合并后的系统专家
  const systemExperts = useMemo(() => mergeSystemExperts(defaultExperts, systemOverrides), [systemOverrides]);

  // 比对当前系统提示词是否是自定义配置 (与出厂默认配置进行内容深比对)
  const isPromptsCustomized = useMemo(() => {
    return JSON.stringify(systemPrompts) !== JSON.stringify(DEFAULT_SYSTEM_PROMPTS);
  }, [systemPrompts]);

  // 每一项提示词单独检测、指示与重置的 Label 组件
  const PromptLabelHeader = ({ title, fieldKey, tooltip }: { title: string; fieldKey: keyof SystemPromptsConfig; tooltip?: string }) => {
    const isCustomized = systemPrompts[fieldKey] !== DEFAULT_SYSTEM_PROMPTS[fieldKey];
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: "6px", overflow: "visible" }}>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {tooltip && (
            <button
              type="button"
              onClick={() => setActiveHelp({ 
                title, 
                content: (
                  <div>
                    <div style={{ fontSize: "13.5px", color: "var(--ink-soft)", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                      {tooltip}
                    </div>
                    <div style={{ marginTop: "20px", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "16px" }}>
                      <h4 style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", color: "var(--muted)", marginBottom: "8px", fontWeight: 600 }}>可用插槽变量说明：</h4>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--muted)", lineHeight: "1.8" }}>
                        {getHelpPlaceholders(fieldKey)}
                      </ul>
                    </div>
                  </div>
                )
              })}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--muted)",
                fontSize: "10px",
                fontWeight: "bold",
                marginLeft: "6px",
                padding: 0,
                outline: "none",
                transition: "all 0.2s ease"
              }}
              title="查看帮助说明"
            >
              ?
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "12px", whiteSpace: "nowrap" }}>
          {isCustomized ? (
            <>
              <span className="admin-badge-pill is-modified">
                已修改
              </span>
              <button 
                type="button" 
                className="admin-btn-text"
                onClick={() => {
                  confirm("恢复默认提示词", `确定要将该项提示词恢复为系统出厂默认配置吗？您仍需要点击页面底部的“保存提示词模板”以进行持久化生效。`, () => {
                    setSystemPrompts(prev => ({
                      ...prev,
                      [fieldKey]: DEFAULT_SYSTEM_PROMPTS[fieldKey]
                    }));
                    setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                  });
                }}
              >
                恢复默认
              </button>
            </>
          ) : (
            <span className="admin-badge-pill is-default">
              默认
            </span>
          )}
        </div>
      </div>
    );
  };



  // --- 用户配置管理 ---
  async function handleSaveUserProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile.name || !userProfile.title) {
      alert("请填写完整的姓名和岗位");
      return;
    }
    await storage.saveUserProfile(TENANT_ID, userProfile);
    alert("保存成功！");
  }

  // --- 新增配置管理 ---
  async function handleSaveLlmParams(e: React.FormEvent) {
    e.preventDefault();
    await storage.saveLLMParamsConfig(TENANT_ID, llmParams);
    alert("大模型调度参数保存成功！");
  }

  async function handleSaveSystemPrompts(e: React.FormEvent) {
    e.preventDefault();
    await storage.saveSystemPromptsConfig(TENANT_ID, systemPrompts);
    alert("系统工作流提示词保存成功！");
  }

  async function handleSaveBusinessDefaults(e: React.FormEvent) {
    e.preventDefault();
    await storage.saveBusinessDefaultsConfig(TENANT_ID, businessDefaults);
    alert("业务全局默认值保存成功！");
  }

  // --- 大模型管理 ---
  async function handleSaveEngine(e: React.FormEvent) {
    e.preventDefault();
    if (!engineDraft.name || !engineDraft.apiKey || !engineDraft.baseUrl || !engineDraft.model) {
      alert("请填写完整参数");
      return;
    }
    const isNew = !engineDraft.id;
    const newConfig: LLMEngineConfig = {
      ...engineDraft,
      id: isNew ? `engine-${Date.now()}` : engineDraft.id,
    };
    
    let nextConfigs = [...engineConfigs];
    if (isNew) {
      nextConfigs.push(newConfig);
    } else {
      nextConfigs = nextConfigs.map(c => c.id === newConfig.id ? newConfig : c);
    }
    
    setEngineConfigs(nextConfigs);
    await storage.saveEngineConfigs(TENANT_ID, nextConfigs);
    setIsEngineModalOpen(false);
  }

  function handleDeleteEngine(id: string) {
    confirm("删除大模型服务", "确定要删除该自定义大模型配置吗？此操作无法撤销。", async () => {
      const nextConfigs = engineConfigs.filter(c => c.id !== id);
      setEngineConfigs(nextConfigs);
      await storage.saveEngineConfigs(TENANT_ID, nextConfigs);
      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
    });
  }

  function handleExportEngineConfig(config: LLMEngineConfig) {
    const exportData = JSON.stringify(config, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportData).then(() => {
        alert(`${config.name} 配置已成功复制到剪贴板！`);
      }).catch(() => {
        // Fallback
      });
    }
  }

  async function handleImportEngineConfig() {
    if (!importDraft.trim()) return;
    try {
      const item = JSON.parse(importDraft);
      if (item.id && item.name && item.provider && item.baseUrl && item.apiKey && item.model) {
        let newConfigs = [...engineConfigs];
        const existingIdx = newConfigs.findIndex(c => c.id === item.id);
        if (existingIdx >= 0) {
          newConfigs[existingIdx] = { ...newConfigs[existingIdx], ...item };
        } else {
          newConfigs.push(item as LLMEngineConfig);
        }
        setEngineConfigs(newConfigs);
        await storage.saveEngineConfigs(TENANT_ID, newConfigs);
        setIsImportModalOpen(false);
        setImportDraft("");
        alert(`成功导入模型配置：${item.name}`);
      } else {
        alert("导入失败：未找到合法的引擎配置格式（缺少必要的字段）。");
      }
    } catch (e) {
      alert("导入失败：JSON 格式不正确。");
    }
  }

  // --- 全站配置导入导出 ---
  function handleExportFullConfig() {
    const fullConfig = {
      version: "1.0",
      type: "agent-council-ai-full-config",
      engineConfigs,
      systemOverrides,
      customExperts,
      userProfile,
      llmParams,
      systemPrompts,
      businessDefaults
    };
    const exportData = JSON.stringify(fullConfig, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportData).then(() => {
        alert("全站配置已成功打包并复制到剪贴板！");
      }).catch(() => {
        alert("配置打包成功，但未能自动复制到剪贴板，请检查浏览器权限。");
      });
    }
  }

  async function handleImportFullConfig() {
    if (!fullImportDraft.trim()) return;
    try {
      const data = JSON.parse(fullImportDraft);
      if (data.type !== "agent-council-ai-full-config" && data.type !== "design-council-ai-full-config") {
        alert("导入失败：该 JSON 数据不是合法的全站配置格式。");
        return;
      }
      
      // 执行反序列化并保存
      if (data.engineConfigs) await storage.saveEngineConfigs(TENANT_ID, data.engineConfigs);
      if (data.systemOverrides) await storage.saveSystemExpertsOverrides(TENANT_ID, data.systemOverrides);
      if (data.customExperts && Array.isArray(data.customExperts)) {
        for (const expert of data.customExperts) {
          await storage.saveCustomExpert(TENANT_ID, expert);
        }
      }
      if (data.userProfile) await storage.saveUserProfile(TENANT_ID, data.userProfile);
      if (data.llmParams) await storage.saveLLMParamsConfig(TENANT_ID, data.llmParams);
      if (data.systemPrompts) await storage.saveSystemPromptsConfig(TENANT_ID, data.systemPrompts);
      if (data.businessDefaults) await storage.saveBusinessDefaultsConfig(TENANT_ID, data.businessDefaults);

      setIsFullImportModalOpen(false);
      setFullImportDraft("");
      alert("全站配置导入成功！页面即将刷新以应用最新配置。");
      window.location.reload();
    } catch (e) {
      alert("导入失败：JSON 格式不正确。");
    }
  }

  // --- 组织专家库管理 ---
  function handleRestoreSystemExpert(id: string) {
    confirm("恢复内置智能体设定", "确定要清除所有的自定义修改，并将该智能体恢复为系统默认出厂配置吗？", async () => {
      const nextOverrides = systemOverrides.filter(o => o.id !== id);
      setSystemOverrides(nextOverrides);
      await storage.saveSystemExpertsOverrides(TENANT_ID, nextOverrides);
      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
    });
  }

  function openCreateExpert() {
    setExpertModalMode("create");
    setExpertDraft({ isCustom: true });
    setIsExpertModalOpen(true);
  }

  function openEditExpert(expert: Expert) {
    setExpertModalMode("edit");
    if (!expert.isCustom) {
      const override = systemOverrides.find(o => o.id === expert.id);
      setExpertDraft({ ...expert, ...override });
    } else {
      setExpertDraft({ ...expert });
    }
    setIsExpertModalOpen(true);
  }

  async function handleSaveExpert(finalExpert: Expert) {
    if (finalExpert.isCustom) {
      // 自定义智能体逻辑
      let nextCustom = [...customExperts];
      const existingIdx = nextCustom.findIndex(e => e.id === finalExpert.id);
      if (existingIdx >= 0) {
        nextCustom[existingIdx] = finalExpert;
      } else {
        nextCustom.push(finalExpert);
      }
      setCustomExperts(nextCustom);
      await storage.saveCustomExpert(TENANT_ID, finalExpert);
    } else {
      // 系统智能体覆写逻辑
      let nextOverrides = [...systemOverrides];
      const existingIdx = nextOverrides.findIndex(o => o.id === finalExpert.id);
      const overridePayload: Partial<Expert> = {
        id: finalExpert.id,
        name: finalExpert.name,
        title: finalExpert.title,
        lens: finalExpert.lens,
        temperament: finalExpert.temperament,
        systemPrompt: finalExpert.systemPrompt,
        debateIntensity: finalExpert.debateIntensity,
      };

      if (existingIdx >= 0) {
        nextOverrides[existingIdx] = { ...nextOverrides[existingIdx], ...overridePayload };
      } else {
        nextOverrides.push(overridePayload);
      }
      
      setSystemOverrides(nextOverrides);
      await storage.saveSystemExpertsOverrides(TENANT_ID, nextOverrides);
    }
    setIsExpertModalOpen(false);
  }

  function handleDeleteExpert(expert: Expert) {
    confirm("删除组织智能体", `确定要删除 "${expert.name}" 吗？此操作无法撤销。`, async () => {
      if (expert.isCustom) {
        const nextCustom = customExperts.filter(e => e.id !== expert.id);
        setCustomExperts(nextCustom);
        await storage.deleteCustomExpert(TENANT_ID, expert.id);
      } else {
        // 软删除系统专家
        let nextOverrides = [...systemOverrides];
        const existingIdx = nextOverrides.findIndex(o => o.id === expert.id);
        if (existingIdx >= 0) {
          nextOverrides[existingIdx] = { ...nextOverrides[existingIdx], isHidden: true };
        } else {
          nextOverrides.push({ id: expert.id, isHidden: true });
        }
        setSystemOverrides(nextOverrides);
        await storage.saveSystemExpertsOverrides(TENANT_ID, nextOverrides);
      }
      setConfirmConfig(prev => ({ ...prev, isOpen: false }));
    });
  }

  // 聚合当前显示的所有专家（过滤被软删除的系统专家）
  const visibleSystemExperts = systemExperts.filter(e => !e.isHidden);
  const allVisibleExperts = [...visibleSystemExperts, ...customExperts];

  return (
    <main className="app-shell" style={{ display: "block", height: "100vh", overflowY: "auto" }}>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">EC</div>
            <div>
              <p className="eyebrow">Expert Council AI - Admin Console</p>
              <h1>组织级智能体中心后台</h1>
            </div>
          </div>
          <div className="status-group">
            <span className="status-chip">{allVisibleExperts.length} 个组织智能体</span>
            <span className="status-chip">{engineConfigs.length} 个自定义模型</span>
            <button className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }} onClick={() => { setFullImportDraft(""); setIsFullImportModalOpen(true); }}>
              导入系统配置
            </button>
            <button className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }} onClick={handleExportFullConfig}>
              导出系统配置
            </button>
            <a href="/" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              ← 返回主会场
            </a>
          </div>
        </div>
      </header>

      <div className="workspace" style={{ display: "flex", gap: "32px", maxWidth: "1600px", margin: "40px auto", paddingBottom: "100px", alignItems: "flex-start", overflow: "visible" }}>
  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "32px", minWidth: 0 }}>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>人类决策者（干预人）身份预设</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置您的称呼与头衔，这将会显示在您的干预指令提问气泡上方。</p>
            </div>
          </div>
          <form onSubmit={handleSaveUserProfile} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "16px", alignItems: "end" }}>
            <label className="compact-field" style={{ marginBottom: 0 }}>
              <span style={{ marginBottom: "6px", display: "block", fontSize: "13px", fontWeight: 600 }}>姓名</span>
              <input required placeholder="如：张三" value={userProfile.name} onChange={e => setUserProfile({ ...userProfile, name: e.target.value })} />
            </label>
            <label className="compact-field" style={{ marginBottom: 0 }}>
              <span style={{ marginBottom: "6px", display: "block", fontSize: "13px", fontWeight: 600 }}>岗位 / 头衔</span>
              <input required placeholder="如：产品经理" value={userProfile.title} onChange={e => setUserProfile({ ...userProfile, title: e.target.value })} />
            </label>
            <button type="submit" className="primary-button">保存配置</button>
          </form>
        </section>

        <section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>AI 主持人身份预设</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置系统提炼纪要的 AI 主持人的姓名和头衔。</p>
            </div>
          </div>
          <form onSubmit={handleSaveSystemPrompts} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "16px", alignItems: "end" }}>
            <label className="compact-field" style={{ marginBottom: 0 }}>
              <span style={{ marginBottom: "6px", display: "block", fontSize: "13px", fontWeight: 600 }}>主持人姓名</span>
              <input required placeholder="如：平衡主持人" value={systemPrompts.moderatorName || ""} onChange={e => setSystemPrompts({ ...systemPrompts, moderatorName: e.target.value })} />
            </label>
            <label className="compact-field" style={{ marginBottom: 0 }}>
              <span style={{ marginBottom: "6px", display: "block", fontSize: "13px", fontWeight: 600 }}>核心头衔</span>
              <input required placeholder="如：决策协调官" value={systemPrompts.moderatorTitle || ""} onChange={e => setSystemPrompts({ ...systemPrompts, moderatorTitle: e.target.value })} />
            </label>
            <button type="submit" className="primary-button">保存主持人预设</button>
          </form>
        </section>

        <section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>发言记录与上下文配置</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置平台级历史发言拼接模式与大模型输入清洗策略。</p>
            </div>
          </div>
          <form onSubmit={handleSaveSystemPrompts} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <div className="role-card" style={{ cursor: "default", padding: "16px", background: "rgba(255, 255, 255, 0.45)", borderRadius: "10px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>总结时清洗专家思维链</h4>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: "1.5" }}>主持人在总结或派单时，自动清洗并物理剥除专家发言中包裹在 &lt;think&gt;...&lt;/think&gt; 中的思考推理过程。</p>
                  </div>
                  <label className="toggle-switch" style={{ display: "inline-flex", cursor: "pointer", userSelect: "none" }}>
                    <input 
                      type="checkbox" 
                      checked={systemPrompts.cleanThinkForSynthesis !== false} 
                      onChange={e => setSystemPrompts({ ...systemPrompts, cleanThinkForSynthesis: e.target.checked })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </label>
                </div>
              </div>

              <div className="role-card" style={{ cursor: "default", padding: "16px", background: "rgba(255, 255, 255, 0.45)", borderRadius: "10px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>历史发言采用引用格式</h4>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: "1.5" }}>将所有拼入上下文的历史专家发言加上 &gt; Markdown 引用符号进行缩进排版，清晰划定发言边界，防范大模型注意力漂移。</p>
                  </div>
                  <label className="toggle-switch" style={{ display: "inline-flex", cursor: "pointer", userSelect: "none" }}>
                    <input 
                      type="checkbox" 
                      checked={systemPrompts.blockquoteFormatForTurns !== false} 
                      onChange={e => setSystemPrompts({ ...systemPrompts, blockquoteFormatForTurns: e.target.checked })}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="primary-button" style={{ width: "fit-content" }}>保存配置</button>
            </div>
          </form>
        </section>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>组织大模型配置</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置和管理可供全组织调用的底层推理大模型 API。</p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
              <button className="ghost-button" style={{ padding: "8px 16px", fontSize: "13px", whiteSpace: "nowrap" }} onClick={() => { setImportDraft(""); setIsImportModalOpen(true); }}>导入单模型</button>
              <button className="primary-button" style={{ padding: "8px 16px", fontSize: "13px", whiteSpace: "nowrap" }} type="button" onClick={() => {
                setEngineDraft({ id: "", name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o", isActive: false, isReasoningModel: false, enableStreaming: false });
                setIsEngineModalOpen(true);
              }}>
                + 新建配置
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {engineConfigs.map(config => (
              <div key={config.id} className="role-card" style={{ cursor: "default" }}>
                <div className="role-topline">
                  <div>
                    <p className="role-name" style={{ fontSize: "16px" }}>{config.name}</p>
                    <p className="role-title" style={{ marginTop: "6px" }}>{config.model} · {config.baseUrl}</p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
                    <button className="ghost-button" style={{ padding: "4px 8px" }} onClick={() => handleExportEngineConfig(config)}>导出</button>
                    <button className="ghost-button" style={{ padding: "4px 8px" }} onClick={() => { setEngineDraft(config); setIsEngineModalOpen(true); }}>编辑</button>
                    <button className="btn-delete" type="button" onClick={() => handleDeleteEngine(config.id)} title="删除模型配置">
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {engineConfigs.length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: "14px", background: "var(--surface-subtle)", borderRadius: "8px" }}>
                暂无自定义大模型配置，系统将默认使用系统环境变量中配置的模型。
              </div>
            )}
          </div>
        </section>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>组织级专家库</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                统一管理全组织的智能体阵容。您可以对内置专家进行深度重塑与隐藏，或创建全新的专属业务专家。
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
              <button className="primary-button" style={{ padding: "8px 16px", fontSize: "13px", whiteSpace: "nowrap" }} type="button" onClick={openCreateExpert}>
                + 新建智能体
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
            {allVisibleExperts.map(expert => {
              const isOverridden = !expert.isCustom && systemOverrides.some(o => o.id === expert.id);
              return (
                <div key={expert.id} className="role-card" style={{ cursor: "default" }}>
                  <div className="role-topline">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <p className="role-name" style={{ fontSize: "16px" }}>{expert.name}</p>
                          {expert.isCustom ? (
                            <span style={{ fontSize: "11px", color: "var(--blue)", border: "1px solid var(--blue)", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>组织自定义</span>
                          ) : isOverridden ? (
                            <span style={{ fontSize: "11px", color: "var(--amber)", border: "1px solid var(--amber)", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>已覆盖修改</span>
                          ) : null}
                        </div>
                        <p className="role-title" style={{ marginTop: "6px" }}>{expert.title}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
                      {isOverridden && (
                        <button className="text-button" style={{ color: "var(--amber)" }} onClick={() => handleRestoreSystemExpert(expert.id)}>恢复默认</button>
                      )}
                      <button className="ghost-button" style={{ padding: "4px 8px" }} onClick={() => openEditExpert(expert)}>编辑</button>
                      <button className="btn-delete" type="button" onClick={() => handleDeleteExpert(expert)} title="删除智能体">
                        ×
                      </button>
                    </div>
                  </div>
                  <p className="role-lens">{expert.lens}</p>
                </div>
              );
            })}
          </div>
        </section>
  </div>
  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "32px", minWidth: 0 }}>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>业务全局默认值</h2>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置新建会议时的初始状态。</p>
          </div>
          <form onSubmit={handleSaveBusinessDefaults} style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
            <label className="compact-field">
              <span>默认会议名称<CommonHelpButton title="默认会议名称" text="新建会议时的初始名称，可随时修改" onShowHelp={showCommonHelp} /></span>
              <input required value={businessDefaults.defaultMeetingName} onChange={e => setBusinessDefaults({ ...businessDefaults, defaultMeetingName: e.target.value })} />
            </label>
            <label className="compact-field">
              <span>默认会议描述<CommonHelpButton title="默认会议描述" text="会议的初始背景说明，将作为大模型的初始上下文注入" onShowHelp={showCommonHelp} /></span>
              <input required value={businessDefaults.defaultMeetingDesc} onChange={e => setBusinessDefaults({ ...businessDefaults, defaultMeetingDesc: e.target.value })} />
            </label>
            <label className="compact-field">
              <span>默认全局辩论强度 (1-5)<CommonHelpButton title="默认全局辩论强度 (1-5)" text="新建会议的初始火力值。1为极度顺从，5为毫不留情的抨击。注意：每个专家也有自己的基础强度，最终表现为两者求平均值" onShowHelp={showCommonHelp} /></span>
              <input type="number" min="1" max="5" required value={businessDefaults.defaultDebateIntensity} onChange={e => setBusinessDefaults({ ...businessDefaults, defaultDebateIntensity: parseInt(e.target.value) })} />
            </label>
            <label className="compact-field">
              <span>默认流转模式<CommonHelpButton title="默认流转模式" text="【顺序发言】：轮流排队发言\n【智能派单】：大模型根据上下文自动挑选下一个最适合反驳/补充的专家\n【手动点名】：用户自己选择谁来回答" onShowHelp={showCommonHelp} /></span>
              <select required value={businessDefaults.defaultTurnOrderMode} onChange={e => setBusinessDefaults({ ...businessDefaults, defaultTurnOrderMode: e.target.value as any })}>
                <option value="sequential">顺序发言</option>
                <option value="relevance">智能相关度派单</option>
                <option value="manual">手动点名</option>
              </select>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="submit" className="primary-button">保存默认值</button>
            </div>
          </form>
        </section>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>大模型调度参数管理</h2>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置生成 token 限制及各个环节的 Temperature 参数。</p>
          </div>
          <form onSubmit={handleSaveLlmParams} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label className="compact-field">
              <span>Max Tokens (最大生成长度)<CommonHelpButton title="Max Tokens (最大生成长度)" text="单次大模型调用最多允许生成的字数（Token数）。值越大，专家能长篇大论，但响应更慢、成本更高" onShowHelp={showCommonHelp} /></span>
              <input type="number" required value={llmParams.maxTokens} onChange={e => setLlmParams({ ...llmParams, maxTokens: parseInt(e.target.value) })} />
            </label>
            <label className="compact-field">
              <span>专家发言 Temperature (0-2)<CommonHelpButton title="专家发言 Temperature" text="控制专家观点发散程度。较高值(如0.7-0.9)可带来更具创意的观点，但过高可能胡言乱语；较低值(如0.3)则更严谨保守" onShowHelp={showCommonHelp} /></span>
              <input type="number" step="0.1" required value={llmParams.expertTemperature} onChange={e => setLlmParams({ ...llmParams, expertTemperature: parseFloat(e.target.value) })} />
            </label>
            <label className="compact-field">
              <span>主持人总结 Temperature (0-2)<CommonHelpButton title="主持人总结 Temperature" text="控制纪要提炼的严谨度。建议保持较低(0.3)，确保总结准确无误，不随意捏造共识" onShowHelp={showCommonHelp} /></span>
              <input type="number" step="0.1" required value={llmParams.synthesisTemperature} onChange={e => setLlmParams({ ...llmParams, synthesisTemperature: parseFloat(e.target.value) })} />
            </label>
            <label className="compact-field">
              <span>最终结论 Temperature (0-2)<CommonHelpButton title="最终结论 Temperature" text="控制最终结案陈词的发挥空间。建议较低以保证高度结构化" onShowHelp={showCommonHelp} /></span>
              <input type="number" step="0.1" required value={llmParams.conclusionTemperature} onChange={e => setLlmParams({ ...llmParams, conclusionTemperature: parseFloat(e.target.value) })} />
            </label>
            <label className="compact-field">
              <span>智能派单 Temperature (0-2)<CommonHelpButton title="智能派单 Temperature" text="大模型决定下一个发言人时的参数。建议极低(0.1)，保证其选人的逻辑稳定性" onShowHelp={showCommonHelp} /></span>
              <input type="number" step="0.1" required value={llmParams.nextSpeakerTemperature} onChange={e => setLlmParams({ ...llmParams, nextSpeakerTemperature: parseFloat(e.target.value) })} />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="submit" className="primary-button">保存调度参数</button>
            </div>
          </form>
        </section>
<section className="panel" style={{ padding: "24px", overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "18px", margin: "0" }}>系统工作流提示词管理 (System Prompts)</h2>
                {isPromptsCustomized ? (
                  <span style={{ 
                    fontSize: "11px", 
                    color: "var(--amber)", 
                    border: "1px solid var(--amber-soft)", 
                    background: "rgba(245, 158, 11, 0.06)", 
                    padding: "2px 6px", 
                    borderRadius: "4px", 
                    fontWeight: 600,
                    letterSpacing: "0.5px"
                  }}>
                    已自定义修改
                  </span>
                ) : (
                  <span style={{ 
                    fontSize: "11px", 
                    color: "var(--green)", 
                    border: "1px solid var(--green-soft)", 
                    background: "rgba(16, 185, 129, 0.06)", 
                    padding: "2px 6px", 
                    borderRadius: "4px", 
                    fontWeight: 600,
                    letterSpacing: "0.5px"
                  }}>
                    出厂默认配置
                  </span>
                )}
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--muted)" }}>配置各个节点的系统级指令。按照会议流转的生命周期排序。注意不要删改花括号 `{"{ }"}` 内部的变量名。</p>
            </div>
            <button 
              type="button" 
              className="ghost-button" 
              style={{ 
                padding: "8px 16px", 
                fontSize: "13px", 
                color: "var(--amber)", 
                borderColor: "var(--amber-soft)", 
                whiteSpace: "nowrap",
                fontWeight: 500,
                transition: "all 0.2s ease"
              }}
              onClick={() => {
                confirm("重置系统工作流提示词", "确定要将所有节点的提示词模板恢复为出厂配置吗？此操作将丢弃您在此模块做出的所有修改（如有）。", async () => {
                  setSystemPrompts(DEFAULT_SYSTEM_PROMPTS);
                  await storage.saveSystemPromptsConfig(TENANT_ID, DEFAULT_SYSTEM_PROMPTS);
                  setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                  alert("已重置系统提示词为出厂默认配置！");
                });
              }}
            >
              重置为出厂提示词
            </button>
          </div>
          <form onSubmit={handleSaveSystemPrompts} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ background: "var(--surface-subtle)", padding: "16px", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ fontSize: "14px", margin: 0, color: "var(--ink)" }}>阶段一：专家发言设定</h3>
              <div className="compact-field">
                <PromptLabelHeader title="对抗强度 1 (完全顺从与赞同)" fieldKey="intensityLevel1" tooltip="可用替换占位符：{intensity} (代表当前的对抗强度数值，如 1)" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.intensityLevel1} onChange={e => setSystemPrompts({ ...systemPrompts, intensityLevel1: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader title="对抗强度 2 (温和协作)" fieldKey="intensityLevel2" tooltip="可用替换占位符：{intensity} (代表当前的对抗强度数值，如 2)" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.intensityLevel2} onChange={e => setSystemPrompts({ ...systemPrompts, intensityLevel2: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader title="对抗强度 3 (中立理性)" fieldKey="intensityLevel3" tooltip="可用替换占位符：{intensity} (代表当前的对抗强度数值，如 3)" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.intensityLevel3} onChange={e => setSystemPrompts({ ...systemPrompts, intensityLevel3: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader title="对抗强度 4 (激烈批判)" fieldKey="intensityLevel4" tooltip="可用替换占位符：{intensity} (代表当前的对抗强度数值，如 4)" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.intensityLevel4} onChange={e => setSystemPrompts({ ...systemPrompts, intensityLevel4: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader title="对抗强度 5 (毫不留情的开火)" fieldKey="intensityLevel5" tooltip="可用替换占位符：{intensity} (代表当前的对抗强度数值，如 5)" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.intensityLevel5} onChange={e => setSystemPrompts({ ...systemPrompts, intensityLevel5: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="专家发言框架格式要求" 
                  fieldKey="expertTurnFormat" 
                  tooltip="本字段是核心的发言模板。支持以下花括号占位符：&#10;• {expertName} - 专家姓名&#10;• {lens} - 专业审视视角&#10;• {temperament} - 专家性格与气质&#10;• {focus} - 本轮关注的重点&#10;• {systemPrompt} - 专家底层的利益立场系统预设&#10;• {intensityPrompt} - 计算出的发言激烈对抗强度要求"
                />
                <textarea style={{ minHeight: "120px", fontFamily: "monospace" }} required value={systemPrompts.expertTurnFormat} onChange={e => setSystemPrompts({ ...systemPrompts, expertTurnFormat: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="外部智能体发言提示词模板" 
                  fieldKey="externalAgentPrompt" 
                  tooltip="下发给外部大模型或小龙虾客户端的提示词模板。支持占位符：&#10;• {question} - 圆桌会议当前新议题&#10;• {context} - 项目背景及相关附件内容&#10;• {previousTurns} - 本轮截止目前的其他专家发言记录&#10;• {expertName} - 专家角色姓名&#10;• {expertTitle} - 专家角色头衔&#10;• {userTitle} - 人类决策者头衔&#10;• {userName} - 人类决策者姓名"
                />
                <textarea style={{ minHeight: "150px", fontFamily: "monospace" }} required value={systemPrompts.externalAgentPrompt || ""} onChange={e => setSystemPrompts({ ...systemPrompts, externalAgentPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="专家发言 User Context 拼接模板" 
                  fieldKey="expertUserPromptFormat" 
                  tooltip="调用专家发言大模型时拼接 User 引导词的模板。支持占位符：&#10;• {question} - 圆桌当前新议题&#10;• {context} - 项目背景及相关附件&#10;• {previousTurns} - 本轮讨论已发言历史&#10;• {userTitle} - 人类决策者头衔&#10;• {userName} - 人类决策者姓名"
                />
                <textarea style={{ minHeight: "120px", fontFamily: "monospace" }} required value={systemPrompts.expertUserPromptFormat || ""} onChange={e => setSystemPrompts({ ...systemPrompts, expertUserPromptFormat: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="历史发言前导引导语" 
                  fieldKey="prevTurnsHeaderPrompt" 
                  tooltip="有此前已发言专家记录时的前导话术引导词。无特定替换占位符"
                />
                <textarea style={{ minHeight: "60px", fontFamily: "monospace" }} required value={systemPrompts.prevTurnsHeaderPrompt || ""} onChange={e => setSystemPrompts({ ...systemPrompts, prevTurnsHeaderPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="历史发言空时引导语" 
                  fieldKey="prevTurnsEmptyPrompt" 
                  tooltip="本轮讨论尚未有任何专家发言时的首位发言引导语。无特定替换占位符"
                />
                <textarea style={{ minHeight: "60px", fontFamily: "monospace" }} required value={systemPrompts.prevTurnsEmptyPrompt || ""} onChange={e => setSystemPrompts({ ...systemPrompts, prevTurnsEmptyPrompt: e.target.value })} />
              </div>
            </div>

            <div style={{ background: "var(--surface-subtle)", padding: "16px", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ fontSize: "14px", margin: 0, color: "var(--ink)" }}>阶段二：智能流转与总结</h3>
              <div className="compact-field">
                <PromptLabelHeader title="智能调度官选人指令" fieldKey="nextSpeakerPrompt" tooltip="用于决定下一位发言的内置/外部专家。支持占位符：• {candidateList} - 剩余发言候选人的列表" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.nextSpeakerPrompt} onChange={e => setSystemPrompts({ ...systemPrompts, nextSpeakerPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="智能派单 User Context 拼接模板" 
                  fieldKey="nextSpeakerUserPromptFormat" 
                  tooltip="调用智能选人调度官选人时，拼装 User 引导词的模板。支持占位符：&#10;• {question} - 圆桌当前新议题&#10;• {previousTurns} - 本轮已发言历史"
                />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.nextSpeakerUserPromptFormat || ""} onChange={e => setSystemPrompts({ ...systemPrompts, nextSpeakerUserPromptFormat: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader title="主持人提炼纪要指令" fieldKey="synthesisPrompt" tooltip="用于提炼本次讨论的综合共识与最终决策。支持占位符：• {moderatorName} - 主持人名字，• {moderatorDesc} - 主持人风格描述" />
                <textarea style={{ minHeight: "150px", fontFamily: "monospace" }} required value={systemPrompts.synthesisPrompt} onChange={e => setSystemPrompts({ ...systemPrompts, synthesisPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="主持人提炼 User Context 拼接模板" 
                  fieldKey="synthesisUserPromptFormat" 
                  tooltip="提炼纪要时拼装 User 引导词的模板。支持占位符：&#10;• {question} - 圆桌当前议题&#10;• {context} - 项目背景及附件上下文&#10;• {expertTurns} - 本轮已发言记录"
                />
                <textarea style={{ minHeight: "100px", fontFamily: "monospace" }} required value={systemPrompts.synthesisUserPromptFormat || ""} onChange={e => setSystemPrompts({ ...systemPrompts, synthesisUserPromptFormat: e.target.value })} />
              </div>
            </div>

            <div style={{ background: "var(--surface-subtle)", padding: "16px", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ fontSize: "14px", margin: 0, color: "var(--ink)" }}>阶段三：会议结束</h3>
              <div className="compact-field">
                <PromptLabelHeader title="最终结论生成指令" fieldKey="finalConclusionPrompt" tooltip="当全部轮次结束后，根据完整的历史记录生成 Markdown 结案陈词。无特定替换占位符" />
                <textarea style={{ minHeight: "100px", fontFamily: "monospace" }} required value={systemPrompts.finalConclusionPrompt} onChange={e => setSystemPrompts({ ...systemPrompts, finalConclusionPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="结案陈词 User Context 拼接模板" 
                  fieldKey="finalConclusionUserPromptFormat" 
                  tooltip="生成结案陈词时拼接 User 引导词的模板。支持占位符：&#10;• {context} - 会议全程专家发言文字的完整历史记录"
                />
                <textarea style={{ minHeight: "100px", fontFamily: "monospace" }} required value={systemPrompts.finalConclusionUserPromptFormat || ""} onChange={e => setSystemPrompts({ ...systemPrompts, finalConclusionUserPromptFormat: e.target.value })} />
              </div>
            </div>

            <div style={{ background: "var(--surface-subtle)", padding: "16px", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ fontSize: "14px", margin: 0, color: "var(--ink)" }}>阶段四：AI 辅助生成配置</h3>
              <div className="compact-field">
                <PromptLabelHeader title="会议描述辅助生成指令" fieldKey="meetingDescPrompt" tooltip="在会议面板中根据标题一键生成议题描述背景的 System Prompt。无特定替换占位符" />
                <textarea style={{ minHeight: "80px", fontFamily: "monospace" }} required value={systemPrompts.meetingDescPrompt} onChange={e => setSystemPrompts({ ...systemPrompts, meetingDescPrompt: e.target.value })} />
              </div>
              <div className="compact-field">
                <PromptLabelHeader 
                  title="专家人设辅助生成指令" 
                  fieldKey="expertDetailsPrompt" 
                  tooltip="在后台一键辅助生成专家视角、性格和立场配置的 System Prompt。支持占位符：• {expertName} - 专家名，• {meetingName} - 会议名称，• {meetingDesc} - 会议背景描述"
                />
                <textarea style={{ minHeight: "150px", fontFamily: "monospace" }} required value={systemPrompts.expertDetailsPrompt} onChange={e => setSystemPrompts({ ...systemPrompts, expertDetailsPrompt: e.target.value })} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="submit" className="primary-button">保存提示词模板</button>
            </div>
          </form>
        </section>
  </div>
</div>

      {/* 大模型编辑 Modal */}
      {isEngineModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsEngineModalOpen(false)}>
          <section className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Engine Configuration</p>
                <h2>{engineDraft.id ? "编辑大模型配置" : "新建大模型配置"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsEngineModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <form onSubmit={handleSaveEngine} style={{ padding: "0 24px" }}>
              <label className="compact-field">
                <span>配置名称</span>
                <input required placeholder="如：公司内部 GPT-4" value={engineDraft.name} onChange={e => setEngineDraft({...engineDraft, name: e.target.value})} />
              </label>
              <label className="compact-field">
                <span>Base URL</span>
                <input required placeholder="https://api.openai.com/v1" value={engineDraft.baseUrl} onChange={e => setEngineDraft({...engineDraft, baseUrl: e.target.value})} />
              </label>
              <label className="compact-field">
                <span>API Key</span>
                <input required type="password" placeholder="sk-..." value={engineDraft.apiKey} onChange={e => setEngineDraft({...engineDraft, apiKey: e.target.value})} />
              </label>
              <label className="compact-field">
                <span>Model 标识符</span>
                <input required placeholder="如：gpt-4o, qwen-max" value={engineDraft.model} onChange={e => setEngineDraft({...engineDraft, model: e.target.value})} />
              </label>
              <div style={{ display: "flex", gap: "16px", marginTop: "8px", marginBottom: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!engineDraft.isReasoningModel} onChange={e => setEngineDraft({...engineDraft, isReasoningModel: e.target.checked})} />
                  推理模型 (支持 o1/DeepSeek-R1)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!engineDraft.enableStreaming} onChange={e => setEngineDraft({...engineDraft, enableStreaming: e.target.checked})} />
                  启用流式输出 (逐字渲染)
                </label>
              </div>
              <div className="modal-actions" style={{ padding: "24px 0", marginTop: "8px" }}>
                <button type="button" className="ghost-button" onClick={() => setIsEngineModalOpen(false)}>取消</button>
                <button type="submit" className="primary-button">保存配置</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* 导入模型 Modal */}
      {isImportModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsImportModalOpen(false)}>
          <section className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Import Model</p>
                <h2>导入单模型配置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsImportModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ padding: "0 24px" }}>
              <label className="compact-field">
                <span>单模型 JSON 代码</span>
                <textarea 
                  value={importDraft}
                  onChange={e => setImportDraft(e.target.value)}
                  placeholder='{\n  "id": "engine-xxx",\n  "name": "My Model",\n  "provider": "openai",\n  ...\n}'
                  style={{ width: "100%", height: "200px", fontFamily: "monospace", resize: "vertical" }}
                />
              </label>
              <div className="modal-actions" style={{ padding: "24px 0", marginTop: "8px" }}>
                <button type="button" className="ghost-button" onClick={() => setIsImportModalOpen(false)}>取消</button>
                <button type="button" className="primary-button" onClick={handleImportEngineConfig}>解析并导入</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 全站配置导入 Modal */}
      {isFullImportModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsFullImportModalOpen(false)}>
          <section className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Import Full Configuration</p>
                <h2>导入系统全站配置</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsFullImportModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ padding: "0 24px" }}>
              <div style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "8px", fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>
                导入操作将合并并覆盖现有的各项配置（包括大模型配置、提示词、大模型参数、组织内自定义专家等）。执行成功后页面将自动刷新。
              </div>
              <label className="compact-field">
                <span>全量配置 JSON 文本</span>
                <textarea 
                  value={fullImportDraft}
                  onChange={e => setFullImportDraft(e.target.value)}
                  placeholder='粘贴您通过 "导出系统配置" 获得的 JSON 完整数据...'
                  style={{ width: "100%", height: "250px", fontFamily: "monospace", resize: "vertical" }}
                />
              </label>
              <div className="modal-actions" style={{ padding: "24px 0", marginTop: "8px" }}>
                <button type="button" className="ghost-button" onClick={() => setIsFullImportModalOpen(false)}>取消</button>
                <button type="button" className="primary-button" style={{ background: "var(--amber)", borderColor: "var(--amber)", color: "white" }} onClick={handleImportFullConfig}>确认覆盖导入</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 专家编辑 Modal (抽取重用的组件) */}
      <ExpertModal 
        isOpen={isExpertModalOpen}
        mode={expertModalMode}
        initialData={expertDraft}
        onClose={() => setIsExpertModalOpen(false)}
        onSave={handleSaveExpert}
      />

      {/* 全局确认 Modal */}
      {confirmConfig.isOpen && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>
          <section className="modal-card" style={{ width: "400px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Confirm Action</p>
                <h2>{confirmConfig.title}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ padding: "0 24px" }}>
              <p style={{ margin: "12px 0 24px 0", fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {confirmConfig.message}
              </p>
              <div className="modal-actions" style={{ padding: "16px 0 24px 0" }}>
                <button type="button" className="ghost-button" onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>取消</button>
                <button type="button" className="primary-button" style={{ background: "var(--red)", borderColor: "var(--red)", color: "white" }} onClick={confirmConfig.onConfirm}>确定执行</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 磨砂 HelpModal */}
      {activeHelp && (
        <div 
          className="modal-backdrop" 
          style={{ 
            zIndex: 9999,
            backdropFilter: "blur(12px)", 
            WebkitBackdropFilter: "blur(12px)", 
            background: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }} 
          onClick={() => setActiveHelp(null)}
        >
          <section 
            className="modal-card" 
            style={{ 
              width: "550px", 
              background: "rgba(255, 255, 255, 0.75)", 
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.4)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
              borderRadius: "16px",
              padding: "0"
            }} 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "20px 24px" }}>
              <div>
                <p className="eyebrow" style={{ color: "var(--muted)", margin: 0, fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>配置帮助指南 / Prompt Help</p>
                <h2 style={{ fontSize: "18px", color: "var(--ink)", fontWeight: 700, margin: "4px 0 0 0" }}>{activeHelp.title}</h2>
              </div>
              <button 
                className="icon-button" 
                type="button" 
                onClick={() => setActiveHelp(null)} 
                style={{ 
                  background: "transparent", 
                  border: "none", 
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted)"
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ padding: "24px" }}>
              {activeHelp.content}

              <div className="modal-actions" style={{ padding: "24px 0 0 0", borderTop: "none", display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="primary-button" style={{ width: "100%", height: "40px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }} onClick={() => setActiveHelp(null)}>我知道了</button>
              </div>
            </div>
          </section>
        </div>
      )}

    </main>
  );
}
