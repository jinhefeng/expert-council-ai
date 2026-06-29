import React from "react";
import { Expert, Meeting, LLMEngineConfig } from "@/lib/types";

interface ExpertCardProps {
  expert: Expert;
  isSelected: boolean;
  isSpeaking: boolean;
  isControlsDisabled: boolean;
  expertActivationTimestamps: Record<string, number>;
  setExpertActivationTimestamps: (val: Record<string, number>) => void;
  updateActiveMeeting: (data: Partial<Meeting>) => Promise<void>;
  activeMeeting: Meeting | undefined;
  botStatus: string | undefined;
  meetings: Meeting[];
  setMeetings: (val: Meeting[] | ((prev: Meeting[]) => Meeting[])) => void;
  setCustomExperts: React.Dispatch<React.SetStateAction<Expert[]>>;
  storage: any;
  tenantId: string;
  engineConfigs: LLMEngineConfig[];
  discussingMeetings: Record<string, boolean>;
  activeMeetingId: string;
  handleCallExpertDirectly: (expert: Expert) => void;
  toggleExpertSelection?: (expertId: string) => void;
  openEditCustomModal: (expert: Expert) => void;
  setDeleteCandidate: (expert: Expert) => void;
}

const ExpertCard: React.FC<ExpertCardProps> = ({
  expert,
  isSelected,
  isSpeaking,
  isControlsDisabled,
  expertActivationTimestamps,
  setExpertActivationTimestamps,
  updateActiveMeeting,
  activeMeeting,
  botStatus,
  meetings,
  setMeetings,
  setCustomExperts,
  storage,
  tenantId,
  engineConfigs,
  discussingMeetings,
  activeMeetingId,
  handleCallExpertDirectly,
  toggleExpertSelection,
  openEditCustomModal,
  setDeleteCandidate,
}) => {
  const isOnline = botStatus === "online";
  const matchedEngine = !expert.isExternalAgent && expert.modelMode === "custom" && expert.modelId
    ? engineConfigs.find(c => c.id === expert.modelId)
    : null;
  const modelName = matchedEngine ? matchedEngine.name : "未知模型 (已删除)";

  return (
    <div
      className={`role-card ${isSelected ? "is-selected" : ""} ${isSpeaking ? "is-speaking" : ""} ${expert.isExternalAgent ? "is-external-agent" : ""} ${isControlsDisabled ? "is-disabled" : ""}`}
      style={{ opacity: isControlsDisabled ? 0.6 : 1, transition: "opacity 0.2s" }}
    >
      <div className="role-toggle">
        <div 
          className="role-topline" 
          style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer" }}
          onClick={() => {
            if (isControlsDisabled) return;
            if (!activeMeeting) return;

            if (toggleExpertSelection) {
              toggleExpertSelection(expert.id);
              if (!isSelected) {
                const newDict = { ...expertActivationTimestamps, [expert.id]: Date.now() };
                setExpertActivationTimestamps(newDict);
                localStorage.setItem("DC_expert_activations", JSON.stringify(newDict));
              }
              return;
            }

            const ids = isSelected
              ? activeMeeting.expertIds.filter(id => id !== expert.id)
              : [...activeMeeting.expertIds, expert.id];
              
            if (!isSelected) {
              const newDict = { ...expertActivationTimestamps, [expert.id]: Date.now() };
              setExpertActivationTimestamps(newDict);
              localStorage.setItem("DC_expert_activations", JSON.stringify(newDict));
            }
            
            void updateActiveMeeting({ expertIds: ids });
          }}
        >
          <div style={{ flex: 1 }}>
            <p className="role-name" style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              {expert.name}
              {expert.isExternalAgent && (
                <span style={{ fontSize: "10px", color: "var(--muted)", padding: "1.5px 5px", border: "1px solid var(--line)", borderRadius: "4px", fontWeight: "normal" }}>
                  小龙虾
                </span>
              )}
              {!expert.isExternalAgent && (
                <span className={`intensity-badge lvl-${expert.debateIntensity}`}>
                  Lvl {expert.debateIntensity} 对抗
                </span>
              )}
              {expert.isExternalAgent && (
                <span 
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "10px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontWeight: 600,
                    background: isOnline ? "rgba(40,167,69,0.12)" : "rgba(220,53,69,0.12)",
                    color: isOnline ? "#28a745" : "#dc3545",
                    border: isOnline ? "1px solid rgba(40,167,69,0.25)" : "1px solid rgba(220,53,69,0.25)"
                  }}
                >
                  <span 
                    className={isOnline ? "online-dot-pulse" : ""}
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: isOnline ? "#28a745" : "#dc3545"
                    }} 
                  />
                  {isOnline ? "在线" : "离线"}
                </span>
              )}
            </p>
            <p className="role-title">{expert.title}</p>
          </div>
          
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span
              className={`checkmark ${isSelected ? "is-active" : ""}`}
              aria-hidden="true"
            />
          </div>
        </div>
        <p className="role-lens">{expert.lens}</p>
        
        <div style={{ marginTop: "8px", borderTop: "1px dashed var(--line)", paddingTop: "6px" }}>
          <label className="intensity-selector">
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>辩论强度</span>
            <input
              type="range"
              min="1"
              max="5"
              value={expert.debateIntensity}
              disabled={isControlsDisabled}
              style={{ cursor: isControlsDisabled ? "not-allowed" : "auto" }}
              onChange={async (e) => {
                const val = Number(e.target.value);
                if (expert.isCustom) {
                  const updated = { ...expert, debateIntensity: val };
                  setCustomExperts(prev => prev.map(ex => ex.id === expert.id ? updated : ex));
                  await storage.saveCustomExpert(tenantId, updated);
                } else {
                  expert.debateIntensity = val;
                  setMeetings([...meetings]);
                }
              }}
            />
            <span>{expert.debateIntensity}</span>
          </label>
          {!expert.isExternalAgent && expert.modelMode === "custom" && expert.modelId && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", fontSize: "11px" }}>
              <span style={{ color: "var(--muted)" }}>模型引擎</span>
              <span style={{ 
                fontWeight: 500, 
                color: "var(--amber)",
                background: "rgba(245, 158, 11, 0.05)",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--amber-soft)",
                fontSize: "10px",
                lineHeight: 1
              }}>
                {modelName}
              </span>
            </div>
          )}
        </div>

        {/* 主持人点名模式 */}
        {activeMeeting?.turnOrderMode === "manual" && isSelected && !discussingMeetings[activeMeetingId] && (
          <button
            className="btn-small-action active"
            type="button"
            style={{ width: "100%", marginTop: "8px" }}
            onClick={() => handleCallExpertDirectly(expert)}
          >
            点名发言 👉
          </button>
        )}
        {isSpeaking && (
          <div className="speaking-indicator" style={{ marginTop: "6px" }}>
            <span>● Speaking...</span>
          </div>
        )}
      </div>
      
      {expert.isCustom && expert.meetingId && (
        <div style={{ position: "absolute", right: "12px", top: "42px", display: "flex", gap: "8px" }}>
          <button
            className="text-button"
            type="button"
            onClick={() => !isControlsDisabled && openEditCustomModal(expert)}
            disabled={isControlsDisabled}
            style={{ 
              color: isControlsDisabled ? "var(--muted)" : "var(--amber)", 
              cursor: isControlsDisabled ? "not-allowed" : "pointer",
              opacity: isControlsDisabled ? 0.5 : 1
            }}
          >
            编辑
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => !isControlsDisabled && setDeleteCandidate(expert)}
            disabled={isControlsDisabled}
            style={{ 
              color: isControlsDisabled ? "var(--muted)" : "inherit", 
              cursor: isControlsDisabled ? "not-allowed" : "pointer",
              opacity: isControlsDisabled ? 0.5 : 1
            }}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(ExpertCard, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.isSpeaking === next.isSpeaking &&
    prev.isControlsDisabled === next.isControlsDisabled &&
    prev.botStatus === next.botStatus &&
    prev.expert.debateIntensity === next.expert.debateIntensity &&
    prev.expert.name === next.expert.name &&
    prev.expert.title === next.expert.title &&
    prev.expert.lens === next.expert.lens &&
    prev.expert.modelId === next.expert.modelId &&
    prev.expert.modelMode === next.expert.modelMode &&
    prev.activeMeetingId === next.activeMeetingId &&
    prev.discussingMeetings[prev.activeMeetingId] === next.discussingMeetings[next.activeMeetingId] &&
    prev.activeMeeting?.turnOrderMode === next.activeMeeting?.turnOrderMode
  );
});
