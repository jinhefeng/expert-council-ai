# 专家智能体模型独立设置功能说明书 (Expert Model Setting Spec)

本说明书用于记录 `agent-council-ai` 平台中“内置专家智能体与自定义专家智能体可以单独设置所调用的模型”功能的设计、技术实现和交互规范。

---

## 1. 核心设计思想

目前平台的大模型配置均由会议室级别（全局）统一控制，这限制了在复杂评估场景下，不同领域的专家使用最适合其职能模型的灵活性（例如：UI 视觉专家适合使用具备多模态或高性价比的轻量模型，而技术架构专家则更适合调用具备深度推理链（Reasoning）的复杂模型）。

为了实现“让最合适的模型服务最契合的智能体”，平台引入**专家大模型独立路由机制**：
* **模型配置全局化**：所有大模型的物理配置（Base URL, API Key 等）依然保持全局统一维护，不对单个智能体重复配置密钥。
* **按需独立路由**：专家智能体在配置人设时，可选择“跟随会议室默认”或“指定独立大模型”。
* **无缝回退（Fallback）**：在遇到配置丢失、密钥无效、模型下线等异常情况时，系统必须自动执行分级降级策略，确保圆桌会议发言流程的绝对连续性。

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

### 兼容性处理
- 平台中现存的所有内置专家及已创建的自定义专家，上述新字段均默认为 `undefined`。
- 在逻辑处理中，`undefined` 将被自动视同为 `"default"`（跟随会议室配置），从而实现 100% 的向下兼容。

---

## 3. 技术实现方案

### 3.1 客户端模型选择器封装 (`ExpertModal.tsx`)

在智能体管理与编辑弹窗 `ExpertModal` 中，新增“大模型配置”控制区域：
1. **展示条件**：仅在 `draft.isExternalAgent === false`（非外部物理连接智能体）时展示。外部智能体（如 OpenClaw）由于是由其本地独立进程驱动模型，本平台的大模型路由配置对其不生效，界面中应予以隐藏。
2. **状态维护**：
   - 使用 `useEffect` 在 Modal 加载时，从 `localStorage` 的 `agent-council-engine-configs` 键中加载当前全局已配置的所有大模型列表 `engineConfigs`。
3. **控制表单**：
   - **模型配置模式 (modelMode)**：提供 Select 下拉菜单。
     - 选项一：`默认模型（跟随会议室）` -> 对应 `"default"`。
     - 选项二：`独立大模型` -> 对应 `"custom"`。
   - **目标大模型选择 (modelId)**：当 `modelMode` 切换为 `"custom"` 时展示该下拉菜单。
     - 下拉菜单包含：`系统默认模型 (system-env)` 以及从 `localStorage` 加载的所有自定义大模型名称。
     - 当选择独立大模型时，若列表为空，提示用户：“当前未配置自定义模型，请前往‘模型管理’添加”。
4. **数据提交与持久化**：
   - `onSave` 提交前，若 `modelMode` 为 `"custom"`，需校验 `modelId` 是否有值。

### 3.2 系统专家覆盖载荷适配 (`admin/page.tsx`)

在系统专家管理页面中，保存系统预置专家的覆写配置时，需要在 `overridePayload` 中包含新增的模型控制字段：

```typescript
// src/app/admin/page.tsx -> handleSaveExpert
const overridePayload: Partial<Expert> = {
  id: finalExpert.id,
  name: finalExpert.name,
  title: finalExpert.title,
  lens: finalExpert.lens,
  temperament: finalExpert.temperament,
  systemPrompt: finalExpert.systemPrompt,
  debateIntensity: finalExpert.debateIntensity,
  modelMode: finalExpert.modelMode, // 适配新增字段以实现持久化
  modelId: finalExpert.modelId,     // 适配新增字段以实现持久化
};
```

### 3.3 客户端路由网关分发 (`page.tsx`)

在发起专家发言请求前，针对目标专家对象 `expert` 执行动态路由判断，重构 `engineConfig` 的传递分发逻辑：

```typescript
// src/app/page.tsx -> handleGenerateExpertTurn
// 1. 确定会议室默认引擎配置
const meetingEngineConfig = activeEngineId === "system-env" ? undefined : activeEngineConfig;

// 2. 动态路由专家的大模型配置
let targetEngineConfig = meetingEngineConfig;

if (expert.modelMode === "custom" && expert.modelId) {
  if (expert.modelId === "system-env") {
    targetEngineConfig = undefined; // 后端将回退至系统环境变量模型
  } else {
    // 在全局模型配置列表中查找
    const matched = engineConfigs.find(c => c.id === expert.modelId);
    if (matched) {
      targetEngineConfig = matched;
    } else {
      // 异常边界回退策略：找不到指定模型，自动降级为会议室默认模型并报警
      console.warn(`[ModelRouter] 专家 [${expert.name}] 指定的大模型配置 ID "${expert.modelId}" 不存在。已自动退回到会议室默认模型 [${activeEngineConfig?.name || "系统默认"}].`);
    }
  }
}

// 3. 将 targetEngineConfig 组装进请求体的 engineConfig 字段中
const body = {
  question: userQuestion,
  projectContext: contextStr,
  expert,
  previousTurns,
  globalDebateIntensity: meeting.globalDebateIntensity,
  engineConfig: targetEngineConfig, // 动态绑定的模型引擎
  conversationHistory: history,
  llmParams,
  systemPrompts,
  userProfile,
  meetingName: meeting.name,
  meetingDesc: meeting.description,
};
```

---

## 4. 异常情况处理与分级降级策略 (Robustness & Error Handling)

作为高可用架构设计，本功能在执行时可能会遇到各种边界情况，处理规范如下：

| 异常场景 | 潜在后果 | 降级机制 (Fallback Route) |
| :--- | :--- | :--- |
| **独立模型配置被删除** | 匹配不到对应的 `modelId`，导致请求参数缺失。 | 前端检测到 `matched === undefined` 时，打印 `console.warn`，自动退回到**会议室当前选择的大模型配置**作为 fallback 发起调用。 |
| **独立模型 API Key 未配置或丢失** | 后端调用 LLM API 时返回 401 认证失败。 | 1. 后端接口报错“API Key未配置”；<br>2. 前端捕获异常后，在日志控制台输出警告，并尝试**自动以会议室默认大模型**重试请求一次；<br>3. 若重试再次失败，才向 UI 呈现 Error 卡片。 |
| **外部智能体配置了模型路由** | 出现配置概念冲突。 | 在 `ExpertModal.tsx` 中，一旦勾选“接入外部智能体”，则大模型配置模块自动隐藏，且在保存时将 `modelMode` 与 `modelId` 置为 `undefined`，消除业务逻辑上的混淆。 |
| **大模型请求限流 (Rate Limit)** | 智能体在发言时突然遭遇 429 报错崩溃。 | 提示词监控控制台 `/monitor` 将捕获这一情况。前端流式渲染器感知到网络异常中断后，提供“重新发言”或“手动重试该智能体”的按钮。 |

---

## 5. UI 交互设计规范

### 5.1 编辑智能体弹窗 (`ExpertModal.tsx`)

*   **表单布局**：
    在“默认辩论激烈度”滑块下方，新增一段配置面板 `model-router-panel`。
*   **交互控件**：
    - 面板标题：`大模型路由设置`，并配有 `InfoTooltip` 说明：“为该智能体指定专属的思考大模型，可与会议室默认模型不同。”
    - 配置卡片包含一个 Radio 或 Select。
      - Select 默认值：`跟随会议室配置（默认）`。
      - 当用户点击切换为独立模型时，下方滑动动效展开第二个 Select：`选择独立大模型`。
      - 下拉框选项形如：
        * `系统环境变量模型 (system-env)`
        * `OpenAI gpt-4o (自定义-1)`
        * `Qwen Max (自定义-2)`

### 5.2 提示词监控面板 (`/monitor` 页面)

*   **模型清晰呈现**：
    每次智能体调用 LLM 时，由于我们通过 API 请求将 `targetEngineConfig` 发送给了后端，后端的 `callLLM` 逻辑在记录 PromptLog 时会获取 `config.model` 并记录在日志中。
    在监控面板 `/monitor` 中，该条同步/流式 API 记录所展示的“模型”字段，将自动反映为该智能体具体调用的大模型，便于管理员实时分析与审查各专家智能体的实际调用链路。
