# 提示词科学性评估与底层大模型原始 API 请求监控说明书 (Prompt Interception Spec)

## 1. 业务背景与第一性原理设计
在 Design Council AI 圆桌会议中，系统向大模型（内置专家、主持人、选人派单、总结等）以及外部智能体（小龙虾）发送的提示词经历多层模版组合与变量替换。
业务层记录的 System/User Prompt 只是纯字符串，无法反映底层网络发送时的物理状态：
1. 底层引擎（如 Qwen 或 GPT）因其架构特性（例如推理模型 `isReasoningModel` 将 `system` 消息转为 `user` 角色）所作的物理重组。
2. 实际的 messages 数组在包含历史会话时的真实边界与格式化嵌套（换行符、块引用符号、敏感敏感字段脱敏）。
3. 外部智能体在 Python/QwenPaw 运行时由进程内引擎所编排组装的最终 Prompt。

为了帮助用户科学评估 System Prompt 的权重分布与上下文格式（防止因换行错乱、角色标签堆积导致模型注意力失调），我们必须下沉拦截层至 **物理网络发送前夕 (In-Flight HTTP Interception)**，并建立 **双端（TS-Python）提示词回流机制**。

---

## 2. 系统架构设计

### 2.1 内置专家及内部组件（TS 服务端）的底层拦截
拦截点设在 `src/lib/model-router.ts` 的 `callLLM` 和 `callLLMStream` 发送网络请求的最后一步：
- 提取拼接好且经过 Reasoning 转换处理后的 `payload` 对象（含 `model`、`messages`、`temperature` 等）。
- 将该 `payload` 实体作为 `rawRequestPayload` 字段存入 `PromptLogEntry`。

### 2.2 外部智能体（Python 适配器）的输入 Prompt 缓存与回流
由于外部智能体在独立进程中运行并调用其底层 LLM 接口，主站无法直接通过 HTTP 拦截它。我们通过 CLP 事件流通道实现“输入 Prompt 自动回流”：
1. **缓存机制**：在 Python 适配器 `agent_council_channel.py` 收到 `turn.request` 消息并调用 `build_agent_request_from_native` 拼装最终的 Prompt 时，将该最终 `prompt` 以 `turn_id` 为 Key 缓存至进程内存 `_prompt_cache: dict` 中。
2. **回流机制**：当智能体发言结束（流式 `on_streaming_end` 或非流式 `send`）并向平台发送 `reply.done` 时，从缓存中提取该 `rawPrompt` 随 CLP 载荷一并发回 Council 平台。
3. **日志收录**：网关 `ws-relay-server.ts` 在接收到外置机器人的 `reply.done` 时，将包含该 `rawPrompt` 的数据录入 `PromptLogService`，并广播给前端。

---

## 3. 数据模型设计

### 3.1 扩展的日志模型 ([prompt-log-service.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/prompt-log-service.ts))
```typescript
export interface PromptLogEntry {
  id: string;
  timestamp: number;
  type: "api_sync" | "api_stream" | "external_bot";
  target: string;        // 触发的目标名称
  modelOrToken?: string;
  systemPrompt?: string; // 业务侧 System Prompt 备份
  userPrompt?: string;   // 业务侧 User Prompt 备份
  
  // 新增底层拦截字段
  rawRequestPayload?: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    [key: string]: any;
  };
  
  // 新增外部智能体真实 Prompt 字段
  botRequestPayload?: string; 
}
```

---

## 4. UI 交互设计 (Interaction Spec - `/monitor`)
1. **详情展示面板增加“原始 API 载荷 (Raw API Payload)” Tab 页签**：
   - 用户可在详情折叠器中自由切换“精简提示词对比”与“底层 API 发送载荷”视图。
2. **富文本与 JSON 折叠渲染**：
   - 渲染底层 `rawRequestPayload.messages` 数组，清晰展现每个 `role`（`system`、`user`、`assistant`）及其内部 `content`。
   - 包含一键 Copy 按钮，以便把底层的整个 messages JSON 一键导入 Prompt 调试工具中评估。
3. **外部机器人真实输入 Prompt 展示**：
   - 对于外部 Bot 日志，右侧详情显示小龙虾接收并实际喂给底层大模型的完整终态 Prompt，突出展现被剥除思维链的 `previousTurns` 最终状态。
