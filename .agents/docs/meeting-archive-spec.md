# 极简版会议归档展示与排序优化说明书 (Meeting Archive Spec)

本说明书用于记录 `agent-council-ai` 平台会议归档在可视化层面的展示及侧边栏会议列表排序优化的交互与样式设计规范。

根据用户反馈，本方案**不修改底层数据结构，不新增功能和API**。仅在 UI 渲染及样式层面，将已有 `finalConclusion` 字段的会议视作“已归档”，并进行视觉弱化与沉底排序。

---

## 1. 核心设计思想

为了给用户提供更加清爽、有重点的会议管理体验，平台在可视化层面进行如下优化：

*   **无感状态判定**：直接将已存在 `finalConclusion`（最终结论）的会议视为“已归档”会议，无需额外增加物理状态或按钮。
*   **列表排序下沉**：渲染侧边栏列表时，未归档会议置顶，已归档会议沉底。
*   **精致的视觉弱化**：已归档会议卡片采用降低不透明度（Opacity）和淡化字体处理，在 Hover 时平滑恢复，并展示一个符合平台调性的极简“已归档”角标。

---

## 2. 交互与视觉设计 (Interaction & UI)

### 2.1 侧边栏列表卡片 (meeting-item)

#### 视觉呈现 (Aesthetics)
1.  **卡片不透明度与过渡**：
    *   **已归档卡片样式**：带有结论的项将自动应用 `.is-archived` 类名。
    *   **正常状态**：已归档的卡片（`.meeting-item.is-archived`）拥有 `opacity: 0.65`，且文字颜色采用微暗的 `var(--muted)`。
    *   **悬停状态 (Hover)**：悬停时透明度平滑过渡到 `opacity: 0.9`，恢复可读性，展现过渡动画。
    *   **选中状态 (Active)**：若已归档的会议是当前选中会议，保留其选中的黄金边框，但依然展示已归档的透明度与状态标识。
2.  **“已归档”角标 (Badge)**：
    *   在已归档卡片的会议名称右侧，显示一个极其精致的微小角标。
    *   **样式**：使用极小的字体（`fontSize: 10px`），背景色为半透明灰色（`background: rgba(184, 134, 11, 0.08)` 或 `var(--surface-strong)`），文字为 `var(--muted)`，并带有一点精致的圆角（`borderRadius: 4px`）和内边距（`2px 6px`）。

---

## 3. 排序规则 (Sorting Logic)

渲染侧边栏列表时，根据是否含有 `finalConclusion` 进行排序计算：
1.  **第一层级（是否归档）**：未归档会议（无 `finalConclusion`）排在前面，已归档会议（有 `finalConclusion`）排在后面。
2.  **第二层级（创建时间）**：两类会议内部，均按照 `createdAt` 降序排列。

**前端计算属性 (React useMemo)**：
```typescript
const sortedMeetings = useMemo(() => {
  return [...meetings].sort((a, b) => {
    const aArchived = !!a.finalConclusion;
    const bArchived = !!b.finalConclusion;
    if (aArchived !== bArchived) {
      return aArchived ? 1 : -1; // 已归档沉底
    }
    return (b.createdAt || 0) - (a.createdAt || 0); // 倒序
  });
}, [meetings]);
```

---

## 4. 全局影响分析 (Global Impact Analysis)

### 4.1 受影响模块
*   `src/app/page.tsx`：
    *   在渲染会议列表时，改为遍历由 `meetings` 计算得出的 `sortedMeetings`。
    *   在会议项（`meeting-item`）渲染逻辑中，若 `meeting.finalConclusion` 存在，则应用 `.is-archived` 类名，并在名称右侧渲染“已归档”角标。
*   `src/app/globals.css`：
    *   增加 `.meeting-item.is-archived`、`.meeting-item-archive-badge` 及其 Hover 状态的过渡效果。

### 4.2 冲突预警
*   本方案属于纯前端的 Read-Only 级展示逻辑优化，零破坏性，无逻辑冲突风险。
