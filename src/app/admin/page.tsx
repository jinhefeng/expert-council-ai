"use client";

import { useEffect, useMemo, useState } from "react";
import { LocalStorageService } from "@/lib/storage-service";
import { Expert, LLMEngineConfig, UserProfile } from "@/lib/types";
import { experts as defaultExperts, mergeSystemExperts } from "@/lib/experts";
import { ExpertModal } from "@/components/ExpertModal";

const TENANT_ID = "default-org";

export default function AdminPage() {
  const storage = useMemo(() => new LocalStorageService(), []);

  // 状态
  const [engineConfigs, setEngineConfigs] = useState<LLMEngineConfig[]>([]);
  const [systemOverrides, setSystemOverrides] = useState<Partial<Expert>[]>([]);
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: "产品经理", title: "需求提出人" });
  
  // 大模型表单 Modal
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [engineDraft, setEngineDraft] = useState<LLMEngineConfig>({
    id: "", name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o", isActive: false,
  });

  // 单模型导入 Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");

  // 专家编辑 Modal
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false);
  const [expertModalMode, setExpertModalMode] = useState<"create" | "edit">("create");
  const [expertDraft, setExpertDraft] = useState<Partial<Expert>>({});

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
    }
    void load();
  }, [storage]);

  // 计算合并后的系统专家
  const systemExperts = useMemo(() => mergeSystemExperts(defaultExperts, systemOverrides), [systemOverrides]);

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
    <main className="app-shell" style={{ overflow: "auto" }}>
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
            <a href="/" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              ← 返回主会场
            </a>
          </div>
        </div>
      </header>

      <div className="workspace" style={{ display: "block", maxWidth: "860px", margin: "40px auto", paddingBottom: "100px", background: "transparent", border: "none", height: "auto", overflow: "visible" }}>
        
        {/* 用户档案管理 */}
        <section className="panel" style={{ marginBottom: "32px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>当前用户档案</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置您的称呼与头衔，这将会显示在您的提问气泡上方。</p>
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

        {/* 大模型管理 */}
        <section className="panel" style={{ marginBottom: "32px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>组织大模型配置</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>配置和管理可供全组织调用的底层推理大模型 API。</p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button className="ghost-button" onClick={() => { setImportDraft(""); setIsImportModalOpen(true); }}>导入单模型</button>
              <button className="primary-button" type="button" onClick={() => {
                setEngineDraft({ id: "", name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o", isActive: false });
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
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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

        {/* 组织专家库管理 */}
        <section className="panel" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--line)", paddingBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>组织级专家库</h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                统一管理全组织的智能体阵容。您可以对内置专家进行深度重塑与隐藏，或创建全新的专属业务专家。
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button className="primary-button" type="button" onClick={openCreateExpert}>
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
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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

    </main>
  );
}
