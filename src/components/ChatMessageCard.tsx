import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ChatMessage, Expert, SystemPromptsConfig } from "@/lib/types";
import { beautifyListFormatting, parseThinkingContent } from "@/lib/content-parser";
import { ThinkingBlock } from "./ThinkingBlock";
import "katex/dist/katex.min.css";

const SYSTEM_LOADERS = {
  "__WAKING__": {
    title: "正在唤醒外部智能体",
    subtitle: "正在载入历史对话上下文、附件并装载长记忆..."
  },
  "__COMPACTING__": {
    title: "正在整理会议上下文记忆",
    subtitle: "当前多轮对话超出模型窗口限制，正在网关执行有状态增量信息压缩..."
  },
  "__TIMEOUT__": {
    title: "智能体发言已超时",
    subtitle: "外部智能体响应已超出安全耗时阈值，系统已自动跳过该环节以保障会议流程连续性。",
    isError: true
  },
  "__ERROR__": {
    title: "智能体连接异常",
    subtitle: "本地中继网关已断开，或该智能体连接已离线。请检查外部智能体服务状态。",
    isError: true
  }
} as const;

function ensureString(val: any): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (typeof val === "string") {
    return val;
  }
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (item === null || item === undefined) {
          return "";
        }
        if (typeof item === "object") {
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join("\n");
  }
  if (typeof val === "object") {
    return JSON.stringify(val);
  }
  return String(val);
}

interface ResultCardField {
  label: string;
  key: string;
  labelColor?: string;
}

interface StructuredResultCardProps {
  data: any;
  isLoading: boolean;
  themeColor: string;
  loadingText: string;
  bgStyle?: React.CSSProperties;
  fields: ResultCardField[];
}

const StructuredResultCard: React.FC<StructuredResultCardProps> = ({
  data,
  isLoading,
  themeColor,
  loadingText,
  bgStyle = {},
  fields
}) => {
  if (!data && !isLoading) return null;

  return (
    <div className="assistant-result" style={{ marginTop: "10px" }}>
      <div 
        className="result-card" 
        style={{ 
          borderLeft: `3px solid ${themeColor}`, 
          borderRadius: "8px",
          ...bgStyle
        }}
      >
        {data ? (
          <div className="result-grid">
            {fields.map((f, idx) => (
              <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                <strong style={{ flexShrink: 0, color: f.labelColor || "inherit" }}>
                  {f.label}：
                </strong>
                <div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                    rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                  >
                    {beautifyListFormatting(ensureString(data[f.key]))}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="thinking-loader" style={{ margin: "4px 0", fontSize: "13px" }}>
            <strong style={{ color: themeColor }}>AI 决策秘书</strong> {loadingText}
            <div className="dot-pulse" style={{ marginLeft: "6px" }}>
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ChatMessageCardProps {
  message: ChatMessage;
  isUser: boolean;
  isMod: boolean;
  isExp: boolean;
  activeMeetingId: string;
  isSessionActive: boolean;
  userProfile: { name: string; title: string };
  systemPrompts: SystemPromptsConfig | null;
  allExperts: Expert[];
  speakingExpertId: string | null;
  isSynthesisPending: boolean;
  activeTurnDuration?: number;
  // 编辑操作
  editingMessageId: string | null;
  editingContent: string;
  setEditingMessageId: (id: string | null) => void;
  setEditingContent: (content: string) => void;
  handleSubmitDiscussion: (
    e: any, 
    editParams?: { targetMeetingId: string; userQuestion: string; baseHistory: ChatMessage[]; baseSources: any[]; messageId?: string }
  ) => void;
}

const ChatMessageCard: React.FC<ChatMessageCardProps> = ({
  message,
  isUser,
  isMod,
  isExp,
  activeMeetingId,
  isSessionActive,
  userProfile,
  systemPrompts,
  allExperts,
  speakingExpertId,
  isSynthesisPending,
  activeTurnDuration,
  editingMessageId,
  editingContent,
  setEditingMessageId,
  setEditingContent,
  handleSubmitDiscussion,
}) => {
  const safeContent = message.content || "";
  const systemLoader = SYSTEM_LOADERS[safeContent as keyof typeof SYSTEM_LOADERS];

  let displayContent = safeContent.replace(/[\s\n>]*$/, '');
  if (systemLoader) {
    displayContent = "";
  }

  const { thinkingContent, displayContent: cleanedDisplayContent, isThinkingDone } = parseThinkingContent(displayContent);
  displayContent = cleanedDisplayContent;



  // 计算专家或者主持人首字就绪前的 Loading 状态
  const isExpertTTFB = isExp && speakingExpertId === message.senderId && safeContent.length === 0;
  const isStartingThink = isExp && speakingExpertId === message.senderId && safeContent.startsWith("<") && !thinkingContent;
  const isModTTFB = isMod && isSynthesisPending && safeContent.length === 0;

  const shouldShowStanceLoading = !!(
    isExp && 
    !message.expertStance && 
    displayContent.length > 0 && 
    safeContent !== "__TIMEOUT__" && 
    safeContent !== "__ERROR__" && 
    (
      speakingExpertId !== message.senderId || 
      message.isStanceExtracting
    )
  );

  const shouldShowModSummaryLoading = !!(
    isMod &&
    !message.moderatorSummary &&
    message.isStanceExtracting &&
    displayContent.length > 0 &&
    safeContent !== "__TIMEOUT__" &&
    safeContent !== "__ERROR__" &&
    message.senderName !== "系统提示" &&
    message.senderName !== "系统"
  );

  const formattedTime = React.useMemo(() => {
    if (!message.createdAt) return "";
    const date = new Date(message.createdAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }, [message.createdAt]);

  return (
    <article className={`chat-message ${message.role}`}>
      <div className="message-avatar">
        {isUser ? "你" : isMod ? "主持" : message.senderName.slice(0, 2)}
      </div>
      <div className="message-body" style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", width: "100%" }}>
        {(() => {
          if (editingMessageId === message.id) {
            return (
              <div className="edit-message-container" style={{ marginTop: "4px", width: "100%", display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                <textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  autoFocus
                  style={{
                    width: "100%", maxWidth: "600px", minHeight: "80px", padding: "12px", borderRadius: "12px",
                    border: "1px solid var(--line)", background: "var(--surface)",
                    fontSize: "14px", fontFamily: "inherit", resize: "vertical",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)", outline: "none"
                  }}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <button
                    onClick={() => setEditingMessageId(null)}
                    style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      setEditingMessageId(null);
                      handleSubmitDiscussion(undefined, {
                        targetMeetingId: activeMeetingId,
                        userQuestion: editingContent,
                        messageId: message.id,
                        baseHistory: [], // 大循环内部重新寻找 slice 历史，外层传入空数组做占位
                        baseSources: message.sources || []
                      });
                    }}
                    style={{ padding: "6px 14px", borderRadius: "6px", border: "none", background: "var(--ink)", color: "var(--surface)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                  >
                    保存并重新生成
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div className="message-hover-wrapper" style={{ 
              display: "flex", 
              alignItems: "flex-end", 
              justifyContent: isUser ? "flex-end" : "flex-start", 
              gap: "8px", 
              width: "100%" 
            }}>
              {isUser && !isSessionActive && displayContent && (
                <button
                  className="message-edit-btn"
                  onClick={() => {
                    setEditingMessageId(message.id);
                    setEditingContent(message.content);
                  }}
                  title="重新编辑"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
              )}

              <div style={{ 
                display: "flex", 
                flexDirection: "column", 
                width: "fit-content", 
                maxWidth: "100%", 
                alignItems: isUser ? "flex-end" : "flex-start"
              }}>
                {(isExp || isMod || isUser) && (
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between", 
                    gap: "16px", 
                    marginBottom: "6px",
                    width: "100%",
                    flexDirection: isUser ? "row-reverse" : "row"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ 
                        fontSize: "11px", 
                        color: "var(--muted)", 
                        marginTop: "2px",
                        flexShrink: 0
                      }}>
                        {(() => {
                          if (isUser) {
                            return <span>{userProfile.name} · {userProfile.title}</span>;
                          }
                          const isPseudoMod = isExp && (message.senderName === "主持人" || message.senderId === "moderator");
                          if (isMod || isPseudoMod) {
                            if (message.senderName === "系统提示" || message.senderName === "系统") {
                              return <span>{message.senderName}</span>;
                            }
                            const name = systemPrompts?.moderatorName || message.senderName || "主持人";
                            const title = systemPrompts?.moderatorTitle || message.senderTitle || "决策协调官";
                            return <span>{name} · {title}</span>;
                          }
                          if (isExp) {
                            const curExp = allExperts.find((e: any) => e.id === message.senderId);
                            const isExt = curExp?.isExternalAgent;
                            const name = curExp?.name || message.senderName;
                            const title = curExp?.title || message.senderTitle || "总监";
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center" }}>
                                {name} · {title}
                                {isExt && (
                                  <span style={{ 
                                    fontSize: "10px", 
                                    color: "var(--muted)", 
                                    padding: "1.5px 5px", 
                                    border: "1px solid var(--line)", 
                                    borderRadius: "4px", 
                                    fontWeight: "normal",
                                    display: "inline-block",
                                    marginLeft: "6px",
                                    lineHeight: 1
                                  }}>
                                    小龙虾
                                  </span>
                                )}
                              </span>
                            );
                          }
                          return <span>{message.senderName || ""}</span>;
                        })()}
                      </span>
                      
                      {!isUser && (
                        <ThinkingBlock 
                          thinkingContent={thinkingContent} 
                          isThinkingDone={isThinkingDone} 
                          textAlign="left" 
                          isPopover={true}
                        />
                      )}
                    </div>

                    {formattedTime && (
                      <div style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "6px",
                        fontSize: "11px",
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono, monospace)",
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.85,
                        userSelect: "none"
                      }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          {formattedTime}
                        </span>
                        {((typeof message.duration === "number" || typeof activeTurnDuration === "number") && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--amber)", fontWeight: 500 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ fill: "currentColor" }}>
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                            {typeof activeTurnDuration === "number" ? activeTurnDuration : message.duration}s
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ width: "100%" }}>
                  {systemLoader && (
                    <div 
                      className="thinking-card" 
                      style={{ 
                        borderStyle: "solid", 
                        borderColor: (systemLoader as any).isError ? "var(--red)" : "var(--amber)", 
                        borderRadius: "8px", 
                        background: (systemLoader as any).isError ? "var(--red-soft)" : "transparent", 
                        padding: "12px 14px", 
                        marginBottom: "8px" 
                      }}
                    >
                      <div className="thinking-loader" style={{ margin: 0 }}>
                        <strong style={{ color: (systemLoader as any).isError ? "var(--red)" : "var(--amber)" }}>
                          {message.senderName}
                        </strong>{" "}
                        <span style={{ color: (systemLoader as any).isError ? "var(--red)" : "inherit" }}>
                          {systemLoader.title}
                        </span>
                        {!(systemLoader as any).isError && (
                          <div className="dot-pulse" style={{ marginLeft: "6px" }}>
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                        {systemLoader.subtitle}
                      </div>
                    </div>
                  )}

                  {isModTTFB && (
                    <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
                      <div className="thinking-loader" style={{ margin: 0 }}>
                        <strong style={{ color: "var(--amber)" }}>决策协调官</strong> 正在汇总本轮会议纪要
                        <div className="dot-pulse" style={{ marginLeft: "6px" }}>
                          <span /><span /><span />
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px", display: "block" }}>
                        正在综合各个智能体的共识、分歧以及下一步建议动作...
                      </span>
                    </div>
                  )}

                  {(!isThinkingDone && (isExpertTTFB || isStartingThink || thinkingContent.length > 0)) && (
                    <div 
                      className="thinking-card" 
                      style={{ 
                        borderStyle: "solid", 
                        borderColor: "var(--amber)", 
                        borderRadius: "8px", 
                        padding: isExpertTTFB ? "12px 14px" : "0", 
                        background: "transparent", 
                        borderWidth: isExpertTTFB ? "1px" : "0",
                        marginBottom: "8px" 
                      }}
                    >
                      <div className="thinking-loader" style={{ margin: 0, opacity: isExpertTTFB ? 1 : 0.7 }}>
                        <strong>{isExpertTTFB ? message.senderName : ""}</strong>{" "}
                        <span>
                          {isExpertTTFB ? "正在构思发言论点..." : (isStartingThink ? "正在深度思考" : "正在思考中")}
                        </span>
                        <div className="dot-pulse" style={{ marginLeft: "6px" }}>
                          <span /><span /><span />
                        </div>
                      </div>
                      {isExpertTTFB && (
                        <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                          正在结合个人对抗强度与会议历史多轮对话上下文编排论点...
                        </div>
                      )}
                      {thinkingContent && !isExpertTTFB && (
                        <div style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", fontStyle: "italic", marginTop: "8px", paddingLeft: "12px", borderLeft: "2px solid var(--line)" }}>
                          {thinkingContent}
                        </div>
                      )}
                    </div>
                  )}

                  {displayContent && (
                    <div className="message-content markdown-body" style={{ fontSize: "14px", position: "relative", margin: 0, width: "100%" }}>
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                      >
                        {displayContent}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {message.sources && message.sources.length > 0 && (
          <div className="message-sources" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", justifyContent: isUser ? "flex-end" : "flex-start" }}>
            {message.sources.map((source) => (
              <div key={source.id} className="attachment-pill" style={{ background: "var(--surface)", border: "1px solid var(--line)", padding: "4px 8px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "10px", fontWeight: "bold", color: "var(--muted)", background: "var(--surface-strong)", padding: "2px 4px", borderRadius: "4px" }}>
                  {source.kind.toUpperCase()}
                </span>
                <span style={{ fontSize: "13px", color: "var(--ink)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name}</span>
              </div>
            ))}
          </div>
        )}

        <StructuredResultCard
          data={message.expertStance}
          isLoading={shouldShowStanceLoading}
          themeColor="var(--amber)"
          loadingText="正在提取并提炼专家立场摘要"
          bgStyle={{ background: "rgba(245, 158, 11, 0.02)" }}
          fields={[
            { label: "立场观点", key: "stance" },
            { label: "关键风险", key: "concern" },
            { label: "实施建议", key: "recommendation" },
            { label: "方案取舍", key: "tradeoff" }
          ]}
        />

        <StructuredResultCard
          data={message.moderatorSummary}
          isLoading={shouldShowModSummaryLoading}
          themeColor="var(--blue)"
          loadingText="正在提取并提炼会议总结与纪要卡片"
          bgStyle={{ background: "rgba(2, 132, 199, 0.03)" }}
          fields={[
            { label: "总结共识", key: "consensus", labelColor: "var(--blue)" },
            { label: "主要分歧", key: "disagreements", labelColor: "var(--blue)" },
            { label: "最终决策", key: "decisions", labelColor: "var(--blue)" },
            { label: "下一步行动", key: "nextActions", labelColor: "var(--blue)" }
          ]}
        />
      </div>
    </article>
  );
};

const areEqual = (prevProps: ChatMessageCardProps, nextProps: ChatMessageCardProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.isStanceExtracting === nextProps.message.isStanceExtracting &&
    prevProps.message.expertStance === nextProps.message.expertStance &&
    prevProps.message.moderatorSummary === nextProps.message.moderatorSummary &&
    prevProps.message.sources === nextProps.message.sources &&
    prevProps.message.duration === nextProps.message.duration &&
    prevProps.activeTurnDuration === nextProps.activeTurnDuration &&
    prevProps.isSessionActive === nextProps.isSessionActive &&
    prevProps.editingMessageId === nextProps.editingMessageId &&
    prevProps.editingContent === nextProps.editingContent &&
    prevProps.speakingExpertId === nextProps.speakingExpertId &&
    prevProps.isSynthesisPending === nextProps.isSynthesisPending
  );
};

export default React.memo(ChatMessageCard, areEqual);
