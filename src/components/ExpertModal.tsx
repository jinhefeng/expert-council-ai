import { useState, useEffect } from "react";
import { Expert } from "@/lib/types";

interface ExpertModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: Partial<Expert>;
  onClose: () => void;
  onSave: (expert: Expert) => void;
}

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
              <span>智能体角色名称 *</span>
              <input required placeholder="如：合规风险官" value={draft.name || ""} onChange={e => setDraft({...draft, name: e.target.value})} />
            </label>
            <label className="compact-field">
              <span>核心头衔标签 (Title) *</span>
              <input required placeholder="如：首席安全架构师" value={draft.title || ""} onChange={e => setDraft({...draft, title: e.target.value})} />
            </label>
          </div>

          <label className="compact-field">
            <span>审视该议题的专业视角 (Lens) *</span>
            <input required placeholder="说明该智能体着重关注哪些点" value={draft.lens || ""} onChange={e => setDraft({...draft, lens: e.target.value})} />
          </label>

          <label className="compact-field">
            <span>智能体性格脾气 (Temperament)</span>
            <input placeholder="如：极其挑剔、强迫症、极其保守" value={draft.temperament || ""} onChange={e => setDraft({...draft, temperament: e.target.value})} />
          </label>

          <label className="compact-field">
            <span>底层人设提示词 (System Prompt) *</span>
            <textarea 
              required 
              placeholder="可以填入该智能体专属的完整 System Setting。"
              value={draft.systemPrompt || ""} 
              onChange={e => setDraft({...draft, systemPrompt: e.target.value})} 
              style={{ width: "100%", height: "120px", fontFamily: "monospace", resize: "vertical", fontSize: "13px", lineHeight: 1.5 }}
            />
          </label>

          <label className="compact-field">
            <span>默认辩论激烈度：{draft.debateIntensity}</span>
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
