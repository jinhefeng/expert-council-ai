# 流式输出与推理模型支持技术方案 (Streaming & Reasoning Support Spec)

## 1. 需求分析 (Requirement Analysis)
**目标**：
1. **专家发言流式输出 (Streaming)**：在会议中专家发表观点时，内容能够逐字流式打字机显示，提升用户体验，减少长时间等待的焦虑。
2. **推理模型支持 (Reasoning)**：针对类似 o1、DeepSeek-R1 等推理模型，其可能不支持 system prompt 或是返回内容包含特殊的 `<think>` 或 `reasoning_content`，需要在模型设置中增加针对这类模型的适配开关。
3. **设置项暴露**：在管理后台的大模型配置界面，增加“是否为推理模型 (Reasoning Model)”和“是否启用流式输出 (Enable Streaming)”的开关。

## 2. 架构考量 (Architecture Considerations)

### 2.1 数据库/存储层 (Storage Layer)
修改 `src/lib/types.ts`，在 `LLMEngineConfig` 中新增以下可选字段：
- `isReasoningModel?: boolean;`
- `enableStreaming?: boolean;`

### 2.2 前端配置界面 (Admin UI)
在 `src/app/admin/page.tsx` 中：
- 在新建/编辑大模型的 Modal 中加入对 `isReasoningModel` 和 `enableStreaming` 的 checkbox 表单绑定。
- 若 `enableStreaming` 打开，提示用户此项支持将开启逐字输出体验。

### 2.3 LLM 核心路由层 (Model Router & API)
修改 `src/lib/model-router.ts` 和相关 API 路由：
1. **API 请求参数**：当 `enableStreaming` 开启时，在 fetch LLM 时携带 `stream: true`。
2. **Prompt 适配 (Reasoning Model)**：若模型标注为推理模型，它可能不支持 `role: "system"`，或者对于 System 提示词的要求较严。需要在 `callLLM` 中判断 `config.isReasoningModel`，如果是，考虑将 system prompt 转换为 user prompt 发送（或保留视具体厂商要求，但需对某些模型做容错）。
3. **响应流解析 (Response Stream)**：
   由于未引入 `@ai-sdk`，我们将通过原生的 `fetch` 获取 `ReadableStream`，并写一个 SSE（Server-Sent Events）解析器，将大模型的 `data: {...}` 事件转化为前端可消费的流。
4. **结构化数据提取**：原有的专家发言会一次性返回包含 `content` 和 `expertStance` (JSON) 的长文本。在流式模式下，我们将流式吐出正文，但在服务端（或前端流接收器）最后再执行正则匹配来截取出 `stance`，以保持界面的结构化渲染不被破坏。

### 2.4 前端会议展示界面 (Meeting UI)
修改 `src/app/page.tsx`（或讨论组件）：
- 专家发言接口改为解析流（例如使用 `TextDecoder` 和 `EventSource` / ReadableStream 解析）。
- 在 React 状态中，将 `chatMessage` 的内容做实时追加。
- 考虑到如果是 Reasoning 模型，流中可能包含思维链内容，我们可以在 UI 上设计一个可折叠的 `<details>` 模块专门展示推理思考过程。

## 3. 潜在影响评估 (Impact Analysis)
- **向下兼容性**：需要确保未开启 `enableStreaming` 的旧模型或默认模型依旧按原逻辑（阻塞等候并返回完整字符串）正常工作。
- **UI 重绘性能**：流式渲染会导致 React 组件高频次重绘，需要注意 `ChatMessage` 组件是否做了适当的解耦，以免导致整个会议列表重新渲染导致卡顿。
- **结构化信息的延迟**：由于流式传输是顺序的，`expertStance` 的卡片内容（立场、关注点等）必须等到流式输出即将结束时才能完成渲染，这会有视觉上的先后呈现差异。

## 4. 实施计划 (Implementation Plan)
**阶段一：数据模型与设置 UI 更新**
1. 更新 `src/lib/types.ts`。
2. 更新 `src/app/admin/page.tsx`，补充表单项。

**阶段二：LLM 调度层改造**
1. 重构 `model-router.ts`，增加支持 `stream: true` 的调用及原生 SSE 数据块解析逻辑。
2. 处理 `isReasoningModel` 的系统指令适配。
3. 修改 `expert-turn/route.ts` 以返回 Web 标准的 `Response` Stream。

**阶段三：前端会场界面对接**
1. 修改主会议页面中调用 `expert-turn` 的代码，适配 `fetch` ReadableStream。
2. 对包含思考过程（如 `<think>...</think>` 或特定的 reasoning block）的内容进行正则隔离并展示。

---
**请用户确认**：
上述方案是否符合您的预期？特别是**对于推理模型的适配（System 提示词的处理、思考过程的展示）以及手写流式输出引擎**的思路是否符合您当前的项目架构限制？
如确认，请回复“**确认执行**”，我将按此计划开始代码修改。
