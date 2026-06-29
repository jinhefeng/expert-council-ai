# 专家评审弹窗文案优化与主持人/专家流式底座归一化重构功能说明书

本说明书定义了“新建专家评审圆桌弹窗”中文案的自描述优化设计，以及“主持人总结”与“专家发言”在底层流式 SSE 消费及状态推导上的底盘级归一化复用方案。

---

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

## 2. 基于第一性原理的流式底座归一化重构 (Unified Streaming Architecture)

### A. 痛点分析
- 在之前的实现中，`requestExpertTurn` 与 `requestSynthesis` 各自包含了一套几乎完全相同的 EventStream 读取循环、看门狗守护计时器（Watchdog）、`TextDecoder` 处理、思维链识别以及 `isExtracting` 状态解析。
- 这种代码上的冗余不仅降低了可维护性，也使主持人无法享受到与专家 100% 对齐的流式提取状态，导致正文输出期间出现 Loading 抢跑等异常交互。

### B. 解决方案 (流底座归一化)
我们将提炼一个通用的底层流式消费处理器 `requestStreamingTurn`，并在 `page.tsx` 中将专家的 `requestExpertTurn` 和主持人的 `requestSynthesis` 收拢为此通用处理器的上层业务薄包装。

#### 1. 通用流底座设计 `requestStreamingTurn`
```typescript
interface StreamingTurnOptions {
  endpoint: string;
  body: any;
  signal: AbortSignal;
  streamInactiveTimeoutSeconds?: number;
  onChunk?: (text: string, isExtracting: boolean) => void;
}

async function requestStreamingTurn({
  endpoint,
  body,
  signal,
  streamInactiveTimeoutSeconds = 30,
  onChunk
}: StreamingTurnOptions): Promise<string> {
  // 1. 发起请求并读取 event-stream
  // 2. 挂载 Watchdog 计时器
  // 3. 计算 isExtracting 状态并清洗 JSON 杂质
  // 4. 返回拼接后的 fullContent
}
```

#### 2. 前端状态 100% 物理复用
在 UI 展现层和状态更新层，完全废除所有针对主持人的特设加载指示器（如 `isModSummaryExtracting`），直接复用专家的 `isStanceExtracting` 作为结构化提取的公用标志：
- **正文流式输出期间**：`isStanceExtracting` 为 `false`，界面只呈现纯净的 Markdown 打字，加载卡片及 Loading 彻底压制不予展示。
- **正文流完进入提炼提炼 JSON 时**：`isStanceExtracting` 被置为 `true`，蓝色 Loading 卡片优雅展现。
- **Done 之后**：数据到位，Loading 消失，纪要卡片瞬间接档。

这达成了真正的技术栈高内聚设计。
