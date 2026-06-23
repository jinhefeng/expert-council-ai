# 外部智能体 LaTeX 公式转义与排版渲染优化说明书 (LaTeX Formatting Spec)

## 1. 背景与缺陷分析

在当前的 Council 平台中，外部智能体（小龙虾）在回答中会输出包含 LaTeX 语法的数学公式与参数指标（例如 `$\lambda_{trust}$`、`$\text{Score}_{base}$`、`$\sum \lambda_i D_i$` 等）。目前存在以下两个痛点导致输出格式凌乱且无法正常展示：

### 痛点一：LaTeX 宏名中的特殊字符在 JSON 解析中退化为制表符（Tab）等控制字符
- **根本原因**：在 `src/lib/content-parser.ts` 的 `extractAndCleanJson` 方法中，使用了正则：
  ```typescript
  const sanitizedJsonStr = jsonString.replace(/\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
  ```
  该正则的本意是排除合法的 JSON 转义符，防止它们被双斜杠化破坏。但是，`\t` 在 JSON 规范中是合法的转义（代表制表符 Tab）。
- **连锁反应**：当大模型输出 `\text{Score}` 或 `\trust` 时，`\t` 不在被转义的范畴。当执行 `JSON.parse` 时，解析器会将 `\t` 解释为制表符（ASCII 9）。
- **结果**：原本应该在前端显示为字面 `\text` 和 `\trust` 的文本，在解析后变成了不可见的 `Tab` 字符加上 `ext` 和 `rust`，破坏了 LaTeX 格式，且在前端表现为极宽的无意义空格缩进，格式极其凌乱。

### 痛点二：前端 ReactMarkdown 缺乏数学公式编译器
- **根本原因**：前端的 `ReactMarkdown` 仅加载了 `remarkGfm` 和 `remarkBreaks` 两个插件，没有配置公式编译相关的插件。
- **结果**：所有的公式和带 `$` 的字符只能以原始纯文本形式在气泡中杂乱堆砌，极其不专业。

---

## 2. 解决方案设计

为了从顶尖架构师的角度提供高确定性、健壮且视觉体验完美的解决方案，我们设计了以下双端配合的优化方案：

### 2.1 网关及清洗引擎转义层自愈 (后端修复)
在 `src/lib/content-parser.ts` 中，改进转义正则，将转义字符保护列表收缩为仅保护真正的语法控制和换行字符（`"`、`\`、`/`、`n`）：
```typescript
const sanitizedJsonStr = jsonString.replace(/\\(?!["\\\/n]|u[0-9a-fA-F]{4})/g, "\\\\");
```
通过排除 `t`（制表符）、`b`（退格）、`f`（换页）、`r`（回车），使得公式中的 `\text`, `\trust`, `\table` 能够被安全地转义为 `\\text`, `\\trust`，从而在 `JSON.parse` 解析后完美还原为字面反斜杠加字母。

### 2.2 前端 LaTeX 编译排版渲染集成 (前端优化)
1. **安装依赖**：
   引入 ReactMarkdown v10 兼容的数学公式解析插件：
   - `remark-math` (使用 v6 版本以确保兼容)
   - `rehype-katex` (使用 v7 版本以确保兼容)
2. **样式挂载**：
   在 `src/app/page.tsx` 中导入 `katex/dist/katex.min.css`，实现公式的矢量渲染与数学排版样式。
3. **安全容错渲染**：
   在所有的 `ReactMarkdown` 渲染实例中引入插件，并配置 `throwOnError: false` 和 `strict: false`，防止截断的公式导致页面白屏崩溃：
   ```typescript
   import remarkMath from "remark-math";
   import rehypeKatex from "rehype-katex";
   import "katex/dist/katex.min.css";

   // 渲染配置
   <ReactMarkdown 
     remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
     rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
   >
     {content}
   </ReactMarkdown>
   ```

---

## 3. 受影响模块与依赖项

1. **配置文件**：[package.json](file:///Users/jinhefeng/Dev/design-council-ai/package.json)（添加新依赖）
2. **清洗模块**：[content-parser.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/content-parser.ts)（改进转义清洗正则）
3. **渲染视图**：[page.tsx](file:///Users/jinhefeng/Dev/design-council-ai/src/app/page.tsx)（挂载渲染插件与 Katex 样式）

---

## 4. 实施与验证步骤

1. 在 `package.json` 中配置并安装 `remark-math` 和 `rehype-katex`。
2. 修改 `src/lib/content-parser.ts` 中 `extractAndCleanJson` 方法的正则，并用 Node.js 运行 scratch 测试脚本，确认公式不会被解析为制表符。
3. 升级 `src/app/page.tsx` 中所有的 `ReactMarkdown` 渲染参数。
4. 运行 `npx tsc --noEmit` 进行全量 TypeScript 静态编译检查。
5. 开启 `npm run dev` 并在前端确认 LaTeX 公式展示的美观度与排版效果。
