import { useState, useEffect } from "react";
import { Expert } from "@/lib/types";

interface ExpertModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: Partial<Expert>;
  onClose: () => void;
  onSave: (expert: Expert) => void;
  meetingContext?: { name: string; description?: string };
}

const InfoTooltip = ({ text }: { text: string }) => (
  <div className="info-tooltip-container" style={{ position: "relative", display: "inline-flex", marginLeft: "6px", verticalAlign: "middle", marginBottom: "2px" }}>
    <div style={{ cursor: "help", display: "flex", alignItems: "center", justifyContent: "center", width: "15px", height: "15px", borderRadius: "50%", border: "1px solid var(--line-strong)", background: "var(--surface-strong)", color: "var(--muted)", fontSize: "10px" }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </div>
    <div className="info-tooltip-text" style={{
      position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%) translateY(-8px)",
      background: "var(--ink)", color: "var(--surface)", padding: "6px 12px",
      borderRadius: "6px", fontSize: "12px", whiteSpace: "nowrap", fontWeight: "normal",
      opacity: 0, visibility: "hidden", transition: "all 0.2s ease", zIndex: 100, pointerEvents: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
    }}>
      {text}
      <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", border: "5px solid transparent", borderTopColor: "var(--ink)" }} />
    </div>
    <style dangerouslySetInnerHTML={{
      __html: `
      .info-tooltip-container:hover .info-tooltip-text { opacity: 1 !important; visibility: visible !important; transform: translateX(-50%) translateY(-4px) !important; }
    `}} />
  </div>
);

export function ExpertModal({ isOpen, mode, initialData, onClose, onSave, meetingContext }: ExpertModalProps) {
  const [draft, setDraft] = useState<Partial<Expert>>({});
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingExpert, setIsGeneratingExpert] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [testMsg, setTestMsg] = useState("");

  async function handleTestConnection() {
    if (!draft.botToken) return;
    setTestStatus("testing");
    setTestMsg("");
    try {
      const res = await fetch(`/api/discussions/test-bot?token=${encodeURIComponent(draft.botToken)}`);
      const data = await res.json();
      if (data.success && data.status === "online") {
        setTestStatus("success");
        setTestMsg("✓ 连接成功：外部智能体物理连接已建立，客户端已在线！");
      } else {
        setTestStatus("failed");
        setTestMsg(`✗ 连接失败：${data.error || "未检测到物理连接，请确认客户端是否启动"}`);
      }
    } catch (e: any) {
      setTestStatus("failed");
      setTestMsg(`✗ 请求异常：${e.message || "网络请求异常，请稍后重试"}`);
    }
  }

  async function handleGenerateExpert() {
    if (!draft.name && !draft.title) return;
    setIsGeneratingExpert(true);
    try {
      let activeEngine = undefined;
      const ENGINE_CONFIGS_KEY = "agent-council-engine-configs";
      let settingsStr = localStorage.getItem(ENGINE_CONFIGS_KEY);
      if (!settingsStr) {
        settingsStr = localStorage.getItem("design-council-engine-configs");
        if (settingsStr) {
          try {
            localStorage.setItem(ENGINE_CONFIGS_KEY, settingsStr);
            localStorage.removeItem("design-council-engine-configs");
          } catch (e) {}
        }
      }
      if (settingsStr) {
        try {
          const allConfigs = JSON.parse(settingsStr);
          const engineConfigs = Array.isArray(allConfigs) ? allConfigs.filter((c: any) => (c.tenantId || "default-org") === "default-org") : [];
          activeEngine = engineConfigs.find((c: any) => c.isActive) || engineConfigs[0];
        } catch (e) { }
      }

      let systemPrompts = undefined;
      const SYSTEM_PROMPTS_KEY = "agent-council-system-prompts";
      let promptsStr = localStorage.getItem(SYSTEM_PROMPTS_KEY);
      if (!promptsStr) {
        promptsStr = localStorage.getItem("design-council-system-prompts");
        if (promptsStr) {
          try {
            localStorage.setItem(SYSTEM_PROMPTS_KEY, promptsStr);
            localStorage.removeItem("design-council-system-prompts");
          } catch (e) {}
        }
      }
      if (promptsStr) {
        try {
          const allPrompts = JSON.parse(promptsStr);
          systemPrompts = allPrompts.find((c: any) => (c.tenantId || "default-org") === "default-org");
        } catch (e) { }
      }

      const res = await fetch("/api/discussions/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "expert_details",
          input: `${draft.name || ""} ${draft.title || ""}`.trim(),
          engineConfig: activeEngine,
          meetingContext,
          systemPrompts,
        }),
      });
      const data = await res.json();
      if (data.result) {
        const { lens, temperament, focus, systemPrompt } = data.result;
        setDraft(prev => ({
          ...prev,
          lens: lens || prev.lens,
          temperament: temperament || prev.temperament,
          focus: focus && Array.isArray(focus) ? focus : prev.focus,
          systemPrompt: systemPrompt || prev.systemPrompt
        }));
      } else if (data.error) {
        alert("AI 生成失败: " + data.error);
      }
    } catch (e) {
      console.error("Failed to generate expert details:", e);
      alert("AI 生成失败，可能网络连接异常。");
    } finally {
      setIsGeneratingExpert(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      setDraft({
        id: initialData?.id || "",
        name: initialData?.name || "",
        title: initialData?.title || "",
        lens: initialData?.lens || "",
        temperament: initialData?.temperament || "",
        systemPrompt: initialData?.systemPrompt || "",
        debateIntensity: initialData?.debateIntensity || 3,
        focus: initialData?.focus || [],
        isCustom: initialData?.isCustom ?? (initialData?.id ? false : true),
        isExternalAgent: initialData?.isExternalAgent ?? false,
        agentType: initialData?.agentType || "openclaw",
        botToken: initialData?.botToken || "",
        ragEnabled: initialData?.ragEnabled ?? false,
        ragEndpoint: initialData?.ragEndpoint || "",
        ragToken: initialData?.ragToken || "",
        ragDatasetId: initialData?.ragDatasetId || "",
      });
      setError(null);
    }
  }, [isOpen, initialData]);

  useEffect(() => {
    setTestStatus("idle");
    setTestMsg("");
  }, [draft.botToken]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.isExternalAgent) {
      if (!draft.name || !draft.title || !draft.botToken) {
        setError("请填写 Token 等必填项");
        return;
      }
    } else {
      if (!draft.name || !draft.title || !draft.lens || !draft.systemPrompt) {
        setError("请填写人设提示词等必填项");
        return;
      }
    }

    const finalExpert: Expert = {
      id: draft.id || `expert-${Date.now()}`,
      name: draft.name!,
      title: draft.title!,
      lens: draft.isExternalAgent ? "外部智能体" : (draft.lens || ""),
      temperament: draft.isExternalAgent ? "自主思考" : (draft.temperament || "中立冷静"),
      systemPrompt: draft.isExternalAgent ? "" : (draft.systemPrompt || ""),
      debateIntensity: draft.isExternalAgent ? 3 : (draft.debateIntensity || 3),
      focus: draft.isExternalAgent ? [] : (draft.focus || []),
      isCustom: draft.isCustom,
      isExternalAgent: draft.isExternalAgent,
      botToken: draft.isExternalAgent ? draft.botToken : undefined,
      ragEnabled: draft.isExternalAgent ? false : draft.ragEnabled,
      ragEndpoint: draft.isExternalAgent ? undefined : draft.ragEndpoint,
      ragToken: draft.isExternalAgent ? undefined : draft.ragToken,
      ragDatasetId: draft.isExternalAgent ? undefined : draft.ragDatasetId,
    };

    onSave(finalExpert);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card" style={{ width: "800px", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Expert Customization</p>
            <h2>{mode === "create" ? "新增组织级智能体" : "深度编辑智能体设定"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* 使用 Flex 布局使得按钮栏始终在底部固定，表单内容在中间滚动 */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", minHeight: "350px", maxHeight: "680px" }}>

          <div className="modal-form-content">

            {/* 是否作为外部智能体接入 */}
            <label className={`external-agent-toggle-card ${draft.isExternalAgent ? "is-checked" : ""}`}>
              <div className="toggle-switch-label-area">
                <span className="toggle-switch-title" style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>
                  接入外部智能体 (如 OpenClaw / QwenPaw / nanobot等) 
                  <InfoTooltip text="开启后，该智能体将由运行在您的独立智能体进程驱动，平台不再调用预置的大模型人设。" />
                </span>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center" }}>
                <input
                  type="checkbox"
                  className="switch-control-input"
                  checked={draft.isExternalAgent || false}
                  onChange={e => {
                    const checked = e.target.checked;
                    setDraft(prev => ({
                      ...prev,
                      isExternalAgent: checked,
                      agentType: prev.agentType || "openclaw",
                      botToken: checked && !prev.botToken ? `dc_bot_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}` : prev.botToken
                    }));
                  }}
                />
                <span className="switch-control-track">
                  <span className="switch-control-thumb" />
                </span>
              </div>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "16px" }}>
              <label className="compact-field">
                <span>智能体角色名称 *<InfoTooltip text="显示在会议列表中的名字" /></span>
                <input required placeholder="如：合规风险官" value={draft.name || ""} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="compact-field">
                <span>核心头衔标签 (Title) *<InfoTooltip text="该智能体代表的具体专业职能" /></span>
                <input required placeholder="如：首席安全架构师" value={draft.title || ""} onChange={e => setDraft({ ...draft, title: e.target.value })} />
              </label>
            </div>

            {draft.isExternalAgent ? (
              <div className="external-agent-config-panel" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label className="compact-field" style={{ marginBottom: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>小龙虾机器人 Token (Bot Token) *<InfoTooltip text="外部智能体插件连接到本平台时的认证 Token" /></span>
                  <div className="token-display-wrap" style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <input
                      readOnly
                      required
                      className="token-input-field"
                      style={{ flex: 1, fontFamily: "var(--mono)", fontSize: "12.5px" }}
                      value={draft.botToken || ""}
                    />
                    <button
                      type="button"
                      className={`tech-button ${copied ? "is-copied" : ""}`}
                      onClick={() => {
                        if (draft.botToken) {
                          navigator.clipboard.writeText(draft.botToken);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                    >
                      {copied ? "已复制 ✓" : "复制"}
                    </button>
                    <button
                      type="button"
                      className="tech-button"
                      onClick={() => {
                        setDraft(prev => ({
                          ...prev,
                          botToken: `dc_bot_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`
                        }));
                      }}
                    >
                      重新生成
                    </button>
                  </div>
                </label>
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: "8px", background: "var(--surface-strong)", border: "1px solid var(--line-strong)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span 
                        style={{ 
                          width: "8px", 
                          height: "8px", 
                          borderRadius: "50%", 
                          display: "inline-block",
                          background: testStatus === "success" ? "#10b981" : testStatus === "failed" ? "#ef4444" : "#9ca3af",
                          boxShadow: testStatus === "success" 
                            ? "0 0 8px #10b981" 
                            : testStatus === "failed" 
                              ? "0 0 8px #ef4444" 
                              : "none",
                          animation: testStatus === "testing" ? "online-pulse 1s infinite alternate" : "none"
                        }} 
                      />
                      <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--muted)" }}>
                        {testStatus === "testing" ? "正在检测链路..." : testStatus === "success" ? "已连接 (Online)" : testStatus === "failed" ? "已离线 (Offline)" : "未检测连通性"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="tech-button"
                      disabled={testStatus === "testing" || !draft.botToken}
                      onClick={handleTestConnection}
                      style={{ padding: "6px 16px", fontSize: "12.5px", background: "var(--surface-strong)", border: "1px solid var(--line-strong)" }}
                    >
                      {testStatus === "testing" ? "测试中..." : "测试连通性"}
                    </button>
                  </div>
                  {testMsg && (
                    <div style={{ 
                      fontSize: "12.5px", 
                      color: testStatus === "success" ? "#10b981" : "#ef4444", 
                      lineHeight: "1.4",
                      marginTop: "2px"
                    }}>
                      {testMsg}
                    </div>
                  )}
                </div>
                <p style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.5", marginTop: "8px" }}>
                  💡 <strong>配置方法</strong>：复制上方生成的 Bot Token。在本地 Python 客户端（QwenPaw）或者 DesignCouncil 频道的配置文件中，将 <code>botToken</code> 设置为该值，并将连接地址设置为 <code>ws://localhost:18788/bot</code>。
                </p>
              </div>
            ) : (
              <>
                <div className="ai-assist-complete-card">
                  <div className="ai-assist-text">
                    填写完上方基本信息后，可自动生成后续人设配置
                  </div>
                  <button
                    type="button"
                    className="btn-ai-complete"
                    onClick={handleGenerateExpert}
                    disabled={isGeneratingExpert || (!draft.name && !draft.title)}
                  >
                    <span>✨</span>
                    {isGeneratingExpert ? "正在生成..." : "AI 自动补全设定"}
                  </button>
                </div>

                {isGeneratingExpert && (
                  <div className="assistant-result" style={{ marginTop: "10px", marginBottom: "16px" }}>
                    <div className="result-card" style={{ borderLeft: "3px solid var(--amber)", borderRadius: "8px", background: "rgba(245, 158, 11, 0.02)" }}>
                      <div className="thinking-loader" style={{ margin: "4px 0", fontSize: "13px" }}>
                        <strong style={{ color: "var(--amber)" }}>AI 决策秘书</strong> 正在自动提炼并补全专家人设
                        <div className="dot-pulse" style={{ marginLeft: "6px" }}>
                          <span /><span /><span />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <label className="compact-field">
                  <span>通用专业审视视角 (Lens) *<InfoTooltip text="当面对不同会议议题时，该角色习惯从哪个专门的专业角度进行剖析？（例如：系统架构稳定性、终端用户使用旅程等，请使用通用且不局限于特定设计方案的表述）" /></span>
                  <input required placeholder="说明该智能体着重关注哪些点" value={draft.lens || ""} onChange={e => setDraft({ ...draft, lens: e.target.value })} disabled={isGeneratingExpert} />
                </label>

                <label className="compact-field">
                  <span>智能体性格脾气 (Temperament)<InfoTooltip text="控制专家的说话语气，比如严厉、温和、讽刺等" /></span>
                  <input placeholder="如：极其挑剔、强迫症、极其保守" value={draft.temperament || ""} onChange={e => setDraft({ ...draft, temperament: e.target.value })} disabled={isGeneratingExpert} />
                </label>

                <label className="compact-field">
                  <span>通用关注重点 (Focus)<InfoTooltip text="该角色看问题时最聚焦的几个核心维度，请用英文逗号分隔（例如：交付效能, 系统解耦, 开发成本等）" /></span>
                  <input
                    placeholder="如：转化率, 用户留存, 获客成本"
                    value={draft.focus?.join(", ") || ""}
                    onChange={e => setDraft({ ...draft, focus: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    disabled={isGeneratingExpert}
                  />
                </label>
                <label className="compact-field">
                  <span>底层人设提示词 (System Prompt) *<InfoTooltip text="大模型的底层价值观设定。请重点陈述该专家的核心利益偏好、价值观底线以及看问题的底层利益立场（作为 System Role 完整注入，请使用跨议题通用的表述）" /></span>
                  <textarea
                    required
                    placeholder="可以填入该智能体专属的完整 System Setting。"
                    value={draft.systemPrompt || ""}
                    onChange={e => setDraft({ ...draft, systemPrompt: e.target.value })}
                    disabled={isGeneratingExpert}
                    style={{ width: "100%", height: "120px", fontFamily: "monospace", resize: "vertical", fontSize: "13px", lineHeight: 1.5 }}
                  />
                </label>

                <label className="compact-field" style={{ marginBottom: "16px" }}>
                  <span>默认辩论激烈度：{draft.debateIntensity}<InfoTooltip text="1为温和赞同，5为猛烈抨击。此值将与会议全局强度取平均，决定该专家的最终表现" /></span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={draft.debateIntensity || 3}
                    onChange={(e) => setDraft({ ...draft, debateIntensity: Number(e.target.value) })}
                    disabled={isGeneratingExpert}
                    style={{ width: "100%", marginTop: "8px" }}
                  />
                </label>

                {/* 是否开启 RAG 检索 */}
                <label className={`external-agent-toggle-card ${draft.ragEnabled ? "is-checked" : ""}`} style={{ marginTop: "16px", marginBottom: "12px" }}>
                  <div className="toggle-switch-label-area">
                    <span className="toggle-switch-title" style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>
                      挂载外部 RAG 知识库检索
                      <InfoTooltip text="开启后，大模型在分析评审当前议题时会从配置的外部数据库中自动检索相关事实并结合评审。" />
                    </span>
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      className="switch-control-input"
                      checked={draft.ragEnabled || false}
                      onChange={e => {
                        setDraft(prev => ({
                          ...prev,
                          ragEnabled: e.target.checked
                        }));
                      }}
                    />
                    <span className="switch-control-track">
                      <span className="switch-control-thumb" />
                    </span>
                  </div>
                </label>

                {draft.ragEnabled && (
                  <div className="external-agent-config-panel" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", padding: "16px", marginTop: "4px", marginBottom: "16px", background: "var(--surface-strong)", border: "1px solid var(--line-strong)", borderRadius: "8px" }}>
                    <label className="compact-field" style={{ gridColumn: "span 2", marginBottom: 0 }}>
                      <span>RAG 知识库 API 端点地址 *<InfoTooltip text="接收 POST 请求并返回 JSON { chunks: string[] } 格式的检索端点" /></span>
                      <input
                        required
                        placeholder="如：https://api.dify.ai/v1/datasets/retrieval"
                        value={draft.ragEndpoint || ""}
                        onChange={e => setDraft(prev => ({ ...prev, ragEndpoint: e.target.value }))}
                      />
                    </label>
                    <label className="compact-field" style={{ marginBottom: 0 }}>
                      <span>鉴权 Token (Bearer Token)<InfoTooltip text="调用该 RAG 接口所必须的 Authorization 鉴权密钥" /></span>
                      <input
                        type="password"
                        placeholder="请输入鉴权密钥 (可选)"
                        value={draft.ragToken || ""}
                        onChange={e => setDraft(prev => ({ ...prev, ragToken: e.target.value }))}
                      />
                    </label>
                    <label className="compact-field" style={{ marginBottom: 0 }}>
                      <span>数据集/集合标识 ID (Dataset ID)<InfoTooltip text="特定匹配的目标检索知识库库集合 ID (可选)" /></span>
                      <input
                        placeholder="请输入目标数据集 ID (可选)"
                        value={draft.ragDatasetId || ""}
                        onChange={e => setDraft(prev => ({ ...prev, ragDatasetId: e.target.value }))}
                      />
                    </label>
                  </div>
                )}
              </>
            )}

            {error && <p style={{ color: "var(--red)", fontSize: "13px", marginTop: "12px" }}>{error}</p>}

          </div>

          <div className="modal-actions" style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
            <button type="button" className="ghost-button" onClick={onClose}>取消</button>
            <button type="submit" className="primary-button">保存智能体</button>
          </div>
        </form>
      </section>
    </div>
  );
}
