# 外部与内置智能体流式返回前端气泡无输出缺陷修复说明书 (Streaming Interaction Bug Fix Spec)

## 1. 现状痛点与缺陷分析 (Problem Statement & Bug Analysis)

### 1.1 问题现象
在评审会议中，当专家（尤其是小蔚等外部智能体）或主持人进行流式发言时，前端气泡框没有任何文字渐进式地输出，一直显示“正在唤醒外部智能体”或空白。直到流式发言全部结束，气泡框内容才突然一下子全部展示出来。

### 1.2 缺陷根源分析 (Root Cause Analysis)
通过对前端 `src/app/page.tsx` 和消息卡片组件 `src/components/ChatMessageCard.tsx` 的第一性原理排查，定位到了以下两个核心缺陷点：

1. **状态直接修改 (State Mutation) 导致 React.memo 缓存失效**：
   在 `src/app/page.tsx` 的 4 处流式推流 `onChunk` 回调中，存在如下逻辑：
   ```typescript
   (text) => {
     expertMessage.content = text; // ！！！State Mutation ！！！
     const updatedMsgs = currentMeeting.messages.map(msg => 
       msg.id === expertMessageId ? { ...expertMessage } : msg
     );
     setMeetings(prev => prev.map(m => m.id === targetMeetingId ? { ...m, messages: updatedMsgs } : m));
   }
   ```
   这里的 `expertMessage` 和 `modMessage` 是在外部被定义的变量，并且在此处被直接修改了它的 `content` 属性。
   然而，由于这个对象引用在之前的 `setMeetings` 中已经被 React 渲染树持有。当在此处直接修改 `expertMessage.content` 时，在 React 进行 Virtual DOM 的调和比对时，旧 props 中的 `prevProps.message.content` 已经在内存中被篡改成了最新的 `text` 值，与新 props 的 `nextProps.message.content` 完全一致。
   这使得使用 `React.memo` 包裹的 `ChatMessageCard` 在其 `areEqual` 检测函数中判定 `prevProps.message.content === nextProps.message.content` 为 `true`，从而完全**跳过了流式阶段的重绘渲染**。
   只有在流式最终结束、其他状态（例如 `speakingExpertId` 变为 `null` 等）改变时，或者 `expertMessage` 引用被重新覆盖时，才触发最终一次的渲染。

2. **闭包数据过期风险**：
   在 `onChunk` 每次调用时，直接使用了外部被闭包捕获的 `currentMeeting.messages` 快照来构建新的消息列表。如果在此期间 `meetings` 状态被其他操作更新过，此处的覆盖会导致其他状态更新丢失。

---

## 2. 交互与技术设计方案 (Technical Design & Solution)

为了物理级根治上述缺陷并确保极佳的流式体验，我们将采用**不可变数据流式状态更新 (Immutable Stream State Update)** 方案：

### 2.1 彻底关停直接就地修改 (No-Mutation Rule)
在流式 `onChunk` 的回调函数中，放弃就地修改 `expertMessage.content` 或 `modMessage.content` 属性。而是通过局部重新赋值或在 `setMeetings` 中实时生成新对象。

### 2.2 基于 `prev` 的函数式 Immutable 更新
更新逻辑应完全不依赖被捕获的局部 `currentMeeting` 快照，而是利用 `setMeetings(prev => ...)` 提供的最新 React 状态快照进行完全不可变的深度遍历修改。

**重构后的专家流式更新范式**：
```typescript
(text) => {
  // 1. 使用不可变更新重新给局部变量赋值，避免直接篡改原有被 React 持有的对象属性
  expertMessage = { ...expertMessage, content: text };
  
  // 2. 利用 prev 函数式安全更新，确保 React 状态树在内存中检测到消息对象引用的变化
  setMeetings((prev) =>
    prev.map((m) => {
      if (m.id !== targetMeetingId) return m;
      const updatedMessages = m.messages.map((msg) =>
        msg.id === expertMessageId ? expertMessage : msg
      );
      return { ...m, messages: updatedMessages };
    })
  );
}
```

**重构后的主持人流式更新范式**：
```typescript
(text) => {
  modMessage = { ...modMessage, content: text };
  setMeetings((prev) =>
    prev.map((m) => {
      if (m.id !== targetMeetingId) return m;
      const updatedMessages = m.messages.map((msg) =>
        msg.id === modMessageId ? modMessage : msg
      );
      return { ...m, messages: updatedMessages };
    })
  );
}
```

---

## 3. 全局影响评估与核查 (Impact & Conflict Analysis)

### 3.1 兼容性与依赖分析
- **上下游依赖**：本次重构仅涉及前端 `src/app/page.tsx` 中的流式回调，对后端的 CLP 协议转发网关 `ws-relay-server` 和 python 适配器没有做出任何破坏性修改。
- **逻辑冲突**：本次修改完全遵循 React 的 Immutable 更新规范，与已有的流式思考折叠折行规则（remark-math/rehype-katex/cleanStreamingJson）没有任何冲突。
- **冗余检查**：无类似实现，此为核心发言渲染的通用通路，必须在此处完成加固。

### 3.2 性能评估
- 不可变更新会带来极轻微的 GC 开销，但这属于 React 标准做法，且仅限于单次流式字符追加，相比于原本由于 Mutation 造成的页面闪烁或组件大面积 Reflow/不渲染问题，该方案能大幅度保证打字机效果的流畅度。

---

## 4. 实施与验证步骤 (Implementation & Verification Plan)

### 4.1 实施步骤
1. **核准执行指令**：等待用户 LGTM 确认。
2. **代码变更**：在 `src/app/page.tsx` 中定位并替换四处流式 `onChunk` 的代码块（2 处专家发言、2 处主持人总结）。
3. **任务管理更新**：将修改进度同步在 `project-tasks.md` 中。

### 4.2 验证方法
1. **自动化类型检查**：运行 `npx tsc --noEmit` 保证 TypeScript 静态类型完全通过。
2. **手动流式测试**：开启评审会议并点名小蔚或其他外部智能体发言，观测前端气泡框内容是否以打字机流式输出呈现，Loading 卡片是否在其首包到达后实时平滑隐去。
