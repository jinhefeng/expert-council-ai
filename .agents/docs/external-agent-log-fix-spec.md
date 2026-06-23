# 外部智能体日志重复及载荷显示异常缺陷分析与建议解决方案 (v2)

本说明书作为项目缺陷修复的方案定义文件，详细记录了关于“外部智能体日志重复”、“载荷回显异常”以及“监控看板轮询”三个问题的深入分析、基于第一性原理的解决方案以及影响评估。

---

## 1. 缺陷分析报告 (Bug Analysis Report)

### 缺陷 1：监控看板轮询依然是 5 秒（而非 2 秒）
* **原因定位**：
  在 `src/app/monitor/page.tsx` 中，虽然前端标题和文案中写着“自动刷新 (2s)”，但是在 React `useEffect` 中，`setInterval` 的时间被硬编码为了 `5000`ms（即 5 秒）。
* **影响评估**：
  导致用户在监控面板中看到的自动刷新存在 5 秒的明显延迟，与界面宣称的 2 秒不符，影响实时调试体验。

### 缺陷 2：外部智能体日志重复生成两条
* **原因定位**：
  1. **Next.js 热重载导致旧网关逻辑常驻内存**：在 Next.js 开发（`dev`）环境下，因为网关 `WSRelayServer` 实例被保存在 `global.wsRelayServer` 进行单例保护。代码发生热更新时，由于已存在该单例，系统直接返回了旧实例，而没有重新执行类构造。这就导致**修改后的最新代码完全没有在已有网关中生效，内存里一直执行的是热重载前带有双重写入的老版本网关逻辑**。
  2. **双通道写入与去重失效**：旧网关代码的 `sendLogToMainServer` 中采用了“内存直存 + HTTP POST”的双通道写入。而且，在旧网关写入日志时，未带上唯一的 `id`，导致 `PromptLogService` 的去重逻辑在收到两次写入时（一次直存，一次 POST）因为没有 ID 属性而各自分配了随机 ID，从而生成了两条重复日志。

### 缺陷 3：“底层 API 原始载荷”未能显示最终 Prompt 拼接
* **原因定位**：
  1. **旧网关缺失 botRequestPayload**：同样因为热重载单例未更新，后台运行的旧网关代码中根本没有填充 `botRequestPayload: compiledPrompt`，导致日志持久化中的该属性自始至终为空，前端看板拉取到该条日志时只能展示等待提示语。
  2. **拼装逻辑没有得到跨端复用**：前端看板大厅在展示外部智能体最终提示词时，依赖的是日志库中字段的存盘。按第一性原理，看板展示“外部智能体喂给底层的最终组装 Prompt”应当采用 Channel 中的拼装逻辑在 GET 拉取时进行**虚拟拼装动态展示**。如果不把拼装逻辑提炼复用，就会在前端和网关各处产生“抄袭（硬编码）”逻辑，无法保持拼接格式的绝对一致性。

---

## 2. 建议解决方案 (Proposed Solutions)

### 方案 1：恢复监控看板轮询时间为 2s
* **修改目标**：[monitor/page.tsx](file:///Users/jinhefeng/Dev/design-council-ai/src/app/monitor/page.tsx)
* **修改逻辑**：
  将 `useEffect` 定时器中的时间由 `5000` 直接恢复（Revert）为 `2000`ms。

### 方案 2：归一化日志写入入口（彻底解决重复日志问题）
* **修改目标**：[ws-relay-server.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/ws-relay-server.ts)
* **修改逻辑**：
  在网关的 `sendLogToMainServer` 中，**彻底删除直存 `PromptLogService.addLog(log)` 的多余双保险逻辑，仅保留跨进程 HTTP 推送这一唯一写入源**。
  * *原因*：直存和 HTTP POST 是完全重复的操作。网关推送到主进程 API 路由后，主进程只会在 API 沙箱内通过 POST 执行一次写入，从物理机制上彻底断绝任何并发/重复日志。

### 方案 3：接管原型以支持网关热重载（从根源解决老旧逻辑无法更新的问题）
* **修改目标**：[ws-relay-server.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/ws-relay-server.ts)
* **修改逻辑**：
  1. 在 `WSRelayServer` 类中新增公开方法 `public hotReload()`，内部调用已有的 `this.handoverExistingConnections()`。
  2. 在 `createServerInstance` 实例化闭包函数中，如果发现 `global.wsRelayServer` 已存在，**直接将其原型链（`__proto__`）改写为最新加载的类原型，并触发 `hotReload()` 重新绑定事件监听器**：
     ```typescript
     createServerInstance = () => {
       if (global.wsRelayServer) {
         // 动态接管原型，平滑替换为最新代码的逻辑，并重新绑定已有连接的监听器
         Object.setPrototypeOf(global.wsRelayServer, WSRelayServer.prototype);
         global.wsRelayServer.hotReload();
       } else {
         global.wsRelayServer = new WSRelayServer();
       }
       return global.wsRelayServer;
     };
     ```
  * *原因*：这样在前端完全不断开 WebSocket 连接的前提下，后台网关事件处理器在 1 毫秒内就能平滑升级为修改后的最新代码！

### 方案 4：提取共用拼装逻辑，支持 GET 接口实时虚拟展示
* **修改目标 1**：[prompt-log-service.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/prompt-log-service.ts)
  * 将原本定义在网关内的 `compileExternalAgentPrompt` 函数彻底从网关类剥离，成为 `prompt-log-service.ts` 中的**模块级别导出辅助函数**。
  * 在 `PromptLogService.getLogs()` 获取日志时，若日志类型为 `external_bot` 且含有 `rawPayload` 属性，**自动调用该公共拼接方法，在返回列表给前端时进行“虚拟拼装展示”回填**：
    ```typescript
    getLogs(): PromptLogEntry[] {
      const rawLogs = global.promptLogsQueue || [];
      return rawLogs.map(log => {
        if (log.type === "external_bot" && log.rawPayload) {
          return {
            ...log,
            botRequestPayload: compileExternalAgentPrompt(log.rawPayload)
          };
        }
        return log;
      });
    }
    ```
* **修改目标 2**：[ws-relay-server.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/ws-relay-server.ts)
  * 导入并复用移步过来的 `compileExternalAgentPrompt` 函数，移除自己原本重复的私有定义。
  * *原因*：完全避免了前端与后端的“逻辑抄袭”，极度一致。而且“底层 API 原始载荷”不需要等待外部小龙虾回复，在小龙虾正发言时，只要 API 被请求，就会自动通过 GET 接口拼接回显出最真实的指令 Prompt 格式！

---

## 3. 潜在影响评估 (Impact Analysis)

1. **上下游依赖**：
   此项变更是对日志与中继服务的细节修补，完全不破坏任何原有的 WebSocket CLP 交互协议或业务数据接口，也不影响主站其他的内置专家发言，变更范围高度收拢，影响可控，无任何破坏性影响。
2. **逻辑冲突**：
   新逻辑仅针对 `external_bot` 的数据交换和日志写入进行增强，与 `.agents/rules/` 或现有文档中的既有规则无任何冲突。
3. **冗余检查**：
   此功能无类似实现。

---

## 4. 验证计划 (Verification Plan)

1. **静态编译校验**：
   运行 `npx tsc --noEmit`，确保无任何 TypeScript 类型报错。
2. **联调验证**：
   - 触发外部智能体小龙虾发言，在 `/monitor` 监控面板观察是否仅生成一条该轮次的外部专家日志记录，并确认无重复日志。
   - 在发言中或发言后，点击该条外部专家日志，查看“底层 API 原始载荷 (智能体回显)”Tab 页签，验证小龙虾最终的虚拟拼接 `rawPrompt` 是否已被完美展示。
   - 观察监控面板，确认其以 2s 的间隔自动刷新请求。
