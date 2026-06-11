# Design Council AI 功能说明书总览

本文档归纳并统一了系统中分散的各项功能与交互规范（融合自原有 `discussion_process.md` 及 `streaming-interaction-spec.md`），作为系统核心业务逻辑的总干线依据。

## 1. 核心流程定义 (Main Discussion Flow)

本应用模拟了一场完整的圆桌会议，其标准流转如下：

### 1.1 触发与初始化 (User Input Phase)
- **输入收集**：用户提交核心议题 (`question`) 以及上传的背景附件（文件会被解析抽取文本送至前端内存中）。
- **流程启动判定**：系统立即终止未完成的生成事件（如果存在），根据是否勾选专家、以及是否启用了“手动点名模式”(`manual`) 进入分支。

### 1.2 专家流转调度 (Expert Turn Scheduling)
- **智能指派**：若模式为 `relevance`，调用算法根据当前语境从剩余专家候选池中筛选出一位最适合发言的人选。
- **状态更新**：立即标记该专家为 `speaking` 并在前端展现出思考动画。

### 1.3 专家观点生成阶段 (Expert Generation Phase)
这是整个产品最内核的交互：
1. **流式到达**：接收模型推送的数据流。前台通过判断首个字块到达的时间，动态隐去底部的加载动画，实现交互焦点平滑上移。
2. **深度思考分离**：
   - 使用正则匹配 `/<think>([\s\S]*?)(?:<\/think>|$)/` 对文本流截取。
   - 前端将推演过程与正式结论完全区分渲染，避免带标签的文本破坏 Markdown 样式。
3. **附带卡片结构化**：在流结束后，强制拦截尾部的 JSON 结构块，解析并分别渲染该专家的 `立场 (Stance)`、`风险 (Concern)`、`建议 (Recommendation)` 以及 `取舍分析 (Tradeoff)` 悬浮卡。

### 1.4 主持人阶段性总结 (Moderator Synthesis)
- 当一轮（候选池）所有专家发言结束时，主持人强制介入。
- 根据用户设置的主持风格，对本轮各方分歧与共识进行合并重组，给出决议建议。

### 1.5 提炼最终结论 (Final Conclusion)
- 经过多轮或充分探讨后，用户主动点击触发。
- 大模型基于全程记录，撰写完整的 Markdown 执行报告，用户可在此基础上进行最后的富文本微调。

## 2. API 定义规范 (API Specifications)

后端均使用 Next.js API Routes 承载。以下为核心路由的请求/响应规范：

| API Endpoint | Method | 核心功能 | 关键入参 | 返回数据 |
| --- | --- | --- | --- | --- |
| `/api/discussions/expert-turn` | POST | 专家单人流式论述 | `question`, `expert`, `previousTurns`, `history` | `Response(Stream)` |
| `/api/discussions/next-speaker` | POST | 预测最适合接话专家 | `question`, `previousTurns`, `candidates` | `string` (专家 ID) |
| `/api/discussions/synthesis` | POST | 总结当轮所有意见 | `question`, `expertRounds`, `history` | `JSON` (含共识/决议/汇总) |
| `/api/discussions/conclusion` | POST | 全局会议执行纪要 | `history`, `projectContext` | `Markdown` 文本 |

## 3. 边缘场景与异常处理 (Edge Cases & Fallbacks)

- **网络中断或大模型异常**：如果在请求 `callLLM` 或建立流式通道时出错，前端会捕获 Error 并终止当前 Loading 状态，同时抛出 Toast 提示错误（支持 API Key 缺失校验与底层报错透传）。
- **Token 耗尽截断**：由于推理模型（如 DeepSeek-R1 等类似规格的变体）可能会产生超过预期的 `<think>` 过程，如命中 HTTP 的 Finish Reason 为 `length`，系统将做拦截并发出异常告警，提示用户可能需要减少专家数量或调大系统的 `maxTokens`。
- **手动强中止 (Abort)**：所有与大模型的网络请求必须挂载 `AbortSignal`。用户在界面上点击中止按钮时，直接中断网络通道，保留截断前已生成的部分。

## 4. 全局系统配置管理 (System Configuration Management)

- **配置范围**：涵盖自定义大模型配置（Engine Configs）、系统工作流提示词模板（System Prompts）、大模型调度参数（LLM Params）、组织级专家库信息（包括自定义与系统覆写状态）、业务全局默认值（Business Defaults）以及当前用户档案（User Profile）。
- **配置存储**：依赖于客户端 `LocalStorage` 持久化，所有配置均附带租户 `tenantId` 隔离机制（默认租户为 `default-org`）。
- **全系统配置导出**：在管理员后台页面，允许用户一键将所有模块的配置数据整合封装为一个带有特定 `type` 与 `version` 标识的 JSON 结构，通过剪贴板复制或文件下载的方式提取，便于迁移和备份。
- **全系统配置导入**：允许管理员在后台直接粘贴或上传整体配置文件（JSON），系统将校验格式的合法性，执行全量反序列化并合并/覆盖当前本地存储中的数据，导入成功后统一刷新界面状态。
