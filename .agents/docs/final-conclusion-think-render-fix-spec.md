# 会议最终结论思维链渲染与重构说明书 (Final Conclusion Think Block Render Spec)

## 1. 问题与架构背景
按照用户的最新反馈，我们将进一步简化“会议最终结论”的交互与展示逻辑：
1. **彻底去掉最终结论中 think 过程的展示**：结论面板中不再展示任何形式的“深度思考已折叠”按钮，仅保留清洗出 `<think>` 后纯粹的 Markdown 结论正文。
2. **提炼生成结论期间不展示最终结论面板**：在提炼结论（包括更新结论）的流式/异步等待期间，【会议最终结论】面板直接保持隐藏状态。提炼结束且新结论被写回后，面板再行滑出展示。

## 2. 缺陷定位与解决方案

### 2.1 去掉 think 过程展示
* **解决方案**：在结论只读展示态下，依然在渲染前使用 `parseThinkingContent` 工具函数清洗 `activeMeeting.finalConclusion`，以提取并剥离出纯正文 `displayContent`。
* **渲染逻辑**：面板的 Header 行中移除 `<ThinkingBlock>`，面板的正文区仅直接传入 `displayContent` 给 `ReactMarkdown` 渲染。

### 2.2 提炼期间隐藏面板
* **解决方案**：修改结论面板的显示条件。只有在最终结论存在（`finalConclusion`），且当前没有解锁讨论（`!unlockedComposers`），并且当前**不处于提炼生成状态**（`!generatingConclusions[activeMeetingId]`）时，才渲染面板。
* **状态过滤**：在点击“更新结论”时，`generatingConclusions[activeMeetingId]` 为 `true`，面板会自动被隐藏，旧结论也就随之完美隐去。待新结论写入并且 `generatingConclusions` 变回 `false` 时，面板再次滑出显示新结论。

---

## 3. 具体修改方案

### 3.1 改造 page.tsx 中的结论面板逻辑
文件路径：[page.tsx](file:///Users/jinhefeng/Dev/design-council-ai/src/app/page.tsx)
- 面板渲染的触发逻辑修改为：
  ```typescript
  {activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId] && !generatingConclusions[activeMeetingId] && (() => {
  ```
- Header 行渲染移出 `<ThinkingBlock>`：
  ```typescript
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid rgba(212,175,55,0.3)", paddingBottom: "12px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
      <h3 style={{ margin: 0, color: "#684c08", display: "flex", alignItems: "center", gap: "8px", fontSize: "16px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        会议最终结论
      </h3>
    </div>
    <div style={{ display: "flex", gap: "8px" }}>
      <button className="ghost-button export-hidden" onClick={() => { 
        const { displayContent: editContent } = parseThinkingContent(activeMeeting?.finalConclusion || "");
        setConclusionDraft(editContent); 
        setIsEditingConclusion(true); 
      }} ...>
        编辑
      </button>
    </div>
  </div>
  ```
- 只读正文区只传 `displayContent`：
  ```typescript
  <div className="markdown-body" style={{ fontSize: "14px", color: "var(--ink)" }}>
    <ReactMarkdown ...>
      {displayContent}
    </ReactMarkdown>
  </div>
  ```
