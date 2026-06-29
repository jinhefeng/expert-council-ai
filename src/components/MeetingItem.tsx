import React from "react";
import { Meeting } from "@/lib/types";

interface MeetingItemProps {
  meeting: Meeting;
  isActive: boolean;
  isArchived: boolean;
  handleSwitchMeeting: (id: string) => void;
  handleDeleteMeeting: (id: string, e: React.MouseEvent) => void;
}

const MeetingItem: React.FC<MeetingItemProps> = ({
  meeting,
  isActive,
  isArchived,
  handleSwitchMeeting,
  handleDeleteMeeting,
}) => {
  return (
    <div
      className={`meeting-item ${isActive ? "is-active" : ""} ${isArchived ? "is-archived" : ""}`}
      onClick={() => handleSwitchMeeting(meeting.id)}
    >
      <div className="meeting-item-info">
        <span className="meeting-item-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", width: "100%" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{meeting.name}</span>
          {isArchived && (
            <span className="meeting-item-archive-badge" style={{ flexShrink: 0 }}>已归档</span>
          )}
        </span>
        <span className="meeting-item-meta">
          {meeting.messages.length} 轮发言 · {meeting.expertIds.length} 专家
        </span>
      </div>
      <div className="meeting-item-actions">
        <button
          className="btn-delete"
          type="button"
          onClick={(e) => handleDeleteMeeting(meeting.id, e)}
          title="删除会议"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default React.memo(MeetingItem, (prev, next) => {
  return (
    prev.isActive === next.isActive &&
    prev.isArchived === next.isArchived &&
    prev.meeting.id === next.meeting.id &&
    prev.meeting.name === next.meeting.name &&
    prev.meeting.messages.length === next.meeting.messages.length &&
    prev.meeting.expertIds.length === next.meeting.expertIds.length
  );
});
