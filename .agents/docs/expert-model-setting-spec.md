# 专家智能体模型独立设置功能说明书 (Expert Model Setting Spec)

本说明书用于记录 `agent-council-ai` 平台中“内置专家智能体与自定义专家智能体可以单独设置所调用的模型”功能的设计、技术实现和交互规范。

---

## 1. 核心设计思想

目前平台的大模型配置均由会议室级别（全局）统一控制，这限制了在复杂评估场景下，不同领域的专家使用最适合其职能模型的灵活性。

为了实现“让最合适的模型服务最契合的智能体”，平台引入**专家大模型独立路由机制**：
* **模型配置全局化与本地化**：所有大模型的物理配置（Base URL, API Key 等）依然保持全局统一维护，完全保存在客户端浏览器 `localStorage` 中，满足多租户无状态的要求。
* **按需独立路由**：专家智能体在配置人设时，可选择“跟随会议室默认”或“指定独立大模型”。
* **无缝回退（Fallback）**：在遇到配置丢失、密钥无效、模型被删除等情况时，系统自动退回到会议室选择的全局大模型，确保发言流程 of 圆桌会议的绝对连续性。
* **无状态安全过滤**：在配置的导入导出（包括单模型配置或全站配置）时，自动过滤和防御对系统只读引擎的写入与混淆。

---

## 2. 数据结构定义 (Data Model)

在 `src/lib/types.ts` 的 `Expert` 类型中，新增以下字段支持模型独立绑定：

```typescript
export type Expert = TenantScoped & {
  // ... 既有字段 ...

  // 大模型路由配置 (新增)
  modelMode?: "default" | "custom"; // 路由模式: "default" (跟随会议室) | "custom" (指定独立大模型)
  modelId?: string;                 // 独立大模型 ID (LLMEngineConfig.id)，当 modelMode 为 "custom" 时有效
};
```

---

## 3. 技术实现方案

### 3.1 客户端模型选择器封装 (`ExpertModal.tsx`)

在智能体管理与编辑弹窗 `ExpertModal` 中，新增“大模型配置”控制区域：
1. **Prop 数据源统一**：通过 Props 显式接收 `engineConfigs: LLMEngineConfig[]` 全局配置列表，消除组件内部重复读取持久化的多余开销。
2. **控制表单**：
   - **模型配置模式 (modelMode)**：提供 Select 下拉菜单。
     - 选项一：`默认模型（跟随会议室）` -> 对应 `"default"`。
     - 选项二：`独立指定大模型` -> 对应 `"custom"`。
   - **目标大模型选择 (modelId)**：当 `modelMode` 切换为 `"custom"` 时展示该下拉菜单。仅循环渲染传入的合法自定义模型，彻底去除了 `system-env` 的硬编码。
3. **外部智能体隔离**：对于外部物理连接智能体，本配置自动隐藏，并在保存时清空。

### 3.2 客户端路由网关分发与安全复位 (`page.tsx`)

在发起专家发言请求前，针对目标专家对象 `expert` 执行动态路由解析：
* **专家发言路由**：
  ```typescript
  let targetEngineConfig = activeEngineConfig;
  if (expert.modelMode === "custom" && expert.modelId) {
    const matched = engineConfigs.find(c => c.id === expert.modelId);
    if (matched) {
      targetEngineConfig = matched;
    } else {
      console.warn(`[ModelRouter] 专家 [${expert.name}] 指定的大模型配置 ID "${expert.modelId}" 不存在。已自动退回到会议室默认模型。`);
    }
  }
  ```
* **前置防空拦截**：
  在圆桌讨论、点名发言、提炼结论的执行函数入口，前置拦截 `!activeEngineConfig` 情况，直接弹出 Alert 并优雅复位，禁止向后端发出无效空请求。
* **高可用防死锁复位**：
  在讨论大循环的 `finally` 块中强行执行 `assigningNextSpeaker[targetMeetingId] = false` 状态重置，防止请求超时、抛错时引起的 UI 动画悬挂死锁。

---

## 4. 异常情况处理与分级降级策略 (Robustness & Error Handling)

| 异常场景 | 潜在后果 | 降级机制 (Fallback Route) |
| :--- | :--- | :--- |
| **智能指派接口响应慢/超时** | 派单被挂起，讨论进程卡死。 | 1. 增设 `AbortController` 引入 6 秒强超时时限；<br>2. 超时或发生异常后，直接安全退回第一个候选专家进行顺序指派，保障流转。 |
| **独立模型配置被删除** | 匹配不到 `modelId`。 | 自动降级为会议室当前所选的全局大模型。 |
| **全站配置导入/导出** | 内存中合并的只读系统引擎被写入 localStorage。 | 1. 导出时，通过 `engineConfigs.filter(c => !c.isSystem)` 自动剔除；<br>2. 导入时在前端落库处拦截带有 `isSystem` 或 `"system-"` 前缀的模型，阻止脏数据落盘。 |

---

## 5. UI 交互设计规范

### 5.1 编辑智能体弹窗 (`ExpertModal.tsx`)
*   **控制面板**：
    在“默认辩论激烈度”滑块下方，新增大模型路由设置区域，仅在开启“独立指定大模型”时展开全局可用大模型下拉选择器。

### 5.2 侧边栏专家卡片展示
*   **高亮徽章**：
    仅在专家非外部智能体且指定了独立大模型（`modelMode === "custom" && modelId`）时，才在卡片底部渲染出琥珀色的专属大模型引擎指标；跟随会议室时完全隐藏该行，维护卡片清爽。
