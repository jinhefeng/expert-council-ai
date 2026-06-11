# Design Council AI 技术架构设计文档

本文档从开发与维护视角，详细描述 Design Council AI 的技术架构、核心分层与模型链路流转机制。

## 1. 架构概览与分层设计 (Architecture Overview)

项目采用了纯前端兼顾局部服务端渲染的全栈架构（Next.js App Router），并在内部高度抽象了多智能体编排层。整体分为三层：

1. **UI 展现与状态层 (`src/app/page.tsx`)**
   - 负责 React 状态管理（议题、附件、历史对话记录 `messages` 等）。
   - 解析 Markdown（并专门对 Reasoning 模型的 `<think>` 标签进行独立组件隔离）。
   - 管理会议生命周期（通过 `AbortController` 掌控中断能力），处理前端流式 Chunk 的拼装渲染。
2. **中间件与编排服务层 (`src/app/api/discussions/*` & `src/lib/model-router.ts`)**
   - 作为桥梁，负责屏蔽底层大模型的差异性。
   - 实现具体的专家多轮问答逻辑。
   - 包含算法编排：获取下一个发言者、组装角色提示词、请求专家流、汇总并提炼最终结论。
3. **大模型能力层 (LLM Provider Layer)**
   - 依赖本地或远端的模型 API（目前默认支持通义千问兼容模式及 OpenAI 模式）。
   - 根据模型是否具有推演能力 (Reasoning Mode)，采用不同的数据包组装策略。

## 2. 核心链路流转：模型适配与隔离机制

### 2.1 身份隔离防串台机制
在多智能体圆桌讨论时，如果把过往聊天历史原样传给大模型，模型很容易混淆不同专家的身份甚至混入主持人视角。为此，我们在 `model-router.ts` 中采用了**强制历史标记与上下文隔离**的方案：

- 所有以往发言记录的 `role` 均被归为 `assistant` 或 `user`。
- 对于 `assistant` 的过往记录，在文本开头强行注入身份锚点：例如 `【交互研究员】：我认为...`。
- 模型在单次推演时，只接收包含：当前角色私有系统提示词（System Prompt）、加上前缀的历史消息、最后再辅以本轮其他人的上下文片段的整合数据包。

这样从物理上每次发起的 HTTP Request 都是无状态、互相独立的，彻底杜绝了模型“抢词”或“身份错乱”。

### 2.2 动态系统提示词构建 (`getIntensityPrompt`)
通过计算专家的固有对抗属性（`debateIntensity`）与当前全场主持模式（`globalDebateIntensity`）的交集，模型路由会动态提取预设的 5 级提示词片段，让专家模型在一轮一轮之间能够表露出**温和协同**或是**激烈批判**的不同论调。

### 2.3 支持推理模型 (Reasoning Models) 处理
部分高级模型（如 DeepSeek-R1 兼容接口）的返回流中包含特殊的运算过程标记 `<think>...</think>`。
- **协议层处理**：如果是明确设定为推演模型的提供商，`model-router.ts` 在下发 `messages` 时可能需要剥离或者转换标准的 `system` 角色为 `user` 角色（以应对某些推理模型对角色的苛刻限制）。
- **渲染隔离层处理**：见前端业务层利用正则即时捕捉推流中的 `<think>`，实现在同一气泡中展示独立的思考过程块。

## 3. 文件系统树说明

```text
├── src/
│   ├── app/
│   │   ├── api/discussions/      # 后端 API 路由聚合点
│   │   │   ├── assist/           # 发言意图预判（辅助输入等）
│   │   │   ├── conclusion/       # 全场最后提炼
│   │   │   ├── expert-turn/      # 核心单轮流式发言
│   │   │   ├── next-speaker/     # 发言者智能匹配算法
│   │   │   └── synthesis/        # 每轮阶段性主持人总结
│   │   └── page.tsx              # 会议室主页面UI
│   ├── components/               # 通用组件封装
│   └── lib/
│       ├── experts.ts            # 本地专家与主持人数据注册表
│       ├── model-router.ts       # 【核心】统一模型适配与编排引擎
│       └── types.ts              # 核心 TS 接口与类型定义
├── roles/                        # 本地化管理的知识库（Markdown形式预设专家数据）
├── .agent/
│   └── docs/                     # 所有规范文档、流程定义汇总区
└── README.md                     # 项目主说明
```

## 4. 架构设计的扩展性
本架构为未来留下了以下几个可扩展口：
- **专家模型异构化**：由于每个 API Route 每次发起调用时都会组装 `engineConfig`，未来可以轻松实现“前端用模型 A 生成，架构用模型 B 探讨”。
- **会议流程挂载 Hook**：由于通过独立的 API Route 控制了各子流程，未来可通过 Webhooks 形式，让第三方工作流平台也能直接调用 `expert-turn` 或 `synthesis`，剥离与 UI 的强耦合。
