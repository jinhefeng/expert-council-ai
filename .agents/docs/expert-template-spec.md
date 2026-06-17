# 内部专家特质插槽模板化重构说明书 (Expert Template Spec)

本说明书用于记录 `agent-council-ai` 平台内部专家（网页端点名发言）在大模型系统提示词（System Prompt）组装逻辑上的模板化与插槽替换重构规范。

---

## 1. 核心设计思想

为了根治大模型在生成专家回复时因“尾部偏见（Recency Bias）”而忽略专家特质设定（如性格、预设、焦点）的问题，平台废除原有的后端硬编码暴力拼接，全面转向以**后台模板为中心**的占位插槽（Slot Placeholder）精准替换方案。

*   **后台主导一切**：大模型的 System Prompt 结构完全由后台“专家发言框架格式要求”模板决定。
*   **插槽按需替换**：模板支持引入 `{expertName}`、`{lens}`、`{temperament}`、`{focus}`、`{systemPrompt}` 和 `{intensityPrompt}` 占位插槽，由后端进行自动替换。
*   **极致的人设效果**：用户可在后台自由调整特质占位符的排放位置（例如将个性和对抗强度指令移动至模板最尾部），让模型在生成时优先遵循这些强烈的个性指令，从而大幅度飙升发言质量与对抗激烈度。

---

## 2. 占位插槽定义 (Placeholders)

后台的 `expertTurnFormat` 默认模板将被赋予如下占位符：

| 占位符 | 说明 | 数据来源 | 兼容性降级处理 |
| :--- | :--- | :--- | :--- |
| `{expertName}` | 专家姓名 | `expert.name` | 默认空字符 |
| `{lens}` | 评审视角 | `expert.lens` | "全局评估" |
| `{temperament}` | 性格与气质 | `expert.temperament` | "中立冷静" |
| `{focus}` | 关注焦点列表 | `expert.focus` | "无特定焦点"（若为数组则以顿号“、”连接） |
| `{systemPrompt}` | 专家的利益立场与系统预设 | `expert.systemPrompt` | 默认空字符 |
| `{intensityPrompt}` | 本次发言的辩论对抗强度指示 | 动态计算出的强度提示词文本 | 默认 Level 3 对抗提示词 |

---

## 3. 技术实现方案

### 3.1 默认配置项重构 (`storage-service.ts`)

重构出厂设置中的 `DEFAULT_SYSTEM_PROMPTS.expertTurnFormat`，使其升级为全套插槽的融合模板：

```markdown
你当前在会议中扮演的专家角色是【{expertName}】。

【您的专业审视视角】：{lens}
【您的性格与气质表现】：{temperament}
【您本次讨论关注的重点】：{focus}

【您的底层期望与利益预设】：
{systemPrompt}

【您的发言辩论对抗强度要求】：
{intensityPrompt}

请严格基于上述设定的身份、关注点和性格语调，针对当前的评审议题发表您的见解。
请以第一人称口吻输出生动且具有对抗性的发言内容。

输出要求：
1. 包含一段直观生动的会议发言内容（content）。
2. 在发言的最后，必须提供一个纯 JSON 格式的结构化摘要（便于前端拆分展示），JSON 的 key 如下：
{
  "stance": "清晰简短的立场总结",
  "concern": "最担心的核心风险",
  "recommendation": "可执行的具体修改建议",
  "tradeoff": "为了这个决策我们必须做出的取舍/牺牲"
}
请注意：JSON 字段必须放在发言的最后，并使用 ```json ... ``` 标记包裹起来。
```

### 3.2 替换引擎实现 (`model-router.ts`)

在 `model-router.ts` 的 `getExpertTurn` 和 `getExpertTurnStream` 中，完全废除原有的硬编码数组拼接：

```typescript
// 废除旧的:
// const systemPrompt = [ expert.systemPrompt, ... ].join("\n\n");

// 采用新的插槽替换:
const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity, systemPrompts);
const focusStr = Array.isArray(expert.focus) ? expert.focus.join("、") : (expert.focus || "无特定焦点");

const systemPrompt = (systemPrompts?.expertTurnFormat ?? "")
  .replace(/{expertName}/g, expert.name || "")
  .replace(/{lens}/g, expert.lens || "全局评估")
  .replace(/{temperament}/g, expert.temperament || "中立冷静")
  .replace(/{focus}/g, focusStr)
  .replace(/{systemPrompt}/g, expert.systemPrompt || "")
  .replace(/{intensityPrompt}/g, intensityPrompt);
```

---

## 4. 兼容性与鲁棒性保障 (Robustness)

1.  **全局替换替换**：使用正则或带有全局修饰符的替换（如 `/g` 或链式 `.replace`），确保同一个占位符在模板中多次出现时都能被成功替换。
2.  **防御性空值校验**：若 `expert.focus` 意外为空或非数组，使用 `Array.isArray` 做安全类型判定并降级；其他属性如 `lens` 等如缺少值，提供合理的默认中性词，防止大模型处理 `"undefined"` 这样的垃圾词汇。
3.  **用户自定义模板向下兼容**：若用户使用的是之前的旧版自定义模板（只含有 `{expertName}`，没有其他新插槽占位符），在替换时只会静默忽略新插槽，不会引发任何代码报错，大模型也能如以往般生成回复。

---

## 5. 配置状态比对与一键重置出厂交互规范

### 5.1 细粒度（单项提示词）状态检测与指示标签 (Granular Status Indicator)

为了提供极致的掌控感和对历史缓存的透明度，系统为**每一项独立的系统提示词输入框**提供细粒度的状态检测、专属指示器以及问号悬浮说明（Tooltip）：

*   **排版换行防挤压设计**：
    控制项容器的左侧标题容器被赋予 `flex: 1`, `minWidth: 0`；而右侧的控制状态容器则被赋予 `flex-shrink: 0`, `whiteSpace: "nowrap"`, `marginLeft: "12px"`。这确保了无论左侧标题多长，右侧的“已修改”标签与“恢复默认”按钮都**绝对不会被迫换行或折字**，保持视觉上的高档感。
*   **精简参数悬浮框 (Tooltip)**：
    为了使界面极简化，输入框上方的标题中不再拖挂冗长的可用参数说明，而是统一精简为纯粹的主标题。主标题右侧跟有小问号（`InfoTooltip`）。当用户 Hover 到问号时，弹出气泡层并完整展示当前提示词可用的花括号占位符参数（例如 `{lens}`, `{temperament}` 等全部补齐写全）。
*   **状态比对与指示徽章（单项级别）**：
    在每一个输入框上方的 Label 容器右侧实时呈现状态：
    1.  **出厂默认 (未修改)**：当该字段与出厂预设完全一致时，在其上方右侧展示微型绿色胶囊标签（`color: var(--green)`, `border: 1px solid var(--green-soft)`, `background: rgba(16, 185, 129, 0.04)`）。
    2.  **已自定义 (已修改)**：当用户修改了该字段的内容，或该字段因为本地缓存残留了不包含插槽的旧配置时，在其上方右侧展示微型橙色胶囊标签（`color: var(--amber)`, `border: 1px solid var(--amber-soft)`, `background: rgba(245, 158, 11, 0.04)`）。

### 5.2 单项重置与全局重置交互 (Granular Reset vs. Global Reset)

在系统工作流提示词管理模块中，采用“单项精准控制为主，全局整体覆盖为辅”的双重重置体系：

1.  **单项恢复默认**：
    *   **触发入口**：当某项提示词处于 `已修改` 状态时，其状态指示徽章旁会伴随显示一个极简的文字链接按钮 `[恢复默认]`（琥珀色下划线字样，不带边框以保持界面的简洁与克制）。
    *   **点击动作**：点击该按钮将唤醒系统的全局确认模态框，告知：“确定要将该项提示词恢复为系统出厂配置吗？”。
    *   **确认效果**：确认后，仅将当前输入框的状态值（如 `systemPrompts.expertTurnFormat`）还原为出厂默认值，其他未重置的提示词保持不变。该输入框上方的指示标同步转绿为 `默认`。
2.  **全局一键重置**：
    *   **保留入口**：面板右上角依旧保留琥珀色警示按钮：**“重置为出厂提示词”**。
    *   **点击动作**：点击后触发全局确认模态框，警告此操作将清空该模块下所有 11 个提示词节点的自定义数据并强制全部恢复出厂默认值（适合希望一键全量升级到新版占位模板的用户）。
3.  **统一保存机制**：
    无论是单项重置、全局重置还是手动编辑输入，均需要在完成局部修改后，统一点击面板最下方的“保存提示词模板”按钮以执行 `localStorage` 的物理写入和持久化保持。



