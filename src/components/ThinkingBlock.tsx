import React from "react";

interface ThinkingBlockProps {
  thinkingContent: string;
  isThinkingDone?: boolean;
  textAlign?: "left" | "right";
  style?: React.CSSProperties;
  isPopover?: boolean; // 新增：是否以绝对定位浮窗形式展开以保护父布局
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  thinkingContent,
  isThinkingDone = true,
  textAlign = "left",
  style = {},
  isPopover = false
}) => {
  if (!thinkingContent || !isThinkingDone) return null;

  const detailsStyle: React.CSSProperties = isPopover
    ? { position: "relative", display: "inline-block", ...style }
    : { flex: 1, textAlign, ...style };

  const contentStyle: React.CSSProperties = isPopover
    ? {
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        width: "max-content",
        maxWidth: "500px",
        minWidth: "280px",
        zIndex: 99,
        fontSize: "13px",
        color: "var(--muted)",
        whiteSpace: "pre-wrap",
        fontStyle: "italic",
        padding: "12px 16px",
        background: "var(--surface)",
        border: "1px solid var(--line-strong)",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        textAlign: "left",
        lineHeight: 1.6
      }
    : { 
        fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", 
        fontStyle: "italic", marginTop: "8px", padding: "10px 14px", 
        background: "rgba(0,0,0,0.02)", border: "1px dashed var(--line)", 
        borderRadius: "6px", textAlign: "left", lineHeight: 1.6,
        marginBottom: "12px"
      };

  return (
    <details style={detailsStyle}>
      <summary style={{ 
        fontSize: "11px", color: "var(--muted)", cursor: "pointer", userSelect: "none", 
        fontWeight: "500", display: "inline-block",
        background: "var(--surface-strong)", padding: "2px 8px", borderRadius: "999px",
        border: "1px solid var(--line)", outline: "none"
      }}>
        深度思考已折叠
      </summary>
      <div style={contentStyle}>
        {thinkingContent}
      </div>
    </details>
  );
};
