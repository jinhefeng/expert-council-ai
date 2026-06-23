# 外部智能体单轮发言超时保护设计说明书 (Turn Timeout Guard Spec)

## 1. 背景与缺陷分析

在圆桌评审会讨论过程中，经常会出现后端（中继网关及外部智能体）已经在正常处理甚至输出，但前端界面“假死”、“无任何变化”的情况。经过深入日志复盘，定位到两个根本成因：

### 成因一：React 渲染主线程因未捕获异常崩溃挂起
- **成因**：在之前（6月12号之前）的版本中，由于大模型立场卡片解析残缺或数据非法，前端在 `messages.map` 阶段直接对 `undefined` 字段执行了 `.replace()` 调用，引发 `Uncaught TypeError: Cannot read properties of undefined (reading 'replace')` 错误。
- **后果**：这导致 React 渲染树彻底损毁挂起，前端 UI 停止接受一切 state 状态更新。即便后端 API 持续返回 200（表示讨论正常推进），前端画面也永远凝固在崩溃前一刻。
- **现状**：该缺陷已被我们近期上线的 `ensureString` 防御包装与 LaTeX 容错机制彻底根治。

### 成因二：智能体死锁或 API 请求悬空导致前端 Promise 永久 pending
- **成因**：在请求外部智能体（小龙虾）时，前端会通过 Promise 等待 WebSocket 回传数据。如果外部智能体的 API 发生死锁、网络完全阻塞，或者网关在连接异常时没有正确广播 `stream_error`。
- **后果**：前端的发言 Promise 就会无限期处于 `pending` 状态，`handleSubmitDiscussion` 的 `for` 循环流程被死死卡在 `await turnPromise` 处，前端界面长期显示“正在审视议题/深度思考”，圆桌论证进程彻底锁死。

---

## 2. 解决方案设计

为了彻底解决“智能体装死卡住评审会”的问题，保证流程的连续性与高确定性，我们设计了 **“双重发言超时保护机制 (Turn Timeout Guard)”**：

### 2.1 双重超时定时器机制
在前端 `page.tsx` 发起专家发言的 `new Promise` 内部挂载动态超时守护：
1. **启动时 - 90 秒无响应超时 (`First Chunk Timeout`)**：
   - 专家发言请求发出后，若 90 秒内无任何 `stream_chunk` 回传，主动 `reject` 该 Promise 并跳过该专家，提示用户“发言无响应超时，已跳过”。
2. **流式中 - 45 秒吐字断流超时 (`Stream Interruption Timeout`)**：
   - 大模型已开始流式吐字后，每次有新的 `onChunk` 块到达，**清空并重新设置超时定时器为 45 秒**。
   - 如果大模型在吐字过程中突然断流（如网络中断、网关挂起）超过 45 秒，立即 `reject` 并跳过该专家，确保长文本生成顺畅的前提下，绝不因中途断连而永久卡死。
3. **安全清理**：
   - 只要 Promise 正常 `resolve`、正常 `reject` 或被用户手动“叫停 (Abort)”，立即 `clearTimeout` 所有定时器，排除任何多余干扰。

---

## 3. 受影响模块与实施步骤

1. **修改文件**：[page.tsx](file:///Users/jinhefeng/Dev/design-council-ai/src/app/page.tsx)（在 `requestTurn` 专家发言 Promise 中挂载双重超时器）。
2. **实施步骤**：
   - 编写 `cleanupTimeout` 辅助方法及超时重置逻辑。
   - 运行 TypeScript 编译检查 `npx tsc --noEmit`。
   - 在前端发起讨论，人工验证超时保护是否生效。
