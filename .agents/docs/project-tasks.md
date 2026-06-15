# Project Task Manager (AI-Driven)

这是由 Antigravity (AI) 自动维护和管理的全局任务清单。
作为开发者，您可以直接修改此文件，或者在对话中吩咐 AI 帮您进行任务的拆解、更新和状态管理。

## 📍 宏观目标 (Epics / Milestones)
- [ ] **🔮 架构重构：基于第一性原理的 QwenPaw 原生 Channel 统一数据契约改造**
  * **设计初衷**：现有的 OneBot 反向连接是一套过渡性协议，由于其设计本是为了匹配即时聊天通信，迫使 Council 网关（中继服务器和清洗引擎）编写了大量针对防抖合并、多端前导剪除与后缀防注入等特设（ad-hoc）的黑客逻辑。这使得 Council 侧代码耦合了协议差异。
  * **重构路线**：
    1. 自主开发 QwenPaw 原生的适配 Channel（可参考 OpenClaw 模式，采用原生 WebSocket 双向流式契约）。
    2. 在 QwenPaw 客户端侧完成 `reply.thought` (思维链)、`reply.chunk` (正文流) 及 `reply.done` 的内聚控制，并在客户端实现格式化和前导独白隔离。
    3. 在 Council 服务端侧，彻底废除 OneBot ad-hoc 兼容逻辑与 ad-hoc 正则清洗，将数据吞吐接口收拢为归一化的标准化流式事件模型。


## ⏳ 当前迭代 (Current Sprint / Active)
### IN-PROGRESS

### TODO

- [x] (2026-06-15) 🎨 体验优化：点击“提炼结论/更新结论”时，自动平滑滚动到聊天流底部“正在提炼”的取消按钮处，提供即时的操作控制反馈。
  - [x] 1. 在 `page.tsx` 的 `handleGenerateConclusion` 函数中，在设为 true 状态后延迟调用容器的滚动沉底。
  - [x] 2. 验证长消息记录下的滚动定位表现。
- [x] (2026-06-15) 🎨 体验优化：修复后台提示词管理面板中“已修改”/“默认”标签与“恢复默认”按钮视觉不对齐的缺陷
  - [x] 1. 将 `admin/page.tsx` 中 `PromptLabelHeader` 组件内的状态标签与操作按钮统一配置为 `inline-flex` 布局和等高盒模型。
  - [x] 2. 将“恢复默认”重构为纯文字下划线链接（保留对齐和抽象复用），摒弃臃肿的胶囊按钮外观。
  - [x] 3. 在 Mac 浏览器上重新验证其垂直方向的对齐效果。
- [x] (2026-06-15) 🔮 架构重构：基于插槽占位符的内部专家系统提示词（System Prompt）模板化重构
  - [x] 1. 升级 `storage-service.ts` 中的默认出厂 `expertTurnFormat` 系统提示词模板，引入 `{lens}`, `{temperament}`, `{focus}`, `{systemPrompt}`, `{intensityPrompt}` 等占位符，使其成为人设与格式的统一模板。
  - [x] 2. 在 `model-router.ts` 中废除硬编码数组 `join("\n\n")` 拼接人设特质的方式，改为在 `expertTurnFormat` 模板中执行全套插槽占位符的正则/字符串精准替换。
  - [x] 3. 运行 `npx tsc --noEmit` 进行 TypeScript 校验与格式/特质兼容替换验证。
  - [x] 4. 在后台系统提示词管理面板添加宏观出厂/自定义状态比对指示角标（🟢 出厂默认配置 / 🟡 已自定义修改），为 11 个具体的提示词字段提供独立的细粒度状态指示（🟢 默认 / 🟡 已修改）以及单项的 `[恢复默认]` 链接，并将所有繁琐参数说明 100% 补全后移入精美悬浮问号（InfoTooltip）中，同时通过全局 CSS 样式强制 `.compact-field` 的 `width: 100%` 并优化 flex 容器布局，彻底解决右侧控制项折行以及垂直方向左右错位不对齐的问题。
- [x] (2026-06-15) 🐛 缺陷修复：修复 QwenPaw 外部会话 ID 缺失导致跨会议上下文串线的问题
  - [x] 1. 在前端 `page.tsx` 发送 `request_turn` 消息时，将当前真实的 `meetingId: meeting.id` 补齐进 WebSocket 发送载荷。
  - [x] 2. 在 QwenPaw 通道 Python 适配器中验证 `session_id` 接收和多会话隔离是否表现正确。
- [x] (2026-06-15) 🎨 体验优化：修复已归档会议解除锁定后刷新页面重新锁定的问题
  - [x] 1. 在 `page.tsx` 页面挂载时通过 localStorage 读取 `DC_unlocked_meetings` 恢复已解锁的会议状态。
  - [x] 2. 引入 `useEffect` 自动将 `unlockedComposers` 的内存变更同步持久化到本地 localStorage。
- [x] (2026-06-15) 🎨 体验优化：会议列表归档与排序靠后优化 (可视化层变更)
  - [x] 1. 在 `page.tsx` 中引入 `sortedMeetings` 计算属性，基于已有的 `finalConclusion` 字段进行已归档下沉排序。
  - [x] 2. 调整侧边栏渲染，为有结论的项增加 `.is-archived` 类名，并在标题旁注入“已归档”精致角标。
  - [x] 3. 在 `globals.css` 中配置已归档卡片的降低透明度与 Hover 过渡动画。
- [x] (2026-06-15) 🐛 缺陷修复：修复专家立场卡片属性非 string (如 Array) 导致 ReactMarkdown 渲染崩溃的问题
  - [x] 1. 在 `page.tsx` 中新增 `ensureString` 辅助函数提供容错转换，将数组自动格式化为无序列表 Markdown。
  - [x] 2. 在 `page.tsx` 的专家立场卡片渲染中对这四个字段调用该函数进行防御包装。
  - [x] 3. 运行 TypeScript 全局静态检查与验证。
- [x] (2026-06-15) 🐛 缺陷修复：修复外部智能体发言提示词模板未生效的问题
  - [x] 1. 在 `ws-relay-server.ts` 中向下发的 CLP 载荷补齐 `expertName` 属性。
  - [x] 2. 在 Python 适配器 `agent_council_channel.py` 中接收并动态解析 `externalAgentPrompt`，实现占位符正则替换与平滑降级。
  - [x] 3. 运行类型校验、重新编译部署并运行仿真测试，检查模板已被成功应用。
- [x] (2026-06-15) 🔮 架构重构：将外部智能体流式尾部 JSON 拦截与清洗职责彻底上移内聚到 Council 平台并绕过 think 阶段
  - [x] 1. 废除 Python 适配器 `agent_council_channel.py` 中的冗余拦截缓冲变量，精简 `on_streaming_delta` 为纯流式透传。
  - [x] 2. 优化 `agent_council_channel.py` 中的 `on_streaming_end`，取消本地 fallback 重发机制，仅执行立场卡片提取与 DONE 回传。
  - [x] 3. 优化 Council 前端 `page.tsx` 中 `stream_chunk` 与 SSE 接收逻辑，使 think 思考阶段绕过 JSON 阻断过滤。
  - [x] 4. 强化 Council 前端 `page.tsx` 在 `stream_done` 时的统一收尾清洗能力，无论外部专家是否已传回 expertStance，都确保正文清洗干净且无 JSON 残留。
  - [x] 5. 进行端到端联调、类型检查与仿真脚本运行验证。
- [x] (2026-06-15) 🔮 架构重构：外部智能体上下文清洗与流式尾部 JSON 拦截优化
  - [x] 1. 在网关 `ws-relay-server.ts` 中清洗向 Bot 投喂的 `previousTurns` 里的 `<think>...</think>` 思维链。
  - [x] 2. 在 Python 适配器 `agent_council_channel.py` 的 prompt 组装中同样清洗 `previous_turns` 的思维链。
  - [x] 3. 在 Python 适配器 `agent_council_channel.py` 中开发流式输出 JSON 阻断过滤与安全降级释放机制。
  - [x] 4. 重编译安装插件，重启后台 QwenPaw 进程，运行仿真测试进行效果校验。
- [x] (2026-06-15) 🔮 架构重构：QwenPaw 会话唯一性归一化与流式思考 (Think) 标签补全
  - [x] 1. 将 `sender_id` 和 `session_id` 归一化为唯一 `meeting_id` 并重载 `get_to_handle_from_request` 路由以合并会话。
  - [x] 2. 升级 `on_streaming_delta` 并在 message 发送前提前主动闭合，实现对 reasoning 思考段 `<think>` 首尾标签的完美补全，保证前端流式思考折叠框即时收折。
  - [x] 3. 再次确认适配器内无任何伪流式打字机延迟代码。
- [x] (2026-06-15) 🔮 架构重构：基于第一性原理的 QwenPaw 原生 Channel 统一数据契约与原生生命周期接管改造
  - [x] 1. 物理移除 Python 通道侧 `StreamingState` 和 `StreamingTokenFilter` 自定义状态机及打字机模拟延迟，消除竞态冲突，体积缩减 60%。
  - [x] 2. 深入集成 QwenPaw `BaseChannel`，实现 `on_streaming_start`、`on_streaming_delta`、`on_streaming_end` 流式生命周期钩子，流式体验无缝对齐。
  - [x] 3. 修复接收不到会话的缺陷，改用标准的 `self._enqueue` 总线，大模型顺利启动排队。
  - [x] 4. 编写非流式 `send` 兜底切分，端到端通过仿真测试，思维链、正文、立场卡片完全验证。
- [x] (2026-06-14) 🎨 外部智能体 (小龙虾) 连通性测试与 QwenPaw 热重载、自适应重连优化
  - [x] 1. 修复 QwenPaw `AgentCouncilChannel` 构造器与 from_config 方法中由于缺失 `process` 导致的 skipped 崩溃，保证 ChannelManager 成功托管通道生命周期。
  - [x] 2. 建立 Council 后端连通性测试 API `/api/discussions/test-bot`，检测 global 连接状态。
  - [x] 3. 在 Council 专家设置弹窗 `ExpertModal.tsx` 中新增“测试连接”按钮、在线/离线指示呼吸灯及状态文字反馈。
  - [x] 4. 进行端到端联调，验证热重载实时生效、自适应自动重连以及连通状态绿/红指示准确。
- [x] (2026-06-14) 🎨 完美实现 Agent Council 通道设置面板交互设计优化与零污染 ASGI 中间件拦截持久化
  - [x] 1. 物理隐藏 IM 安全控制：完美屏蔽 8 个面向 IM 机器人的冗余参数（如 dm_policy、group_policy 等），排除干扰。
  - [x] 2. 中文别名自描述指引：以 alias 形式注入详细的中文说明，并按 [连接地址 ➔ 令牌鉴权 ➔ 流式传输] 严格排序。
  - [x] 3. 拦截单通道与批量接口：构建 `AgentCouncilConfigMiddleware` ASGI 中间件，完美拦截包含全局及多 agent 作用域（/api/agents/{agentId}/...）在内的 GET/PUT 请求，绕过 FastAPI Union 响应强转导致的 Telegram 退化缺陷。
  - [x] 4. 请求载荷流还原与持久化：在中间件中动态改写 `request._receive` 协程体，将别名自动映射还原为原生英文 Key 并完成保存，保证写入 `agent.json` 的配置没有任何中文字符或 IM 属性残留。
  - [x] 5. 端到端用例验证：在后台新部署启动的 QwenPaw 后台任务（task-3606）中成功执行了全套 REST API 联调，GET/PUT 接口响应完美对齐。
- [x] (2026-06-14) 🐛 解决并修复 QwenPaw 常规版中 Agent Council 渠道配置表单动态渲染、动态保存与 ForwardRef 启动类型校验冲突报错的致命缺陷
  - [x] 1. 热重构 Pydantic 模型：使用 `__module__` 寻址，并在运行时依次对 `NewChannelConfig`、`NewConfig` 和 `NewAgentProfileConfig` 调用 `model_rebuild()`，彻底解决了 Pydantic v2 因 ForwardRef 解析失败导致 QwenPaw 崩溃的校验冲突。
  - [x] 2. 动态塞入配置 Union 与 Class Map：动态解开 `ChannelConfigUnion` 大联合类型，把自研 `AgentCouncilConfig` 塞入其中，并在 `_CHANNEL_CONFIG_CLASS_MAP` 字典中注册映射，避免了 FastAPI 路由在 PUT 返回序列化时将自定义参数强转过滤为 Telegram 属性。
  - [x] 3. 路由层反射动态补全：对 `/config/channels` (GET) 进行 Monkey Patch 路由拦截。当通道配置在本地为空或缺少属性时，利用反射提取并向内存返回补齐的 `server_url`、`bot_token`、`streaming_enabled` 默认参数，从而成功唤醒前端 `Custom Fields` 动态表单组件的绘制。
  - [x] 4. 通道本身消除参数硬编码：在 `agent_council_channel.py` 中，使连接、鉴权、以及流控全面适配动态接收的用户配置，支持高强度的生产环境迁移。
  - [x] 5. 完成端到端联调与持久化测试，重启服务完美无报错运行，`agent.json` 持久化保存验证通过。
- [x] (2026-06-14) 🛠️ 编写卸载脚本 uninstall.sh，用于清理 QwenPaw 的自定义频道目录
- [x] (2026-06-14) 🔮 架构重构：基于第一性原理的 CLP 统一协议与 QwenPaw 原生 Channel 状态机过滤流改造
  - [x] 1. 重构 Council 中继网关 `ws-relay-server.ts`，彻底关停并移除 OneBot 所有反向连接、心跳及重连定时器冗余代码，完全净化为 CLP 事件流式转发管道。
  - [x] 2. 升级主站 `page.tsx` 里的 `stream_done` 逻辑，支持若客户端通过 CLP 的 `reply.done` 携带了 `expertStance` 字典则直接透传，跳过主站的正则清洗，完美实现服务端对智能体的“零清洗”解耦。
  - [x] 3. 重构并升级 Python 侧 QwenPaw 客户端适配器 `design_council_channel.py` 与 `adapter.py`：修改监听事件为 `turn.request`；引入 Python 侧的 `StreamingTokenFilter` 状态机，根据 Token 分发流式回传 `reply.thought` (思维流) 和 `reply.chunk` (发言流)，并在本地完美拦截和闭包提取尾部 JSON 卡片摘要，以 `reply.done(expertStance)` 形式回传给 Council。
  - [x] 4. 彻底重写前端专家自定义配置弹窗 `ExpertModal.tsx`，将旧的 OneBot 配置入口、表单输入项和复杂的反向 WS 配置教程全部抹除，精简为统一的 CLP Bot Token 认证和接入教程。
  - [x] 5. 运行 `npx tsc --noEmit` 进行 TypeScript 全量静态类型校验，成功通过无报错。
- [x] (2026-06-14) 修复外部智能体（小龙虾）发言后主持人总结卡在 thinking 的致命缺陷
  - [x] 1. 缺陷定位：小龙虾在 JSON 块后复述 Prompt 尾部垃圾 ➔ 污染历史上下文 ➔ 传染主持人模型输出非标专家 JSON ➔ 引起前端 `summary` 未定义 React 渲染崩溃 ➔ 卡死在 thinking 态。
  - [x] 2. 截断优化：升级 `content-parser.ts` 逻辑，在定位到 JSON 块后，直接将 JSON 起始点后面的所有残留碎碎念文本物理切除，防止污染历史。
  - [x] 3. 主持人防污染兜底：升级 `model-router.ts` 中的 `getSynthesis` 逻辑，强制要求解析后的主持人 JSON 包含 `summary` 键，否则丢弃并安全降级到 fallback 全文本返回，杜绝前端渲染挂起。
  - [x] 4. 通过 `npx tsc --noEmit` 进行 TypeScript 校验与本地用例仿真测试。
- [x] (2026-06-14) 外部智能体（小龙虾）基于有状态长记忆特性的“增量上下文投喂与隔离”及中文前导清洗改造
  - [x] 1. 修改 `ws-relay-server.ts`，实现基于 `expertId + meetingId` 的 OneBot `sessionUserId` 哈希隔离，确保跨会议会话干净重置。
  - [x] 2. 修改 `ws-relay-server.ts`，利用 `lastSentTurnIndices` 状态实现对外部专家（OneBot/OpenClaw）发言轮次的增量投喂与全自动归零重置。
  - [x] 3. 修改 `content-parser.ts`，引入 `[\u4e00-\u9fa5]{3,}` 正则，完美解决英文前导独白中因包含中文专家名（如 `小蔚`）导致匹配终止的 Bug。
  - [x] 4. 在 `content-parser.ts` 中新增智能剥离中文客套话、扮演确认语（如 `好的，我将扮演...`）及整行 Prompt 泄露（如 `【安全提示】...`）的防御性过滤清洗规则。
  - [x] 5. 运行 `npx tsc --noEmit` 进行 TypeScript 全量静态代码校验，成功通过无报错，并使用 `debug_parser.js` 脚本完成本地用例仿真测试。
- [x] (2026-06-14) 将外部智能体全局 System Prompt 发言模板纳入中心后台系统提示词管理
  - [x] 1. 扩展 `SystemPromptsConfig` 接口增加 `externalAgentPrompt` 字段并绑定出厂默认模板值 (`types.ts` & `storage-service.ts`)
  - [x] 2. 升级后台管理页面配置表单，提供对“外部智能体发言提示词模板”的可视化编辑与保存 (`admin/page.tsx`)
  - [x] 3. 升级前端消息传输载荷，在触发外部专家发言的 `request_turn` WebSocket 消息中包含此全局外部提示词模板 (`page.tsx`)
  - [x] 4. 重构中继网关外部消息分发与组装逻辑，支持自动对模板中的 `{question}`, `{context}`, `{previousTurns}`, `{expertName}` 进行正则动态替换，并提供向 OpenClaw 透传与空值平滑降级支持 (`ws-relay-server.ts`)
  - [x] 5. 运行 `npx tsc --noEmit` 进行全量 TypeScript 静态代码校验，成功通过无报错
- [x] (2026-06-13) 彻底解决内置专家发言换行代码块残留空行与外部专家（小龙虾）JSON 清洗失效、角色混淆与排版截断缺陷
  - [x] 1. 外部大模型思维链元数据提取套壳：在 `design_council_channel.py` (QwenPaw) 发送层自动检测 `meta` 中的 `thought` 等推理元数据，为其包裹标准的 `<think>` 标签并与正文合并回传，彻底阻断了外部 Bot 因前导独白未包裹而污染历史上下文（`previousTurns`）的现象。
  - [x] 2. 双向吞并 Markdown 代码块标记：重构前端清洗引擎 `content-parser.ts` 的 `extractAndCleanJson`，在定位到 JSON 大括号边界后，自动向上/下扩展并吞并 ```json 和 ``` 包裹标记，彻底根治未闭合代码块导致 ReactMarkdown 渲染气泡尾部空行灰色框的顽疾。
  - [x] 3. 拦截解决文字误切断与无折行滚动 Bug：发现大模型在正文中提到了 Design Council 导致 lastIndexOf("Council") 全局误杀切断发言，且残留的反单引号未闭合引起不折行显示。已将 Council 清洗优化为开头前缀正则替换 `replace(/^[\s\n]*Council\s*/i, "")`，并在返回前剥除首尾包裹的反单引号，文字恢复完整且折行完美。
  - [x] 4. 极简化管线：废除前版本粗鲁的 while 循环和暴力汉字英文独白剔除，维护数据管道的优雅高内聚。
  - [x] 5. 在控制台运行 `npx tsc --noEmit` 静态校验编译无误。
- [x] (2026-06-13) 修复专家发言中“查看思考过程”折叠按钮被过滤而消失的缺陷
  - [x] 1. 采用“提取暂存 ➔ 清洗 ➔ 头部拼回”的管道模式，让 `<think>` 块避开所有清洗规则并安全入库
  - [x] 2. 保持 ChatMessage.content 中 `<think>` 标签的存在以对齐前端细节组件的动态解析与渲染
- [x] (2026-06-13) 彻底修复多场景下立场摘要 JSON 块解析过滤失效与多角色剧本串扰缺陷
  - [x] 1. 新建前后端通用内容清洗库 `content-parser.ts` 并实现 `extractAndCleanJson`
  - [x] 2. 动态参数化剧本幻觉截断器：识别并物理切除大模型在新行脑补出的其他角色（如董事长、主持）的伪发言，杜绝历史会话污染
  - [x] 3. 倒序检索 + 括号引号自适应补齐算法：精准恢复因 Token 限制被截断的不闭合 JSON 摘要块
  - [x] 4. OneBot 网关隔离性微调：动态注入角色硬边界和剧本防脑补指令
  - [x] 5. 同端对齐前端 stream_done 与后端 model-router 非流式的清洗引擎
- [x] (2026-06-13) 修复内置专家非流式输出 JSON 过滤替换失效 Bug
- [x] (2026-06-13) 物理级网关隔离性重构与 Speaking 卡死修复
  - [x] 1. 物理连接接管（Socket Handover）机制实现，将物理 Socket 存放在全局 global 上，热重载时重新绑定事件监听器
  - [x] 2. 差异化比对单只龙虾配置（OneBot/OpenClaw），实现单点隔离热插拔，不触碰其他龙虾的连接
  - [x] 3. 剥离前端刷新/断连对后台小龙虾连接的销毁逻辑
  - [x] 4. console 重写幂等保护，杜绝重复包装与日志重复打印
*在完成任务后，将对应的条目移至此处以留档。*

- [x] (2026-06-13) 在 OneBot 客户端销毁与重置时引入 removeAllListeners 清理，规避重连定时器残留及多物理连接事件监听错乱导致的流程卡死
- [x] (2026-06-12) 解决 OneBot 多分段消息回传造成的发言流程中断与卡死问题，引入 800ms 防抖合并分段流式输出
- [x] (2026-06-12) 解决 Token 更新时外部智能体（OneBot/QwenPaw & OpenClaw/小龙虾）在线/离线状态变更延迟问题
  - [x] 校验 OneBot 客户端配置，若 Token 或 Endpoint 变更，主动断开旧连接并重新发起连接
  - [x] 遍历并审计 OpenClaw 活跃连接，若 Token 已经不在前端注册列表中，主动关闭旧 WebSocket 释放连接
- [x] (2026-06-12) 在控制台打印网关发给外部智能体（OneBot 及 OpenClaw）的完整 JSON 报文日志，并使用 logPayload 完成自动的敏感数据脱敏过滤

- [x] (2026-06-12) 修复网关 OneBot 并发重连竞态冲突与连接泄露漏洞，升级连接管理鲁棒性
- [x] (2026-06-12) 精细微调智能体编辑弹窗（ExpertModal）：增加顶部呼吸留白、轻量化 Toggle 卡片并还原原生激烈度滑动条
- [x] (2026-06-12) 解决热重载或端口占用引起的 EADDRINUSE 崩溃，并回填 globals.css 中丢失的外部智能体 Toggle 开关与在线呼吸灯样式
- [x] (2026-06-12) 解决小龙虾异常“离线”问题，优化小龙虾卡片与新建/编辑专家 UI
  - [x] 优化 WebSocket 长连接周期（减少依赖为 `[]`），在专家变化时通过 open 连接增量同步 `register_bots`
  - [x] 在后端 `ws-relay-server.ts` 和前端 `page.tsx` 中对 token 执行 `.trim()` 净化
  - [x] 为前端 `page.tsx` 内所有的 `.replace` 加上安全空值合并保护，防范 `replace of undefined` 异常
  - [x] 为外部专家设计半透明磨砂玻璃态面板外观，并为在线状态加入 `@keyframes online-pulse` 发光呼吸灯
  - [x] 精细化重构 `ExpertModal.tsx` 新建/编辑专家弹窗，将协议类型转换为选项卡 Tabs 结构，美化 Token 输入及复制重置按钮
  - [x] 将专家卡片上的“小龙虾”标识移动到名称后面
  - [x] 统一外部专家卡片被选中时的背景色与常规卡片一致（归于淡金配色 `var(--amber-soft)`）
  - [x] 将弹窗顶部接入复选框升级为带有精致滑动开关（Toggle Switch）及双行科技描述的点击卡片
- [x] (2026-06-12) 解决异常“圆桌发生异常: Cannot read properties of undefined (reading 'replace')”
  - [x] 对 `model-router.ts`、`ws-relay-server.ts` 及 `page.tsx` 中所有对消息及系统提示词 content 的 `.replace` 调用进行了 null guard 保护

- [x] (2026-06-12) 解决与 QwenPaw 交互会话持久化与立场摘要解析异常问题
  - [x] 制定 OneBot 对接上下文持久化与解析规范说明书 (.agents/docs/external-agents-integration-spec.md)
  - [x] 优化 `ws-relay-server.ts`，绑定 `sessionUserId` 到 `expertId` 确保跨会议会话连贯
  - [x] 在 `ws-relay-server.ts` 中实现 `extractOneBotMessageText` 以支持纯文本、数组及单个对象的 OneBot 消息兼容解析，杜绝 `[object Object]`
  - [x] 验证优化后小蔚能够正常完成立场卡片解析并保持历史记忆


- [x] (2026-06-12) 对接openclaw、hermes、nanobot、qwenpaw等小龙虾智能体 (仿 Telegram WebSocket 双向流式架构)
  - [x] 制定并归档外部小龙虾智能体 WebSocket 对接技术规范说明书 (.agents/docs/external-agents-integration-spec.md)
  - [x] 在平台侧实现 WebSocket 统一网关与 Bot 路由接口 (src/lib/ws-relay-server.ts, layout.tsx)
  - [x] 在管理后台/主页支持添加并配置外部 Bot 专家，生成/管理 Token (src/components/ExpertModal.tsx)
  - [x] 开发针对 OpenClaw 的 Channel 适配器插件 (packages/openclaw-channel-agent-council)
  - [x] 开发针对 QwenPaw/AgentScope 的 Python 适配器脚本 (packages/qwenpaw-adapter-agentcouncil)
  - [x] 优化 OneBot 11 协议客户端对接逻辑，加入 lifecycle 握手元事件与 heartbeat 心跳保活 (src/lib/ws-relay-server.ts)
  - [x] 修复 OneBot 连接 QwenPaw 时 Header 鉴权首部格式不匹配（Bearer 转为 Token）的 401 Bug (src/lib/ws-relay-server.ts)
  - [x] 修复因 Next.js Webpack 伪装 C++ 库引起 ws 可选依赖 bufferUtil.unmask 崩溃的 Bug (next.config.ts)

- [x] (2026-06-11) 初始化项目的全局任务文档池 `.agents/docs/project-tasks.md`
- [x] (2026-06-11) 根据需求，在系统中创建了 Task Manager 的机制设定。
- [x] (2026-06-12) 设计并应用 Task Manager Skill 机制（通过 .agents/rules 配置）。
