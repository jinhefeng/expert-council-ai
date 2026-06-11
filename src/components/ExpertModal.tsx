import { useState, useEffect } from "react";
import { Expert } from "@/lib/types";

interface ExpertModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: Partial<Expert>;
  onClose: () => void;
  onSave: (expert: Expert) => void;
}




const InfoTooltip = ({ text }: { text: string }) => (
  <div className="info-tooltip-container" style={{ position: "relative", display: "inline-flex", marginLeft: "6px", verticalAlign: "middle", marginBottom: "2px" }}>
    <div style={{ cursor: "help", display: "flex", alignItems: "center", justifyContent: "center", width: "14px", height: "14px", borderRadius: "50%", border: "1px solid var(--line)", background: "transparent", color: "var(--muted-light)", fontSize: "10px", fontWeight: "bold" }}>?</div>
    <div className="info-tooltip-text" style={{ 
      position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%) translateY(-8px)", 
      background: "var(--ink)", color: "var(--surface)", padding: "6px 12px", 
      borderRadius: "6px", fontSize: "12px", whiteSpace: "nowrap", fontWeight: "normal",
      opacity: 0, visibility: "hidden", transition: "all 0.2s ease", zIndex: 100, pointerEvents: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
    }}>
      {text}
      <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", border: "5px solid transparent", borderTopColor: "var(--ink)" }} />
    </div>
    <style dangerouslySetInnerHTML={{__html: `
      .info-tooltip-container:hover .info-tooltip-text { opacity: 1 !important; visibility: visible !important; transform: translateX(-50%) translateY(-4px) !important; }
    `}} />
  </div>
);

export function ExpertModal({ isOpen, mode, initialData, onClose, onSave }: ExpertModalProps) {
  const [draft, setDraft] = useState<Partial<Expert>>({});
  const [error, setError] = useState<string | null>(null);

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
        isCustom: initialData?.isCustom ?? true,
      });
      setError(null);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name || !draft.title || !draft.lens || !draft.systemPrompt) {
      setError("请填写带 * 的必填项");
      return;
    }
    
    const finalExpert: Expert = {
      id: draft.id || `expert-${Date.now()}`,
      name: draft.name,
      title: draft.title,
      lens: draft.lens,
      temperament: draft.temperament || "中立客栈",
      systemPrompt: draft.systemPrompt,
      debateIntensity: draft.debateIntensity || 3,
      focus: draft.focus || [],
      isCustom: draft.isCustom,
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
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 160px)" }}>
          
          <div style={{ padding: "0 24px", overflowY: "auto", flex: 1 }}>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            <label className="compact-field">
              <span>智能体角色名称 *<InfoTooltip text="显示在会议列表中的名字" /></span>
              <input required placeholder="如：合规风险官" value={draft.name || ""} onChange={e => setDraft({...draft, name: e.target.value})} />
            </label>
            <label className="compact-field">
              <span>核心头衔标签 (Title) *<InfoTooltip text="该智能体代表的具体专业职能" /></span>
              <input required placeholder="如：首席安全架构师" value={draft.title || ""} onChange={e => setDraft({...draft, title: e.target.value})} />
            </label>
          </div>

          <label className="compact-field">
            <span>审视该议题的专业视角 (Lens) *<InfoTooltip text="给大模型的强制要求：该专家必须从哪个专门的角度来评估会议议题？" /></span>
            <input required placeholder="说明该智能体着重关注哪些点" value={draft.lens || ""} onChange={e => setDraft({...draft, lens: e.target.value})} />
          </label>

          <label className="compact-field">
            <span>智能体性格脾气 (Temperament)<InfoTooltip text="控制专家的说话语气，比如严厉、温和、讽刺等" /></span>
            <input placeholder="如：极其挑剔、强迫症、极其保守" value={draft.temperament || ""} onChange={e => setDraft({...draft, temperament: e.target.value})} />
          </label>


          <label className="compact-field">
            <span>核心关注指标 (Focus)<InfoTooltip text="该智能体最关心的几个业务指标或评估维度，请用英文逗号分隔" /></span>
            <input 
              placeholder="如：转化率, 用户留存, 获客成本" 
              value={draft.focus?.join(", ") || ""} 
              onChange={e => setDraft({...draft, focus: e.target.value.split(",").map(s => s.trim()).filter(Boolean)})} 
            />
          </label>
          <label className="compact-field">
            <span>底层人设提示词 (System Prompt) *<InfoTooltip text="这部分将作为 System Role 完整注入大模型" /></span>
            <textarea 
              required 
              placeholder="可以填入该智能体专属的完整 System Setting。"
              value={draft.systemPrompt || ""} 
              onChange={e => setDraft({...draft, systemPrompt: e.target.value})} 
              style={{ width: "100%", height: "120px", fontFamily: "monospace", resize: "vertical", fontSize: "13px", lineHeight: 1.5 }}
            />
          </label>

          <label className="compact-field">
            <span>默认辩论激烈度：{draft.debateIntensity}<InfoTooltip text="1为温和赞同，5为猛烈抨击。此值将与会议全局强度取平均，决定该专家的最终表现" /></span>
            <input
              type="range"
              min="1"
              max="5"
              value={draft.debateIntensity || 3}
              onChange={(e) => setDraft({ ...draft, debateIntensity: Number(e.target.value) })}
            />
          </label>

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
