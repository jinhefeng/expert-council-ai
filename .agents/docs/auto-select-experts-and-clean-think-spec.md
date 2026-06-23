# 会议描述清洗功能设计说明书 (Think Clean Spec)

本文档旨在阐明会议描述辅助生成时过滤思维链 `<think>` 标签的技术实现方案。

---

## 1. 需求分析与第一性原理 (Requirement & First Principles)

### 需求：过滤辅助生成描述中的 `<think>` 内容
* **现状**：在创建会议时，用户可以使用“AI 辅助生成描述”按钮。但由于有些模型（如 DeepSeek-R1 推理模型）会把思考过程输出在 `<think>...</think>` 中，导致前端最终将这一段多余的思维链也回填进了会议描述的 TextArea 中。
* **第一性原理**：辅助生成的会议描述应当是一段供人类快速审阅、精炼且高度概括的会议背景介绍。思维链属于模型的内部推理，对最终用户是噪音。必须在 API 返回前将其从最终文本中物理剥离，并对未闭合的标签进行安全切除。

---

## 2. 交互说明书 (Interaction Spec)

### 辅助生成会议描述过滤
* **流向**：
  1. 用户在创建/编辑会议 Modal 中输入“会议主题/名称”，点击“AI辅助生成描述”按钮。
  2. 触发 API 请求，后台处理并返回干净的描述内容（已过滤 `<think>` 内容）。
  3. 前端将干净内容填入“会议描述”输入框中，用户体验非常干净，直接看到概括文字。

---

## 3. 实施计划 (Implementation Plan)

### 后端 API 改造 (`src/app/api/discussions/assist/route.ts`)
1. **清洗逻辑升级**：封装一个通用的 `cleanReasoningThink` 助手，确保 `meeting_description` 返回的 `responseText` 绝对不含 `<think>...</think>` 以及截断未闭合的内容。
2. 在返回结果前调用该清洗。

---

## 4. 验证计划 (Verification Plan)

### 自动化与接口验证
* 使用 curl 模拟调用 `/api/discussions/assist`：
  * `task: "meeting_description"`：使用推理模型，确认返回的 `result` 剔除了 `<think>` 标签。
