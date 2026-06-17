# 外部自主智能体 (小龙虾) 对接技术规范说明书 (External Agents Integration Spec)

本说明书用于记录 `agent-council-ai` 平台接入外部自主智能体（如 OpenClaw、QwenPaw 等小龙虾产品）的通用技术规范，以供后续接入其他厂商的龙虾智能体时参考。

---

## 1. 核心设计思想：仿 Telegram Bot 架构

为了避免平台（Server）不断去适配各类层出不穷的智能体网关（Client），我们采用类似 Telegram Bot 的**“服务器-客户端”反向接入模式**。

*   **平台 (agent-council-ai)**：充当中心服务器，不主动建立到智能体的连接。平台负责提供标准身份校验，暴露统一的 WebSocket/HTTP 接口。
*   **智能体 (OpenClaw / QwenPaw)**：充当客户端，在本地（或其云端）运行。通过安装我们为其开发的**连接通道插件 (Channel Adapter / Extension)**，以客户端身份长连接接入我们的平台。
*   **长记忆与上下文**：由于小龙虾（自主智能体）本身通常在其本地持有会话（Session），它自身具备上下文维护能力。因此平台与智能体通信时，仅需**增量推送新消息**，无需每轮重复发送完整历史。

---

## 2. 通信协议规范：WebSocket 双向流式连接

为了支持低延迟、高弹性的流式消息传递（包括智能体的 Token-by-Token 思考过程和打字机回复），我们选用 **WebSocket** 协议作为核心传输方式。

### 2.1 握手与鉴权
智能体插件启动时，应发起向平台的 WebSocket 连接：
- **地址**: `ws://<platform-host>:<port>/api/bot/connect`
- **鉴权**: 智能体需要在握手请求头或 URL Query 中带上由平台生成的 `BotToken`（例如：`ws://127.0.0.1:3000/api/bot/connect?token=dc_bot_xyz123`）。
- **连接确认**: 平台验证 Token 合法后批准连接，并建立与会议室中某位 `Expert` 实体的绑定关系。

### 2.2 数据帧协议 (Frame Protocol)
客户端与服务端交互均采用 JSON 数据帧格式。

#### A. 服务端推向客户端 (Downstream Events)
当会议室中有新消息，或者轮到该智能体发言时，平台通过 WS 向智能体推送消息。

*   **新发言广播 (Incremental Message)**
    当其他人发言时，推送给智能体同步状态，仅包含增量新消息：
    ```json
    {
      "event": "message.new",
      "data": {
        "id": "msg_9988",
        "senderName": "系统主持人",
        "content": "请各位专家对本交互方案发表意见。"
      }
    }
    ```

*   **发言令牌下发 (Turn Activation)**
    当轮到该智能体发言时，下发令牌：
    ```json
    {
      "event": "turn.active",
      "data": {
        "meetingId": "meet_001",
        "turnId": "turn_7766"
      }
    }
    ```

#### B. 客户端推向服务端 (Upstream Events)
当智能体开始思考与发言时，通过 WS 实时回传给平台。

*   **思考过程流式回传 (Thought Streaming)**
    支持展示小龙虾的思考轨迹：
    ```json
    {
      "event": "reply.thought",
      "data": {
        "turnId": "turn_7766",
        "chunk": "我认为当前交互的认知负担较高，因为..."
      }
    }
    ```

*   **最终发言流式回传 (Message Streaming)**
    流式传输最终呈现在会议中的发言：
    ```json
    {
      "event": "reply.chunk",
      "data": {
        "turnId": "turn_7766",
        "chunk": "建议将首屏的 CTA 按钮减少到一个。"
      }
    }
    ```

*   **发言结束标记 (Reply Done)**
    当智能体完成这轮发言后：
    ```json
    {
      "event": "reply.done",
      "data": {
        "turnId": "turn_7766"
      }
    }
    ```

### 2.3 OneBot 11 协议的会话上下文持久化规范

为使外部 OneBot 智能体（如 QwenPaw）在多轮交互中保持连贯记忆，必须规避“每次交互被识别为新会话”的问题：
1. **固定 `user_id`**：网关作为 OneBot 客户端发送私聊事件给 OneBot 服务端时，其中的 `user_id` (QQ号) 代表一个恒定的用户身份。
2. **基于专家ID哈希**：`user_id` 必须仅由外部专家的 `expertId` 决定（通过哈希转换为符合 OneBot 规范的 8-10 位正整数，不混入 `meetingId` 或是时间戳）。由此，不论是本轮追问还是跨会议讨论，OneBot 端都会将其识别为同一个好友会话，从而能够自动加载并累积上下文。

### 2.4 OneBot 回复报文的健壮解析规范

智能体可能通过以下三种格式回传消息段，网关在接收时必须进行健壮解析：
1. **纯字符串** (`string`): 直接作为正文内容。
2. **消息段数组** (`Array`): 遍历并合并其中类型为 `"text"` 的片段（`msg.data?.text`）。
3. **单个消息段对象** (`Object`): 判断若类型为 `"text"`，提取其内含的文本内容，以防止隐式强转导致前端接收到 `[object Object]`。

### 2.5 流式尾端 JSON 拦截与 Council 统一清洗规范

为了使流式拦截和卡片解析在 Council 平台做到全局一致，所有的清洗与前置防抖阻断统一内聚到 Council 服务端/前端核心渲染管道中：
1. **纯净流式回传**：外部智能体通道插件（如 QwenPaw Adapter）和内置专家接口应原封不动地通过流式数据帧把所有 Token（包括最后的 ```json 卡片大括号）回传给 Council。
2. **实时前置裁剪**：Council 侧前端接收到流式 chunk 后，在交给 React 渲染前，统一执行 `cleanStreamingJson`，根据 stance 等特征指纹和防抖安全距离，实时识别并截除未生成完毕的 JSON 段，保证用户聊天气泡中没有任何 JSON 字符串闪烁或残留。
3. **收尾统一清洗**：当收到 `stream_done`（或非流式 API 结束）时，无论外部智能体是否已在 `reply.done` 携带了解析后的 `expertStance` 字典，Council 服务端/前端均应统一对最终全文本进行 `extractAndCleanJson` 清洗。提取出的干净文本用于前端展示和历史消息的持久化保存，防止任何 JSON 块混入已存档的正文中。

---

## 3. 对接工具（插件）规范

不同的智能体框架，其编写 Channel 的方式各不相同，但它们在逻辑上需实现以下两层：

```
+-------------------------------------------------------------+
|               外部小龙虾智能体 (OpenClaw / QwenPaw)          |
|  +-------------------------------------------------------+  |
|  |                   智能体核心推理层                     |  |
|  +-------------------------------------------------------+  |
|                             ^                               |
|                             | 归一化输入/序列化输出          |
|                             v                               |
|  +-------------------------------------------------------+  |
|  |           连接通道插件 (Channel Adapter)              |  |
|  |   - 维护 WS 连接                                      |  |
|  |   - 将 message.new / turn.active 翻译为内部事件       |  |
|  |   - 捕获内部推理流，通过 reply.chunk 回传给平台       |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
                              |
                              | WebSocket 协议
                              v
                 +--------------------------+
                 |    Agent Council Platform |
                 +--------------------------+
```

### 3.1 OpenClaw 插件 (`openclaw-channel-agent-council`)
*   **技术栈**: TypeScript / Node.js
*   **结构**:
    - `index.ts` 注册为 OpenClaw 的一个自定义 Channel，读取 `config.json` 里的 `botToken` 和 `serverUrl`。
    - 启动时自动用 `ws` 库发起长连接。
    - 收到 `turn.active` 时，触发本地 OpenClaw 的 `session.spawn` 开启一次推理，并捕获 `stdout` 或模型的流式生成，再转发回 `reply.chunk`。

### 3.2 QwenPaw 插件 (`qwenpaw-adapter-agentcouncil`)
*   **技术栈**: Python (基于 AgentScope 协议)
*   **结构**:
    - 实现为一个自定义的 `AgentScope` Message Channel 装饰器或子类。
    - 使用 `websockets` Python 库维持长连接。
    - 将会议室的更新传入 QwenPaw 内部的 Agent 消息队列中。

---

## 4. 平台数据模型改造 (Types)

### 4.1 引入 Bot 配置与绑定关系
在平台侧，`Expert` 数据实体将支持直接设定为“外部 Bot”：

```typescript
export type Expert = {
  id: string;
  name: string;
  title: string;
  isExternalAgent: boolean; // 是否是外部机器人

  // 外部机器人专属配置
  botToken?: string;        // 平台生成的唯一 Token，小龙虾连接时凭此校验
  connectionStatus?: "online" | "offline";
  
  // 本地专家专属配置 (本地运行时依然保留)
  systemPrompt?: string;
  lens?: string;
};
```

---

## 5. 优势与扩展性评估
1. **安全性高**：外部智能体无需暴露自己的 IP 或接口，它们只需要连接出网（Egress）即可，非常适合部署在局域网内拥有本地物理设备权限的小龙虾。
2. **极简上下文**：借助 WebSocket 长连接，双方均能以轻量级的数据帧进行交互，极大地减少了 Token 的浪费。
3. **厂商无关性**：后续无论接入哪家大厂或个人的龙虾智能体，只要它们按照本说明书编写了相应的 WS 客户端插件，即可立即连接使用。
