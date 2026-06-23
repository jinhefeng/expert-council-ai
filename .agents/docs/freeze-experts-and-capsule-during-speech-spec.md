# 发言进行中禁用专家席位与控制胶囊（暂停时解禁）功能说明书

本说明书定义了在 Design Council 评审会发言进行中，控制胶囊和专家席位的使用限制逻辑，以及在会话暂停时（追问面板和决策面板展示时）的解禁逻辑与数据流同步机制。

## 1. 业务逻辑与核心规则 (First-Principles Analysis)

会议进行过程中，为了保证会议的流式输出不被打断、历史上下文不发生错乱，我们引入了以下交互与状态同步逻辑：

1. **发言进行中禁用控制**：
   - 当会议处于发言阶段（`discussingMeetings[activeMeetingId]`）或提炼结论阶段（`generatingConclusions[activeMeetingId]`）时，**会议控制胶囊**（风格、机制、模式、追问开关、火力、引擎）与**专家席位**（勾选/取消勾选专家、新建专家、编辑专家、删除专家、辩论强度 range）应当被**全局禁用**。
   - 禁用时，UI 元素需表现出 `opacity: 0.5`（专家卡片为 `0.6`）、`cursor: not-allowed` 并且无法产生任何点击或修改交互。

2. **会话暂停时（追问和决策面板展示时）允许操作**：
   - 尽管会议在大方向上仍在进行中，但当流程挂起在**信息索取追问控制台**（Inquiry Console）或**决策协调看板**（Steering Console）时，属于**会话暂停态**。
   - 此时，用户应当被**允许修改**会议控制胶囊的各项配置，以及对专家席位进行增删改或勾选，以便为下一步的会议流转或下一轮的论证指定新的运行参数和发言专家。
   - 此时，UI 元素自动**恢复激活状态**（恢复明亮、恢复可交互指针）。

3. **数据流实时同步（核心加固）**：
   - 当用户在追问或决策挂起期间修改了已勾选的专家席位后，下一次发言流转（如提交追问或做出决策推进到下一轮）时，大循环必须能够**实时拉取最新的专家席位**，从而在下一步中正确指派发言人，消除由于闭包快照导致的修改不生效问题。

---

## 2. 状态推导与状态定义

我们基于第一性原理，将上述状态定义为三个清晰的计算属性：

```typescript
// 1. 会话是否处于活跃进行中（发言或提炼）
const isSessionActive = activeMeetingId 
  ? (!!discussingMeetings[activeMeetingId] || !!generatingConclusions[activeMeetingId]) 
  : false;

// 2. 会话是否处于暂停态（追问面板或决策面板正在展示中）
const isSessionPaused = activeMeetingId 
  ? (inquiryConsoleMeetingId === activeMeetingId || steeringConsoleMeetingId === activeMeetingId) 
  : false;

// 3. 配置与专家席位是否应当被禁用（活跃中 且 未暂停）
const isControlsDisabled = isSessionActive && !isSessionPaused;
```

---

## 3. UI 交互流程设计

### A. 会议控制胶囊 (Control Capsule)
- 原本所有的配置下拉框 (`select`) 在发言中被禁用是用 `disabled={isSessionActive}`。
- 升级为：`disabled={isControlsDisabled}` 且对应的 `cursor` 与 `opacity` 同样基于 `isControlsDisabled` 调整。
- **信息追问开关** 调整为：`disabled={activeMeeting.moderatorAutonomy === "autonomous" || isControlsDisabled}`。

### B. 专家席位面板 (Expert Seats Panel)
- **新建专家按钮**：
  - 属性：`disabled={!activeMeetingId || isControlsDisabled}`。
  - 样式：`opacity: (!activeMeetingId || isControlsDisabled) ? 0.5 : 1`, `cursor: (!activeMeetingId || isControlsDisabled) ? "not-allowed" : "pointer"`。
  - 提示词 `title` 联动：
    - `!activeMeetingId` => `"请先选择或创建会议"`
    - `isControlsDisabled` => `"发言进行中，无法新建智能体"`
    - 正常 => `"新建会议专属智能体"`
- **专家卡片点击（勾选/取消勾选）**：
  - 顶层 `role-card` 容器：当 `isControlsDisabled` 为 `true` 时，通过 `style={{ opacity: 0.6, transition: "opacity 0.2s" }}` 弱化，并增加类名 `is-disabled`。
  - 点击区域 `role-topline`：
    - 样式：`cursor: isControlsDisabled ? "not-allowed" : "pointer"`。
    - 点击拦截：在 `onClick` 开头增加 `if (isControlsDisabled) return;`。
- **辩论强度滑动条 (`input[type="range"]`)**：
  - 属性：`disabled={isControlsDisabled}`。
- **编辑 / 删除自定义专家按钮**：
  - 属性：`disabled={isControlsDisabled}`。
  - 点击拦截：在 `onClick` 开头增加 `if (isControlsDisabled) return;`。
  - 样式：`color: isControlsDisabled ? "var(--muted)" : "var(--amber)"`（编辑）/ `"inherit"`（删除），`cursor: isControlsDisabled ? "not-allowed" : "pointer"`, `opacity: isControlsDisabled ? 0.5 : 1`。

### C. 气泡消息重新编辑按钮 (Message Re-edit Button)
- 气泡消息（用户历史消息）右上角“重新编辑”按钮的禁用状态**保持由原有的 `isSessionActive` 决定**。
- 这意味着，即便会话在追问或决策阶段暂停（`isSessionPaused === true`），只要会议大循环仍属活跃进行状态，该编辑按钮依旧被禁用。以此防御因修改历史上下文导致大模型会话上下文错乱的致命风险。

---

## 4. 边缘用例与数据流加固

### 边缘用例 A：暂停期间增减参会专家
- **现象**：用户在追问或决策挂起时，勾选了新的专家 B，取消勾选了 A。
- **难点**：原本大循环在开始前一次性获取了 `selectedExperts` 并作为局部常量，下一轮迭代中 `nextRoundCandidates = selectedExperts.filter(...)` 会导致新增的专家 B 被漏掉，已取消的 A 仍会发言。
- **解决方案**：
  在 `handleSubmitDiscussion` 大循环内部，定义一个获取最新专家的 getter 闭包：
  ```typescript
  const getSelectedExperts = () => {
    const latestM = meetingsRef.current.find(m => m.id === targetMeetingId) || currentMeeting;
    return allExpertsRef.current.filter(e => latestM.expertIds.includes(e.id));
  };
  ```
  大循环中所有使用到参会专家列表的地方都改为调用 `getSelectedExperts()`，确保随时取得最新的勾选配置。

### 边缘用例 B：暂停期间取消勾选了所有专家
- **现象**：用户把所有已勾选的专家全部取消勾选。
- **解决方案**：在下一轮循环开始或继续时，如果检测到 `getSelectedExperts().length === 0`，循环会自动安全地跳出（`break meetingLoop`），触发主持人做最终总结，不抛出异常。

---

## 5. 影响范围与冲突评估 (Impact Analysis)

1. **依赖关系**：
   - 依赖 `meetingsRef.current` 和 `allExpertsRef.current`，由于之前它们均已被妥善定义并同步（`meetingsRef` 用于大循环状态同步，`allExpertsRef` 在 `allExperts` 变化时同步更新），可直接复用，无破坏性风险。
2. **重构影响**：
   - 只调整 `src/app/page.tsx` 中控制胶囊和专家席位的 UI 禁用条件，以及 `handleSubmitDiscussion` 中专家引用的源，对外部 API 或网关无任何影响。
3. **性能影响**：
   - 所有属性的计算属于低开销的状态求值，通过 `useMemo` 或 `getSelectedExperts` 仅在触发时求值，无冗余 Reflow 和卡顿问题。

---

## 6. 验证方案

### A. 自动化编译验证
- 运行 `npx tsc --noEmit` 确保没有引入任何 TypeScript 类型错误。

### B. 交互功能验证
1. 开启会议并输入主题，点击开始讨论。
2. 在专家发言过程中，检查控制胶囊（如发言机制、对抗强度等下拉菜单）是否被禁用且置灰。
3. 检查侧边栏专家席位，所有卡片是否稍微变灰，勾选动作被拦截，辩论强度滑动条以及编辑/删除按钮被置灰且无法操作，新建专家按钮被禁用。
4. 当会议走到“追问控制面板”或“决策协调面板”弹出并暂停时：
   - 观察控制胶囊是否解除置灰、恢复可编辑。
   - 观察专家席位卡片是否恢复明亮、新建专家按钮恢复激活。
   - 尝试在此时勾选一个原本未勾选的专家，并在控制胶囊中把对抗强度修改为其他数值。
5. 在面板中点击提交或选择选项，观察会议恢复运行。
6. 确认下一轮发言中，新勾选的专家开始发言，修改后的会议设置在发言中被应用。
