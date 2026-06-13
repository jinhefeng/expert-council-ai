# 外部智能体全局 System Prompt 模板配置与动态组装说明书 (Functional Spec V4)

本说明书定义了将外部智能体（小龙虾原生通道与 OneBot/QwenPaw 协议连接）的发言提示词/系统指令模板纳入系统全局提示词后台管理的交互行为、数据帧协议变更、边缘逻辑处理、上下文增量投喂（Incremental Feeding）及防会话过载与泄漏的清洗机制，以此作为开发实施的指导规范。

---

## 1. 业务逻辑描述 (Business Logic)

外部智能体（小龙虾/QwenPaw）本身是独立运行的，其在本地进程中已经配置好并持有其专属的专家人设（例如“小蔚”的设计师人设、“董事长”的决策人设）。因此，平台在个体专家层面不应当为其在后台重复设定或强加人设（`systemPrompt` 属性对外部专家继续置空，不干涉其自主性）。

但是，网关在请求外部智能体发言时，需要向其投喂会议上下文并要求其以特定格式输出正式评审意见与 JSON 立场卡片。此前，这个包含上下文注入占位符、输出 JSON 约束及安全提示的**系统提示词指令模板**是**硬编码在后端网关 `ws-relay-server.ts` 中的**。

本功能旨在通过在系统的 **“中心后台 ➔ 系统工作流提示词管理 (System Prompts)”** 中增加对外部智能体全局发言提示词模板的编辑管理，实现“统一集中管理模板，人设保持本地独立”的第一性原理。

---

## 2. UI 交互流程与设计 (UI & Interaction Flow)

1. **入口与展示**：
   - 打开 “管理后台” ➔ 滚动到下半部分的 **“系统工作流提示词管理 (System Prompts)”** 配置面板。
   - 在“阶段一：专家发言设定”中，在 5 个辩论对抗强度文本域之后，追加展示一个 **“外部智能体发言提示词模板 (External Agent System Prompt Template)”** 文本域。
2. **表单保存与校验**：
   - 管理员在文本域中自由编辑对外部智能体的系统投喂模板，点击底部的“保存提示词模板”统一保存至系统的 `SystemPromptsConfig` 全局配置中。
   - 提供该模板字段的出厂默认值（即之前硬编码在网关中的 Prompt），支持置空。

---

## 3. 协议变更定义 (Protocol Specifications)

### 3.1 前后端 WebSocket 协议 (`request_turn`)
前端在触发外部专家发言向中继网关请求时，不再传递该专家的个体 systemPrompt，而是从系统已加载的全局配置中，将自定义的外部提示词模板 `externalAgentPrompt` 包含在 JSON 载荷中：

```json
{
  "type": "request_turn",
  "expertId": "expert-xyz",
  "expertName": "安全官",
  "question": "如何保障数据安全？",
  "context": "项目背景...",
  "previousTurns": [...],
  "externalAgentPrompt": "当前会议新议题：{question}...", // 新增属性：全局外部提示词模板
  "turnId": "turn-12345"
}
```

### 3.2 外部 OpenClaw 协议 (`turn.active`)
网关在向外部 OpenClaw 智能体推送发言令牌时，在 `data` 对象中追加 `externalAgentPrompt` 属性进行透传，并仅携带增量的 `previousTurns`，由小龙虾客户端插件根据自身设计自行选择解析或做变量替换：

```json
{
  "event": "turn.active",
  "data": {
    "meetingId": "meet-001",
    "turnId": "turn-12345",
    "question": "如何保障数据安全？",
    "context": "项目背景...",
    "previousTurns": [...], // 仅包含增量的历史发言
    "isIncremental": true,
    "externalAgentPrompt": "当前会议新议题：{question}..." // 新增属性
  }
}
```

---

## 4. 边缘场景与智能组装规则 (Edge Cases & Parsing Rules)

中继网关在 `ws-relay-server.ts` 中接收到 `request_turn` 载荷后，执行以下处理：

### 4.1 OneBot 协议 (QwenPaw) 的模板解析
1. **未配置模板 (空字串)**：
   - 网关自动回退并采用系统出厂预置的默认模板（降级策略，确保系统不因配置缺失而崩溃）。
2. **变量替换规则**：
   - 网关对 `externalAgentPrompt` 中的变量占位符执行全局正则替换：
     - `\{question\}` ➔ 当前会议议题 `payload.question`
     - `\{context\}` ➔ 背景与附件文本 `payload.context` (若为空则替换为 `"无"`)
     - `\{previousTurns\}` ➔ 格式化后的此前轮次发言历史记录
     - `\{expertName\}` ➔ 当前发言专家名称 `expertName`
   - 替换后的内容作为最终 `message` 字段通过 OneBot 协议发送给外部智能体客户端。

### 4.2 OpenClaw 协议的传输
- 网关仅在 `clawEvent.data` 中追加 `externalAgentPrompt` 属性并原样透传。不进行网关侧的变量替换，给予外部插件最大的解析自由度。

---

## 5. OneBot 会话跨会议隔离与消息前导英文自言自语切除规范 (Context Isolation & Prefix Cleanup)

为了保障大模型在多轮交互后，其本地上下文窗口不会因为极其臃肿且重合的系统指令而过载错乱，同时在发生调试内容泄露时保护排版，制定以下规约：

### 5.1 会话跨会议隔离 (`sessionUserId` 的绑定算法)
- **原因**：如果同一个专家的 `sessionUserId` 永久恒定，会导致 QwenPaw 侧的长对话会话无限堆叠，大模型上下文过载进而导致其思维链 `<think>` 标签丢失、胡言乱语。
- **方案**：向 OneBot 发送消息时使用的 `sessionUserId`（QQ号）必须由 `expertId` + `meetingId` 共同哈希计算生成。
- **效果**：同场会议中可以继承一定的追问记忆；一旦切换会议或新建对话，哈希出的 `user_id` 会强制发生变化，在 QwenPaw 侧自动为该外部专家开启一个完全纯净无污染的新会话，阻断记忆污染。

### 5.2 前导英文独白与调试信息切除算法
- **现象**：当大模型因上下文错乱生成调试英文独白（例如 `"Council We need to respond as the agent 'wei' with identity '小蔚'..."`）且没有包裹在 `<think>` 中时，会导致严重的指令泄露与不折行混乱。
- **方案**：在清洗函数 `extractAndCleanJson` 开头，新增正则表达式匹配：
  若文本开头包含 `Council` 且后跟长于 15 字符的典型英文任务分析前导词（如 `We need to`, `Must`, `The user wants`, `As a`, `Need to` 等），直接将其作为“大模型英文自言自语/独白”予以强力切除，直至定位到真正的中文发言起点：
  ```typescript
  text = text.replace(/^[\s\n]*Council\s*(?:We need to|Must|The user wants|As a|Need to|Ensure|We should)[\s\S]*?(?=\n\n|[\u4e00-\u9fa5])/i, "");
  ```
  这能最大程度过滤外部智能体的格式泄漏，保障前端发言气泡的规整与优雅。

### 5.3 增量上下文投喂算法与清空重置自适应机制 (Incremental Feeding)
- **原理**：由于外部智能体本身是有状态且持久化本地会话消息的，如果每轮发言网关都重复发送全量的会议背景与此前专家历史记录，会导致大模型的本地上下文堆积过载。
- **网关增量逻辑**：
  网关类维护一个私有哈希表记录已发送历史索引 `lastSentTurnIndices = new Map<string, number>()`，键为 `expertId + "-" + meetingId`。
  1. **首轮交互（`lastIndex === 0`）**：网关向小龙虾发送全量 `externalAgentPrompt`（包含议题、背景和 System Prompt 约束限制），在小龙虾本地内存中初始化会话。发送后记录已发送条数。
  2. **增量交互（`lastIndex > 0`）**：网关只提取 `previousTurns.slice(lastIndex)` 的**增量新发言**并进行格式化组装，加上极简提示（`“会议新增发言如下：...\n请针对以上新发言发表视角发言，并在末尾附带 JSON 卡片。”`）下发。发送后更新已发送条数。
  3. **防重置回退机制**：若判断 `previousTurns.length < lastIndex`（如用户清空或重新开始会议），网关全自动将 `lastIndex` 归零，重新触发全量初始化。

---

## 6. 影响分析与冲突预警 (Impact & Conflict Analysis)

### 6.1 受影响模块
1. **`ws-relay-server.ts`**：
   - 需修改 OneBot 分支的 `sessionUserId` 提取，加入 `payload.meetingId` 参数合成。
   - 实现 `lastSentTurnIndices` 对已发送发言的计数、增量抽取组装及防重置兜底。
2. **`content-parser.ts`**：
   - 升级清洗流程，加入 5.2 的清洗正则与 5.3 对 `replace` 的转义防护。

### 6.2 冲突预警与防范
- 切换虚拟 `user_id` 时，如果 QwenPaw 内部逻辑有针对特定 `user_id` 的硬编码校验，可能会受到影响。但标准的 OneBot 11 服务端仅以 `user_id` 区分会话，不会对其做强制性的特定名单校验，因而对大多数反向 WebSocket 均能完美兼容。
