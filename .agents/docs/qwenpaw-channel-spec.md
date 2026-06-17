# 📑 QwenPaw 原生通道规范化与解耦重构技术说明书 (QwenPaw Native Channel Spec)

本说明书定义了按照 QwenPaw 官方 `BaseChannel` 框架规范，对 `AgentCouncilChannel` 进行全方位的工程化解耦与重构设计。本次重构旨在废除原先特设（ad-hoc）的假流式打字机模拟与复杂的 Python 状态机过滤器，全面采用框架原生的流式钩子事件进行开发，以达到生产级解耦标准。

---

## 1. 核心设计原则

### 1.1 原生生命周期接管
摒弃以往的非规范自主消费路径，完全拥抱 QwenPaw `BaseChannel` 规范，实现与框架一致的流水线运作方式：
- **消息入队分发**：当外部 WebSocket 监听到平台的发言令牌 `turn.request` 时，调用框架的 `self._enqueue(agent_request)` 推入内置的 UnifiedQueueManager 中，实现多轮会话安全排队。
- **正规流式钩子调度**：将 `streaming_enabled` 物理配置直接同步赋给基类。当大模型推理产生实时增量 Token 时，框架会自动将 reasoning（思考过程）和 message（正文发言）通过 `on_streaming_delta` 钩子派发给通道实例。
- **全量兜底消费**：若用户关闭流式传输，框架推理完成后会直接回调 `send` 抽象方法，进行一次性的数据投递。

### 1.2 高度解耦与工程化
- **物理废除 `StreamingTokenFilter` 状态机**：移除原先在 Python 侧通过正则和缓存对思维链 `<think>` 标签和 JSON 尾部进行词法匹配的复杂类，完全依靠底层运行时通过 `stream_type` 的精准段落切分。
- **移除假流式模拟**：消除由于打字机机制（`asyncio.sleep(0.01)` 和按 chunk 大小切割）引起的时间竞态和延迟开销，提供 100% 物理真实的零阻碍增量 Token 传递。

---

## 2. 通道生命周期与数据分发契约

### 2.1 真实的流式派发流 (Streaming Path)
当通道被配置为 `streaming_enabled = True` 时，流式推理的三个钩子事件由框架自发回调：

```
+------------------+
| QwenPaw Runtime  |
+------------------+
  |
  | 1. 推理开始 
  v
  * on_streaming_start()
  |
  | 2. 产生 Reasoning Token (增量思考)
  v
  * on_streaming_delta(stream_type="reasoning")  --> 发送 reply.thought (增量)
  |
  | 3. 产生 Message Token (增量正文)
  v
  * on_streaming_delta(stream_type="message")    --> 发送 reply.chunk (增量)
  |
  | 4. 正文流结束
  v
  * on_streaming_end(stream_type="message")      --> 提取 stance JSON, 发送 reply.done 
```

- **增量思考分发 (on_streaming_delta)**：
  从事件实体中安全解析 `getattr(event, "text", "")`。若 `stream_type == "reasoning"`，发送 `reply.thought` 包至网关。
- **增量正文分发 (on_streaming_delta)**：
  若 `stream_type == "message"`，直接发送 `reply.chunk` 包至网关。
- **发言结束与卡片提取 (on_streaming_end)**：
  当收到 `stream_type == "message"` 结束标志时，表明大模型输出结束。直接对完整的 `accumulated_text` 调用卡片提取正则表达式，生成 `expertStance` 字典并包装为最后的 `reply.done` 发送出去。

### 2.2 真实的非流式派发流 (Non-Streaming Path)
当通道关闭流式传输时（`streaming_enabled = False`），框架会在推理结束后直接调用通道的 `send` 方法。
- **思考/正文分离**：通过正则表达式从 `text` 字段中查找并拆离 `<think>(.*?)</think>`。
- **一次性顺序发包**：
  1. 向 WS 发送 `reply.thought`（包含全量思考内容，如果有）；
  2. 向 WS 发送 `reply.chunk`（包含已物理剪除思考段的全量正文）；
  3. 解析立场摘要卡片，向 WS 发送包含卡片信息的 `reply.done`。

---

## 3. 受影响的类与重构契约

- **受影响的类**：`AgentCouncilChannel(BaseChannel)`
- **需要废除的资产**：
  - `class StreamingState` (废除)
  - `class StreamingTokenFilter` (废除)
- **新重写的钩子函数**：
  - `on_streaming_start()`
  - `on_streaming_delta()`
  - `on_streaming_end()`
  - `send()`
