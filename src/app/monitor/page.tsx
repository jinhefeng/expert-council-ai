"use client";

import { useEffect, useState } from "react";
import { PromptLogEntry } from "@/lib/prompt-log-service";

export default function MonitorPage() {
  const [logs, setLogs] = useState<PromptLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<PromptLogEntry | null>(null);
  const [filterType, setFilterType] = useState<"all" | "api_sync" | "api_stream" | "external_bot">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"simple" | "raw">("simple");

  const fetchLogs = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/prompt-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        
        // 自动选中首条
        if (data.length > 0 && !selectedLog) {
          setSelectedLog(data[0]);
        } else if (selectedLog) {
          const updated = data.find((l: any) => l.id === selectedLog.id);
          if (updated) setSelectedLog(updated);
        }
      }
    } catch (e) {
      console.error("Failed to load prompt logs:", e);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs(true);
  }, []);

  useEffect(() => {
    let timer: any;
    if (autoRefresh) {
      timer = setInterval(() => {
        void fetchLogs(false);
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoRefresh, selectedLog]);

  const handleClear = async () => {
    if (confirm("确定要清空所有的提示词日志记录吗？")) {
      try {
        const res = await fetch("/api/prompt-logs", { method: "DELETE" });
        if (res.ok) {
          setLogs([]);
          setSelectedLog(null);
        }
      } catch (e) {
        console.error("Failed to clear logs:", e);
      }
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert("已成功复制到剪贴板！");
      }).catch(() => {
        alert("复制失败，请检查浏览器权限。");
      });
    } else {
      alert("您的浏览器不支持一键复制功能。");
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filterType === "all") return true;
    return log.type === filterType;
  });

  const getLogTypeLabel = (type: string) => {
    switch (type) {
      case "api_sync": return { text: "API 同步", bg: "rgba(16, 185, 129, 0.08)", color: "var(--green)", border: "var(--green-soft)" };
      case "api_stream": return { text: "API 流式", bg: "rgba(59, 130, 246, 0.08)", color: "var(--blue)", border: "var(--blue-soft)" };
      case "external_bot": return { text: "外部专家", bg: "rgba(245, 158, 11, 0.08)", color: "var(--amber)", border: "var(--amber-soft)" };
      default: return { text: "未知", bg: "var(--surface-subtle)", color: "var(--muted)", border: "var(--line)" };
    }
  };

  return (
    <main className="app-shell" style={{ display: "block", height: "100vh", overflowY: "auto" }}>
      <header className="app-header" style={{ borderBottom: "1px solid var(--line)", background: "rgba(255, 255, 255, 0.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" style={{ background: "linear-gradient(135deg, var(--amber), #cc8a00)" }} aria-hidden="true">PM</div>
            <div>
              <p className="eyebrow">Expert Council AI - Prompt Monitor</p>
              <h1>提示词拼接与接口请求监控台</h1>
            </div>
          </div>
          <div className="status-group" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--ink-soft)", cursor: "pointer", userSelect: "none" }}>
              <input 
                type="checkbox" 
                checked={autoRefresh} 
                onChange={e => setAutoRefresh(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              自动刷新 (2s)
            </label>
            <button 
              className="ghost-button" 
              style={{ display: "inline-flex", alignItems: "center", minHeight: "32px", padding: "0 12px", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}
              onClick={() => void fetchLogs(true)}
              disabled={loading}
            >
              {loading ? "刷新中..." : "手动刷新"}
            </button>
            <button 
              className="ghost-button" 
              style={{ display: "inline-flex", alignItems: "center", minHeight: "32px", padding: "0 12px", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--red-soft)", color: "var(--red)", background: "rgba(239, 68, 68, 0.04)" }}
              onClick={handleClear}
            >
              清空日志
            </button>
            <a href="/admin" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "32px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              后台管理
            </a>
            <a href="/" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "32px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              ← 主会场
            </a>
          </div>
        </div>
      </header>

      <div className="workspace" style={{ display: "flex", gap: "24px", maxWidth: "1600px", margin: "24px auto", padding: "0 24px 60px 24px", height: "calc(100vh - 120px)", alignItems: "stretch", overflow: "hidden" }}>
        
        {/* 左侧：日志列表 */}
        <div style={{ width: "420px", display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, flexShrink: 0 }}>
          <div className="panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", background: "rgba(255, 255, 255, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>请求流水线 ({filteredLogs.length} 条)</span>
              <select 
                value={filterType} 
                onChange={e => setFilterType(e.target.value as any)}
                style={{ fontSize: "12px", padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", outline: "none", cursor: "pointer", color: "var(--ink-soft)" }}
              >
                <option value="all">显示全部类型</option>
                <option value="api_sync">API 同步请求</option>
                <option value="api_stream">API 流式请求</option>
                <option value="external_bot">外部专家请求</option>
              </select>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
            {filteredLogs.map(log => {
              const isSelected = selectedLog?.id === log.id;
              const label = getLogTypeLabel(log.type);
              const timeStr = new Date(log.timestamp).toLocaleTimeString();
              
              return (
                <div 
                  key={log.id} 
                  className="role-card" 
                  onClick={() => setSelectedLog(log)}
                  style={{ 
                    cursor: "pointer", 
                    border: isSelected ? "1px solid var(--amber)" : "1px solid var(--line)", 
                    background: isSelected ? "var(--amber-soft)" : "rgba(255, 255, 255, 0.45)",
                    transition: "all 0.2s ease",
                    padding: "16px",
                    borderRadius: "10px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span 
                      className="admin-badge-pill" 
                      style={{ 
                        background: label.bg, 
                        color: label.color, 
                        borderColor: label.border, 
                        fontSize: "11px", 
                        padding: "2px 6px",
                        letterSpacing: "0.5px"
                      }}
                    >
                      {label.text}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>{timeStr}</span>
                  </div>
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>{log.target}</h4>
                  <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.type === "external_bot" ? "下发载荷至小龙虾" : `模型: ${log.modelOrToken || "未指定"}`}
                  </p>
                </div>
              );
            })}

            {filteredLogs.length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: "13px", background: "rgba(255,255,255,0.3)", borderRadius: "8px", border: "1px dashed var(--line)" }}>
                暂无对应类型的提示词请求日志。
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情分析 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedLog ? (
            <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px", background: "rgba(255, 255, 255, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", overflow: "hidden", borderRadius: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "16px", marginBottom: "12px", flexShrink: 0 }}>
                <div>
                  <h2 style={{ fontSize: "18px", margin: "0 0 4px 0", color: "var(--ink)" }}>{selectedLog.target}</h2>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                    {selectedLog.type === "external_bot" ? "外部小龙虾 Web Socket 数据交换详情" : `API 引擎: ${selectedLog.modelOrToken || "未知模型"} · 请求时间: ${new Date(selectedLog.timestamp).toLocaleString()}`}
                  </p>
                </div>
              </div>

              {/* Tabs 页签选择区 */}
              <div style={{ display: "flex", gap: "16px", borderBottom: "1px solid var(--line)", paddingBottom: "10px", marginBottom: "16px", flexShrink: 0 }}>
                <button
                  onClick={() => setActiveTab("simple")}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeTab === "simple" ? "2px solid var(--amber)" : "2px solid transparent",
                    color: activeTab === "simple" ? "var(--ink)" : "var(--muted)",
                    fontWeight: activeTab === "simple" ? "700" : "500",
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: "13px",
                    transition: "all 0.2s"
                  }}
                >
                  精简提示词对比
                </button>
                <button
                  onClick={() => setActiveTab("raw")}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: activeTab === "raw" ? "2px solid var(--amber)" : "2px solid transparent",
                    color: activeTab === "raw" ? "var(--ink)" : "var(--muted)",
                    fontWeight: activeTab === "raw" ? "700" : "500",
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: "13px",
                    transition: "all 0.2s"
                  }}
                >
                  底层 API 原始载荷 {selectedLog.type === "external_bot" ? "(智能体回显)" : ""}
                </button>
              </div>

              {/* 详情内容滚动区 */}
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
                
                {activeTab === "simple" ? (
                  // 精简视图 Tab
                  selectedLog.type === "external_bot" ? (
                    // 外部机器人数据包结构
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Outgoing CLP Payload (下发给适配器的 Raw JSON 载荷)</span>
                          <button 
                            className="admin-btn-text" 
                            onClick={() => copyToClipboard(JSON.stringify(selectedLog.rawPayload, null, 2))}
                          >
                            复制 JSON
                          </button>
                        </div>
                        <pre style={{ 
                          margin: 0, 
                          padding: "16px", 
                          fontSize: "12.5px", 
                          lineHeight: "1.6", 
                          fontFamily: "monospace", 
                          whiteSpace: "pre-wrap", 
                          background: "var(--surface)", 
                          color: "var(--ink-soft)",
                          maxHeight: "600px",
                          overflowY: "auto"
                        }}>
                          {JSON.stringify(selectedLog.rawPayload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    // 内置 LLM 提示词拼接结构
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {/* System Prompt */}
                      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>1. System Prompt (系统人设与对抗强度预设)</span>
                          <button 
                            className="admin-btn-text" 
                            onClick={() => copyToClipboard(selectedLog.systemPrompt || "")}
                          >
                            复制内容
                          </button>
                        </div>
                        <pre style={{ 
                          margin: 0, 
                          padding: "16px", 
                          fontSize: "13px", 
                          lineHeight: "1.6", 
                          fontFamily: "monospace", 
                          whiteSpace: "pre-wrap", 
                          background: "var(--surface)", 
                          color: "var(--ink-soft)" 
                        }}>
                          {selectedLog.systemPrompt || "（空）"}
                        </pre>
                      </div>

                      {/* User Prompt */}
                      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>2. User Prompt (拼接后的现场提问与轮次历史)</span>
                          <button 
                            className="admin-btn-text" 
                            onClick={() => copyToClipboard(selectedLog.userPrompt || "")}
                          >
                            复制内容
                          </button>
                        </div>
                        <pre style={{ 
                          margin: 0, 
                          padding: "16px", 
                          fontSize: "13px", 
                          lineHeight: "1.6", 
                          fontFamily: "monospace", 
                          whiteSpace: "pre-wrap", 
                          background: "var(--surface)", 
                          color: "var(--ink-soft)" 
                        }}>
                          {selectedLog.userPrompt || "（空）"}
                        </pre>
                      </div>
                    </div>
                  )
                ) : (
                  // 底层 API 原始载荷 Tab
                  selectedLog.type === "external_bot" ? (
                    // 外部智能体真实 Prompt 展示
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>外部智能体最终组装 Prompt (平台侧虚拟拼装展示)</span>
                          <button 
                            className="admin-btn-text" 
                            onClick={() => copyToClipboard(selectedLog.botRequestPayload || "")}
                          >
                            复制内容
                          </button>
                        </div>
                        <pre style={{ 
                          margin: 0, 
                          padding: "16px", 
                          fontSize: "13px", 
                          lineHeight: "1.6", 
                          fontFamily: "monospace", 
                          whiteSpace: "pre-wrap", 
                          background: "var(--surface)", 
                          color: "var(--ink-soft)" 
                        }}>
                          {selectedLog.botRequestPayload || "（未获取到智能体端的有效载荷，无法进行最终 Prompt 的虚拟拼装展示）"}
                        </pre>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderTop: "1px solid var(--line)", fontSize: "12px", color: "var(--muted)", lineHeight: "1.5" }}>
                          💡 <b>提示</b>：此处的最终 Prompt 是由 Council 平台在发送发言令牌时，基于当前外部智能体提示词模板和上下文参数进行虚拟拼装生成的真实指令，保证与最终投递给大模型的参数一致。
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 内置大模型最终 API Body
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                        <div style={{ padding: "10px 16px", background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>大模型发送参数与请求格式 (Raw API Payload)</span>
                          <button 
                            className="admin-btn-text" 
                            onClick={() => copyToClipboard(JSON.stringify(selectedLog.rawRequestPayload, null, 2))}
                          >
                            复制 JSON
                          </button>
                        </div>
                        <pre style={{ 
                          margin: 0, 
                          padding: "16px", 
                          fontSize: "12px", 
                          lineHeight: "1.5", 
                          fontFamily: "monospace", 
                          whiteSpace: "pre-wrap", 
                          background: "var(--surface)", 
                          color: "var(--ink-soft)",
                          maxHeight: "220px",
                          overflowY: "auto",
                          borderBottom: "1px solid var(--line)"
                        }}>
                          {JSON.stringify({
                            model: selectedLog.rawRequestPayload?.model,
                            temperature: selectedLog.rawRequestPayload?.temperature,
                            max_tokens: selectedLog.rawRequestPayload?.max_tokens,
                            stream: selectedLog.rawRequestPayload?.stream
                          }, null, 2)}
                        </pre>
                        
                        {/* 详细的 messages 角色分解 */}
                        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", background: "var(--surface-subtle)" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>[Messages 角色分解列表]</span>
                          {selectedLog.rawRequestPayload?.messages?.map((msg: any, idx: number) => (
                            <div key={idx} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", overflow: "hidden" }}>
                              <div style={{ padding: "6px 12px", background: msg.role === "system" ? "rgba(16, 185, 129, 0.06)" : msg.role === "user" ? "rgba(59, 130, 246, 0.06)" : "rgba(245, 158, 11, 0.06)", borderBottom: "1px solid var(--line)", fontSize: "11px", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: msg.role === "system" ? "var(--green)" : msg.role === "user" ? "var(--blue)" : "var(--amber)" }}>
                                  ROLE: {msg.role.toUpperCase()}
                                </span>
                                <span style={{ color: "var(--muted)" }}>#{idx + 1}</span>
                              </div>
                              <pre style={{ margin: 0, padding: "12px", fontSize: "12.5px", lineHeight: "1.6", fontFamily: "monospace", whiteSpace: "pre-wrap", color: "var(--ink-soft)" }}>
                                {msg.content}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                )}
                
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.3)", borderRadius: "16px", border: "1px dashed var(--line)" }}>
              <div style={{ textAlign: "center", color: "var(--muted)" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "12px", opacity: 0.5 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p style={{ margin: 0, fontSize: "14px" }}>请在左侧列表中选择一条日志以查看完整的提示词拼接细节</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
