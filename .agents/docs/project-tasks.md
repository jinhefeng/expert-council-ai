# Project Task Manager (AI-Driven)

这是由 Antigravity (AI) 自动维护和管理的全局任务清单。
作为开发者，您可以直接修改此文件，或者在对话中吩咐 AI 帮您进行任务的拆解、更新和状态管理。

## 📍 宏观目标 (Epics / Milestones)

## ⏳ 当前迭代 (Current Sprint / Active)
### IN-PROGRESS

### TODO

## ✅ 已完成 (Done)
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
  - [x] 开发针对 OpenClaw 的 Channel 适配器插件 (packages/openclaw-channel-design-council)
  - [x] 开发针对 QwenPaw/AgentScope 的 Python 适配器脚本 (packages/qwenpaw-adapter-designcouncil)
  - [x] 优化 OneBot 11 协议客户端对接逻辑，加入 lifecycle 握手元事件与 heartbeat 心跳保活 (src/lib/ws-relay-server.ts)
  - [x] 修复 OneBot 连接 QwenPaw 时 Header 鉴权首部格式不匹配（Bearer 转为 Token）的 401 Bug (src/lib/ws-relay-server.ts)
  - [x] 修复因 Next.js Webpack 伪装 C++ 库引起 ws 可选依赖 bufferUtil.unmask 崩溃的 Bug (next.config.ts)

- [x] (2026-06-11) 初始化项目的全局任务文档池 `.agents/docs/project-tasks.md`
- [x] (2026-06-11) 根据需求，在系统中创建了 Task Manager 的机制设定。
- [x] (2026-06-12) 设计并应用 Task Manager Skill 机制（通过 .agents/rules 配置）。
