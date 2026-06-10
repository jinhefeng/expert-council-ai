"use client";

import { useEffect, useMemo, useState } from "react";
import { LocalStorageService } from "@/lib/storage-service";
import { Expert, LLMEngineConfig } from "@/lib/types";
import { experts as defaultExperts, mergeSystemExperts } from "@/lib/experts";

const TENANT_ID = "default-org";

export default function AdminPage() {
  const storage = useMemo(() => new LocalStorageService(), []);

  // 状态
  const [engineConfigs, setEngineConfigs] = useState<LLMEngineConfig[]>([]);
  const [systemOverrides, setSystemOverrides] = useState<Partial<Expert>[]>([]);
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [engineDraft, setEngineDraft] = useState<LLMEngineConfig>({
    id: "",
    name: "",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o",
    isActive: false,
  });

  useEffect(() => {
    async function load() {
      setEngineConfigs(await storage.getEngineConfigs(TENANT_ID));
      setSystemOverrides(await storage.getSystemExpertsOverrides(TENANT_ID));
      setCustomExperts(await storage.getCustomExperts(TENANT_ID));
    }
    void load();
  }, [storage]);

  // 计算合并后的系统专家
  const systemExperts = useMemo(() => mergeSystemExperts(defaultExperts, systemOverrides), [systemOverrides]);

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

  async function handleDeleteEngine(id: string) {
    if (!window.confirm("确定删除该模型配置吗？")) return;
    const nextConfigs = engineConfigs.filter(c => c.id !== id);
    setEngineConfigs(nextConfigs);
    await storage.saveEngineConfigs(TENANT_ID, nextConfigs);
  }

  function handleExportEngineConfigs() {
    if (engineConfigs.length === 0) {
      alert("没有可导出的自定义模型配置。");
      return;
    }
    const exportData = JSON.stringify(engineConfigs, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportData).then(() => {
        alert("模型配置已成功复制到剪贴板！");
      }).catch(() => {
        window.prompt("请复制以下配置文本：", exportData);
      });
    } else {
      window.prompt("请复制以下配置文本：", exportData);
    }
  }

  async function handleImportEngineConfigs() {
    const importData = window.prompt("请粘贴包含引擎配置的 JSON 文本：");
    if (!importData?.trim()) return;
    try {
      const parsed = JSON.parse(importData);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      let newConfigs = [...engineConfigs];
      let importedCount = 0;
      for (const item of arr) {
        if (item.id && item.name && item.provider && item.baseUrl && item.apiKey && item.model) {
          const existingIdx = newConfigs.findIndex(c => c.id === item.id);
          if (existingIdx >= 0) {
            newConfigs[existingIdx] = { ...newConfigs[existingIdx], ...item };
          } else {
            newConfigs.push(item as LLMEngineConfig);
          }
          importedCount++;
        }
      }
      if (importedCount > 0) {
        setEngineConfigs(newConfigs);
        await storage.saveEngineConfigs(TENANT_ID, newConfigs);
        alert(`成功导入 ${importedCount} 个引擎配置！`);
      } else {
        alert("导入失败：未找到合法的引擎配置格式。");
      }
    } catch (e) {
      alert("导入失败：JSON 格式不正确。");
    }
  }

  // --- 系统专家管理 ---
  async function handleRestoreSystemExpert(id: string) {
    if (!window.confirm("确定要恢复该专家的默认配置吗？")) return;
    const nextOverrides = systemOverrides.filter(o => o.id !== id);
    setSystemOverrides(nextOverrides);
    await storage.saveSystemExpertsOverrides(TENANT_ID, nextOverrides);
  }

  async function handleEditSystemExpert(expert: Expert) {
    const newName = window.prompt("修改专家名称:", expert.name);
    if (!newName) return;
    
    let nextOverrides = [...systemOverrides];
    const existingIdx = nextOverrides.findIndex(o => o.id === expert.id);
    if (existingIdx >= 0) {
      nextOverrides[existingIdx] = { ...nextOverrides[existingIdx], name: newName };
    } else {
      nextOverrides.push({ id: expert.id, name: newName });
    }
    
    setSystemOverrides(nextOverrides);
    await storage.saveSystemExpertsOverrides(TENANT_ID, nextOverrides);
  }

  return (
    <main className="app-shell" style={{ overflow: "auto", padding: "20px" }}>
      <header className="app-header" style={{ marginBottom: "20px", borderRadius: "8px" }}>
        <div className="header-inner">
          <div className="brand-header">
            <div className="brand-mark">EC</div>
            <div>
              <p className="eyebrow">Expert Council AI</p>
              <h1>智能体圆桌会议中心后台</h1>
            </div>
          </div>
          <div className="status-group">
            <a href="/" className="secondary-button" style={{ padding: "4px 12px", textDecoration: "none" }}>← 返回会议室</a>
          </div>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", maxWidth: "1200px", margin: "0 auto" }}>
        
        {/* 大模型管理 */}
        <section className="panel" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "16px", borderBottom: "1px solid var(--line)", paddingBottom: "8px" }}>
            组织大模型配置
          </h2>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button className="secondary-button" onClick={() => {
              setEngineDraft({
                id: "", name: "", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o", isActive: false
              });
              setIsEngineModalOpen(true);
            }}>+ 新建大模型服务</button>
            <button className="ghost-button" onClick={handleExportEngineConfigs}>导出配置</button>
            <button className="ghost-button" onClick={handleImportEngineConfigs}>导入配置</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {engineConfigs.map(config => (
              <div key={config.id} className="moderator-card" style={{ position: "relative" }}>
                <p>{config.name}</p>
                <span>{config.model} · {config.baseUrl}</span>
                <div style={{ position: "absolute", right: "12px", top: "12px", display: "flex", gap: "8px" }}>
                  <button className="text-button" onClick={() => { setEngineDraft(config); setIsEngineModalOpen(true); }}>编辑</button>
                  <button className="text-button" onClick={() => handleDeleteEngine(config.id)}>删除</button>
                </div>
              </div>
            ))}
            {engineConfigs.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "13px" }}>暂无自定义大模型配置，系统将默认使用环境变量。</p>
            )}
          </div>
        </section>

        {/* 专家管理 */}
        <section className="panel" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "16px", borderBottom: "1px solid var(--line)", paddingBottom: "8px" }}>
            系统内置专家管理
          </h2>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>
            （由于时间关系，此处仅提供快速修改名称的演示。实际项目中可扩展为弹窗表单编辑所有 prompt 等参数）
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {systemExperts.map(expert => {
              const isOverridden = systemOverrides.some(o => o.id === expert.id);
              return (
                <div key={expert.id} className="role-card" style={{ cursor: "default" }}>
                  <div className="role-topline">
                    <div>
                      <p className="role-name">{expert.name} {isOverridden && <span style={{fontSize:"11px", color:"var(--amber)"}}>(已覆盖)</span>}</p>
                      <p className="role-title">{expert.title}</p>
                    </div>
                  </div>
                  <p className="role-lens">{expert.lens}</p>
                  <div style={{ marginTop: "12px", display: "flex", gap: "12px" }}>
                    <button className="secondary-button" style={{ fontSize: "12px", padding: "2px 8px" }} onClick={() => handleEditSystemExpert(expert)}>快速改名</button>
                    {isOverridden && (
                      <button className="text-button" style={{ fontSize: "12px" }} onClick={() => handleRestoreSystemExpert(expert.id)}>恢复默认</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </div>

      {isEngineModalOpen && (
        <div className="modal-overlay" onClick={() => setIsEngineModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{engineDraft.id ? "编辑大模型服务" : "新增大模型服务"}</h3>
              <button className="close-btn" onClick={() => setIsEngineModalOpen(false)}>×</button>
            </div>
            <form className="modal-body" onSubmit={handleSaveEngine}>
              <label className="form-field">
                <span>配置名称 (例如: 公司内部 GPT-4)</span>
                <input required value={engineDraft.name} onChange={e => setEngineDraft({...engineDraft, name: e.target.value})} />
              </label>
              <label className="form-field">
                <span>Base URL</span>
                <input required value={engineDraft.baseUrl} onChange={e => setEngineDraft({...engineDraft, baseUrl: e.target.value})} />
              </label>
              <label className="form-field">
                <span>API Key</span>
                <input required type="password" value={engineDraft.apiKey} onChange={e => setEngineDraft({...engineDraft, apiKey: e.target.value})} />
              </label>
              <label className="form-field">
                <span>Model (例如: gpt-4o, qwen-max)</span>
                <input required value={engineDraft.model} onChange={e => setEngineDraft({...engineDraft, model: e.target.value})} />
              </label>
              <div className="modal-footer">
                <button type="button" className="ghost-button" onClick={() => setIsEngineModalOpen(false)}>取消</button>
                <button type="submit" className="primary-button">保存配置</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
