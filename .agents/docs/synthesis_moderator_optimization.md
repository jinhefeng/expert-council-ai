# 主持人总结发言前缀与自称优化说明书 (Functional Spec)

## 1. 业务逻辑描述
在圆桌会议进行本轮总结时，系统会调用主持人（Moderator）生成本轮的“主持总结纪要”（Synthesis）。目前的主持人总结内容在展示给用户时，往往开头带有“【主持人】：”或“【平衡主持人】：”等生硬的前缀，或者内容中频繁出现“作为主持人，我……”等破坏讨论临场感与角色沉浸感的自称。

为了优化讨论氛围，需要：
1. **输入端限制 (Prompt-level)**：在主持人的 System Prompt 中增加严格的负向提示词，禁止其在正文中输出任何角色前缀和自称。
2. **输出端物理清洗 (Code-level)**：在主持人总结生成的解析层（`extractAndCleanModeratorJson`）增加主持人特定前缀的正则过滤，类似于已有的专家发言前缀过滤逻辑，彻底清除可能残留的 `【主持人】：`、`主持人：`、`【决策协调官】：` 以及动态主持人名字/头衔等前缀前导词。

## 2. API 与调用规范定义
修改 `extractAndCleanModeratorJson` 的函数签名，支持传入当前的 `moderatorName` 和 `moderatorTitle` 以便动态过滤：

```typescript
export function extractAndCleanModeratorJson(
  rawText: string,
  moderatorName?: string,
  moderatorTitle?: string
): {
  content: string;
  moderatorSummary: ModeratorSummary;
}
```

## 3. UI 交互流程
- 当主持人完成总结或在生成总结后，消息卡片中展示的主持人内容应当直接以总结内容开始，如“本轮讨论聚焦于……”，而不应出现“【主持人】：本轮讨论聚焦于……”的标签。
- 前端和后端的输出保持一致，清洗完全同步。

## 4. 边缘案例处理
- **未闭合 JSON 截断**：剥离前缀的逻辑应在剥离思维链（`<think>`）与最后的 JSON 纪要块之外独立且健壮地执行，不得影响由于 Token 截断导致的 JSON 自愈修复逻辑（`repairJson`）。
- **多种前缀样式兼容**：必须兼容中英文中括号、全角/半角冒号、换行等格式变体，例如：
  - `【主持人】：`
  - `主持人：`
  - `【平衡主持人】：`
  - `【决策协调官 (平衡主持人)】：`
  - `主持人发言如下：`
