# 专家评审弹窗文案优化与主持人流式流畅输出功能说明书

本说明书定义了“新建专家评审圆桌弹窗”中文案的自描述优化设计，以及“主持人总结流式输出”在吐流期间过滤裸露 JSON 并流畅展示 summary 正文的前端逻辑。

## 1. 业务逻辑与文案优化 (Copy Optimization)

为了提升评审系统的专业设计感并保持全站概念术语的一致性，我们将新建/编辑会议弹窗中的不规范文案进行统一优化：

1. **弹窗标题与入口**：
   - 保持 `"新建专家评审圆桌"` 与 `"编辑会议信息"`。
   - 创建提交按钮改为：`"创建评审圆桌"`；修改提交按钮改为：`"保存圆桌设置"`。
2. **会议名称** -> 改为 **`"会议主题 / 议题名称"`**：
   - 增加 placeholder 引导：`"例如：核心支付接口防抖设计与重构方案"`。
3. **会议描述 (核心议题上下文)** -> 改为 **`"议题背景与核心上下文 (Context)"`**：
   - 增加 placeholder 引导：`"在此输入该评审议题的背景、设计草案、核心代码或面临的技术疑难，以便 AI 专家进行精准评审..."`。
4. **全局辩论强度 (1-5)** -> 改为 **`"辩论激烈程度 (1-5)"`**：
   - 增加 placeholder 引导：`"默认等级为 3。值越高，专家之间的对抗与质疑越剧烈"`。
5. **流转模式** -> 改为 **`"发言流转机制"`**（与主页面控制胶囊中的 `title="发言机制"` 以及最新功能对齐一致）：
   - 选项继续保持为：`顺序发言`、`动态指派`、`点名发言`。
6. **主持人自主度模式** -> 改为 **`"主持人决策模式"`**（与主页面控制胶囊的词汇对齐）：
   - 选项保持为：`被动传统`、`协调引导`、`自主决策`。
7. **信息索取追问环 (Inquiry Switch)** -> 改为 **`"信息自动追问 (Inquiry)"`**（与主页面控制胶囊对齐）：
   - 选项文案精炼优化为：
     - `"开启 (上下文缺失时由主持人追问澄清)"`
     - `"关闭 (忽略追问，直接总结并提炼结论)"`

---

## 2. 主持人流式流畅输出方案 (Moderator Streaming Extractor)

### A. 痛点分析
AI 主持人总结的输出是一串包含结构化纪要的 JSON。在流式传输尚未结束期间，由于大模型还在实时吐字，解析器无法将其识别为 JSON 对象渲染为纪要网格卡片，从而导致页面直接在大气泡里输出**裸露、残损的 JSON 代码段（包含大括号、转义符 `\n` 和引键）**。这在视觉与流式体验上是极其奇怪和不规范的。

### B. 解决方案 (方案 B)
在前端消息卡片组件 `ChatMessageCard` 对主持人总结气泡渲染正文前，利用一个稳健的流式 JSON 提取函数 `extractStreamingSummary(content)`：
1. 识别并定位正在输出的 JSON 中的 `"summary"` 正文键，捕获其后面的字符串正文。
2. 实时对该段正文进行转义字符还原（如把双字符 `\n` 还原为实际换行，从而让 ReactMarkdown 换行渲染）。
3. 剔除末尾可能残缺的转义字符（如斜杠 `\`），并且当吐到后续字段（如 `consensus`）时锁定提取。
4. 保证在总结流式吐字期间，气泡中展示的是**干干净净的、流畅吐出的 Markdown 文本**。

### C. 边缘用例：思维链(`<think>` 块) 隔离
- 主持人总结输出也支持思维链显示。
- 我们必须在 **提取出 `<think>` 思维链之后**，才对剩下的 JSON 内容运行 `extractStreamingSummary` 提取总结正文，确保思维链折叠框及 Loading 能够完全正常展示。

---

## 3. 代码提取算法设计

我们将在 `src/lib/content-parser.ts` 中导出以下函数：

```typescript
export function extractStreamingSummary(text: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return text; // 如果并非 JSON 结构，降级直接返回
  }

  const summaryKeyPattern = /"summary"\s*:\s*"/;
  const match = trimmed.match(summaryKeyPattern);
  if (!match) return "";

  const startIdx = (match.index ?? 0) + match[0].length;
  let endIdx = -1;
  let escape = false;

  for (let i = startIdx; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      endIdx = i;
      break;
    }
  }

  let rawSummary = "";
  if (endIdx !== -1) {
    rawSummary = trimmed.substring(startIdx, endIdx);
  } else {
    rawSummary = trimmed.substring(startIdx);
    if (rawSummary.endsWith("\\")) {
      rawSummary = rawSummary.slice(0, -1);
    }
  }

  return rawSummary
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}
```
并在 `src/components/ChatMessageCard.tsx` 中调用：
```typescript
  // 针对 AI 主持人总结消息进行流式提取 summary 正文，避免在流式期间将残损的 JSON 裸露渲染
  if (isMod && message.senderName !== "系统提示" && message.senderName !== "系统") {
    displayContent = extractStreamingJsonKey(displayContent, "summary");
  }
```

---

## 4. 主持人总结 Loading 交互与工程化组件复用 (Component Reuse)

### A. 交互对齐与设计
- **专家摘要提炼态**：当正文生成完毕后，下方会展现一张琥珀色的过渡加载卡片，内容为 `AI 决策秘书 正在提取并提炼专家立场摘要` 并附带小点脉冲动画。
- **主持人总结提炼态**：当主持人流式正文正在吐出以及总结卡片尚未生成完成时，下方将相应展现一张蓝色的过渡加载卡片，文案为 `AI 决策秘书 正在提取并提炼会议总结与纪要卡片`。

### B. 工程化组件复用设计
为了避免代码冗余，我们将原先分散在 `ChatMessageCard.tsx` 里的两套高度相似的结果卡片渲染及加载态代码，重构为一个高度内聚的通用 React 子组件：
#### `StructuredResultCard`

这个子组件接受如下属性以支持不同角色的卡片特征配置：
- `data`: 要展现的结构化字段对象（即专家的 `expertStance` 或主持人的 `moderatorSummary`）。
- `isLoading`: 对应的加载状态布尔值。
- `themeColor`: 主题颜色变量（专家为 `var(--amber)`，主持人为 `var(--blue)`）。
- `loadingText`: 加载中提示文字。
- `bgStyle`: 专属于卡片卡体背景的 CSS 样式定制。
- `fields`: 卡片需要遍历渲染的字段定义数组（包含 label 和对应的属性键名）。

在 `ChatMessageCard` 内，专家和主持人的立场卡片、纪要卡片均通过此组件以声明式方式渲染，达成 $100\%$ 的逻辑复用。

---

## 5. 影响与回归评估

- **代码结构优化**：利用 React 组件提取，将两处冗余渲染整合，减少了约 50 行重复布局代码，提高了代码的高内聚低耦合度，极易维护。
- **性能评估**：子组件纯通过属性驱动，无额外副作用，保持极致渲染性能。

