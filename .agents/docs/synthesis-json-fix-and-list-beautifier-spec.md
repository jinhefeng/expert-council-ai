# 主持人总结 JSON 报错及卡片列表换行美化设计说明书 (Synthesis Fix Spec)

## 1. 背景与缺陷分析

在圆桌会议的实际讨论中，存在以下两点亟待优化和解决的问题：

### 缺陷一：主持人总结接口 (synthesis) 在遇到特殊字符或未转义换行符时抛出 JSON.parse 崩溃
- **成因**：`src/lib/model-router.ts` 的 `getSynthesis` 方法中，使用了非常脆弱的正则表达式匹配，并直接执行了 `JSON.parse`。大模型在输出 JSON 字段（如 `nextActions`）时，可能会产生物理折行（实际的回车键，即控制字符 ASCII 10），或者因 LaTeX 转义带来非法反斜杠。这在 JSON 标准中是不允许的。
- **后果**：直接引发 `SyntaxError: Bad control character in string literal in JSON` 崩溃，导致总结数据完全丢失并降级为默认 fallback 话术，严重损害了业务数据的结构化呈现，并在终端留下显眼的报错调用栈。

### 缺陷二：专家摘要卡片及主持人纪要卡片多行列表未折行
- **成因**：大模型输出 JSON 结构化摘要时，受限于 JSON 字段的单行属性，通常不会主动在字段值中输出换行符 `\n`，而是直接将 `1. xx； 2. xx； 3. xx` 等列表写在同一行内。这使得前端卡片渲染时文本冗长地堆砌在一起，极度影响视觉舒适度。

---

## 2. 解决方案设计

为了确保系统具备工业级工程的稳健度以及 WOW 级别的交互美感，我们设计了以下解决方案：

### 2.1 编译器级控制字符状态机与高可用 JSON 解析
在 `src/lib/content-parser.ts` 中全新封装并导出两个高内聚工具函数：

1. **`sanitizeJsonString(rawJson: string): string`**：
   - 采用编译器状态机原理，通过字符级扫描器（Lexer Scan）感知是否处于双引号包围的“字符串值内部”。
   - 当在字符串值内部遇到非转义的字面回车（`\n`、`\r`）或字面制表符（`\t`）时，**主动将它们转义为 `\\n`、`\\r`、`\\t`**。
   - 字符串外部（JSON语法层）的空白和折行则原样输出，从而 100% 解决 `Bad control character` 报错。

2. **`cleanAndParseJson<T>(jsonStr: string): T | null`**：
   - 聚合控制字符转义、LaTeX 公式反斜杠纠偏以及未闭合括号 `repairJson` 高级自愈解析机制，实现统一的 JSON 解析防线。

在 `src/lib/model-router.ts` 的 `getSynthesis` 方法中导入并调用 `cleanAndParseJson` 以全面提升主持人总结解析的健壮性。

### 2.2 智能序号与分号列表折行美化器 (List Beautifier)
在 `src/lib/content-parser.ts` 中封装并导出 `beautifyListFormatting(text: string): string`：
- **匹配规则**：匹配以分号、句号等标点符号结尾，且紧跟数字点序号或中文数字序号（如 `； 2.`、`。三、`）的模式，在序号前智能追加 `\n`。
- **排他保护**：仅在专家摘要卡片（立场观点、实施建议等）以及主持人纪要卡片的渲染端对 `ensureString` 的结果进行额外包装，完美规避对普通对话消息气泡排版的干扰。

---

## 3. 受影响模块与依赖关系

1. **解析核心**：[content-parser.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/content-parser.ts)（新增通用 JSON 安全解析器与列表美化算法）
2. **后台路由**：[model-router.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/model-router.ts)（重构 `getSynthesis` 为安全解析）
3. **前端渲染**：[page.tsx](file:///Users/jinhefeng/Dev/design-council-ai/src/app/page.tsx)（在摘要卡片与总结看板中引入 `beautifyListFormatting` 美化呈现）

---

## 4. 实施与验证计划

1. 在 `content-parser.ts` 中实现上述算法，并通过 Node.js 脚本执行回归校验。
2. 升级 `model-router.ts` 和 `page.tsx`。
3. 运行 `npx tsc --noEmit` 进行 TypeScript 编译测试。
4. 在平台发起论证，检查控制台无报错输出，且卡片排版折行精美。
