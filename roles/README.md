# Role Training Assets

这个目录存放每个专家角色的“训练资产”和“人格档案”。

目标不是直接复刻某个真实人物，而是为每个角色创造一个可维护的原创专家原型：

- 有灵魂人物：taste、偏见、语气、判断习惯。
- 有知识底座：书籍、方法论、原则和行业经验的摘要。
- 有评审标准：用于稳定输出质量的 rubric。
- 有示例样本：few-shot、训练数据或人工校准用例。
- 有评测用例：防止角色跑偏，方便日后回归测试。

## Directory Shape

```txt
roles/
  <role-id>/
    profile.md
    knowledge.md
    rubric.md
    examples.jsonl
    eval-cases.json
```

## File Purpose

- `profile.md`：角色的灵魂人物、taste、表达方式、边界。
- `knowledge.md`：知识底座，只写观点摘要和来源，不复制书籍原文。
- `rubric.md`：评审时必须检查的维度和输出偏好。
- `examples.jsonl`：一行一个示例，用于 few-shot 或后续微调数据整理。
- `eval-cases.json`：回归测试题，用于检查角色是否稳定。

## Content Policy

- 可以引用书名、作者、方法论名称和高层摘要。
- 不复制整章、长段原文或受版权保护的大段内容。
- 不把在世真实人物当作可被用户直接召唤的“本人复刻”。
- 可以用复合型虚构人物，吸收多个流派的气质和方法。

## Recommended Workflow

1. 先写 `profile.md`，确定角色灵魂和 taste。
2. 再写 `knowledge.md`，整理权威来源和观点框架。
3. 用 `rubric.md` 固化评审行为。
4. 通过 `examples.jsonl` 训练回答习惯。
5. 用 `eval-cases.json` 做回归测试。
6. 角色稳定后，再把这些资产接入 prompt 生成或模型微调。
