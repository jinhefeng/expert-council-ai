# 系统默认配置解耦设计说明书 (System Default Config Decoupling Spec)

此文档旨在定义如何将系统中的硬编码默认配置剥离，并统一交由一个结构化的 JSON 文件进行承载，以实现代码与配置的解耦，提升系统的可维护性与灵活性。

## 1. 业务逻辑与设计目标
- **配置集中化**：将所有零散硬编码在代码中的系统默认值（如 LLM 参数、Prompt 模板、业务默认值、预设专家角色及主持人模式）统一收拢到一个结构化的 `default-config.json` 文件中。
- **零硬编码**：相关 TypeScript 文件中不再硬编码任何配置值，而是通过导入 JSON 来提供。
- **强类型保障**：继续保持原有的 TypeScript 类型系统，静态保障 JSON 的结构完整性，若 JSON 字段有缺失或类型不匹配，在静态编译（tsc）阶段即报错。

---

## 2. 交互与配置结构设计 (API & JSON Schema)

新建配置文件：[default-config.json](file:///Users/jinhefeng/Dev/design-council-ai/src/config/default-config.json)

配置结构主要划分为以下五个部分：

```json
{
  "llmParams": {
    "maxTokens": 4000,
    "expertTemperature": 0.5,
    "synthesisTemperature": 0.3,
    "conclusionTemperature": 0.3,
    "nextSpeakerTemperature": 0.1,
    "maxAutonomousRounds": 3,
    "autonomousCountdownSeconds": 10,
    "streamInactiveTimeoutSeconds": 30,
    "expertFirstCharTimeoutSeconds": 90,
    "expertStreamTimeoutSeconds": 45
  },
  "systemPrompts": {
    "intensityLevel1": "【辩论对抗强度：完全顺从与赞同 (Level {intensity})】...",
    "intensityLevel2": "【辩论对抗强度：温和协作 (Level {intensity})】...",
    "intensityLevel3": "【辩论对抗强度：中立理性 (Level {intensity})】...",
    "intensityLevel4": "【辩论对抗强度：激烈批判 (Level {intensity})】...",
    "intensityLevel5": "【辩论对抗强度：毫不留情的开火 (Level {intensity})】...",
    "expertTurnFormat": "...",
    "synthesisPrompt": "...",
    "nextSpeakerPrompt": "...",
    "finalConclusionPrompt": "...",
    "meetingDescPrompt": "...",
    "expertDetailsPrompt": "...",
    "externalAgentPrompt": "...",
    "inquiryJudgmentPrompt": "...",
    "decisionOptionsPrompt": "...",
    "moderatorName": "平衡主持人",
    "moderatorTitle": "决策协调官",
    "expertUserPromptFormat": "...",
    "synthesisUserPromptFormat": "...",
    "nextSpeakerUserPromptFormat": "...",
    "finalConclusionUserPromptFormat": "...",
    "prevTurnsHeaderPrompt": "...",
    "prevTurnsEmptyPrompt": "...",
    "cleanThinkForSynthesis": true,
    "blockquoteFormatForTurns": true
  },
  "businessDefaults": {
    "defaultMeetingName": "核心业务方案跨职能评审会",
    "defaultMeetingDesc": "评估核心业务逻辑、架构设计与用户价值的专家圆桌会",
    "defaultExpertIds": ["ux-researcher", "brand-strategist", "growth-designer"],
    "defaultModeratorId": "balanced",
    "defaultDebateIntensity": 3,
    "defaultTurnOrderMode": "sequential"
  },
  "experts": [
    {
      "id": "brand-strategist",
      "name": "品牌策略师",
      "title": "定位与识别",
      "lens": "评估当前决策是否符合品牌长期资产与差异化定位，塑造正面受众认知。",
      "temperament": "克制、挑剔、重视长期品牌资产。",
      "focus": ["品牌资产", "市场定位", "受众感知", "情绪价值"],
      "debateIntensity": 3,
      "systemPrompt": "..."
    },
    ...
  ],
  "moderatorModes": [
    {
      "id": "balanced",
      "name": "平衡主持人",
      "description": "整理共识、分歧和稳妥决策。"
    },
    ...
  ]
}
```

---

## 3. 影响分析 (Impact Analysis)

### 3.1 受影响模块与代码文件
1. **[storage-service.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/storage-service.ts)**
   - 移除 `DEFAULT_LLM_PARAMS`、`DEFAULT_SYSTEM_PROMPTS`、`DEFAULT_BUSINESS_DEFAULTS` 的硬编码声明。
   - 替换为从 `default-config.json` 导入，并通过类型声明进行约束。
2. **[experts.ts](file:///Users/jinhefeng/Dev/design-council-ai/src/lib/experts.ts)**
   - 移除内置专家数组 `experts` 及主持人模式数组 `moderatorModes` 的硬编码。
   - 替换为从 `default-config.json` 导入。

### 3.2 兼容性与边缘情况处理
- **运行时兼容**：LocalStorage 机制维持原样不变。在用户第一次访问页面（LocalStorage 为空）时，调用 `getLLMParamsConfig` / `getSystemPromptsConfig` 等接口，它们仍会完美回退（Fallback）到我们导出的 `DEFAULT_...` 常量，只是该常量的值来源从硬编码变为了从 JSON 实时读取。
- **打包大小与性能**：JSON 文件在编译打包时由 Webpack/SWC 进行合并，不会带来额外的网络请求开销；同时读取 JSON 的消耗在微秒级别，对系统启动时间无任何感知。
- **TypeScript 强类型保证**：若 JSON 内部的配置字段有删减、缺失或类型定义不匹配，TypeScript 编译阶段即无法通过 `LLMParamsConfig` / `SystemPromptsConfig` / `BusinessDefaultsConfig` / `Expert[]` 的类型赋值校验，能够确保 100% 的静态安全。

---

## 4. 验证与回归测试计划
1. **静态编译检查**：在终端运行 `npx tsc --noEmit`，确保项目中的全部 TypeScript 代码没有因默认配置来源变更而引发类型错误。
2. **页面运行时验证**：
   - 清理浏览器的 LocalStorage，以游客模式或隐私模式访问主页面，验证默认配置是否已成功加载，是否能正常启动会议，专家设定是否与配置的 JSON 一致。
   - 打开 Admin 页面，验证是否可以成功还原默认设置（Reset to Default），并检查各项系统 Prompts 与大模型默认参数是否与 JSON 定义的初值相匹配。
