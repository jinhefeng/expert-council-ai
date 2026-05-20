# Role Schema

每个角色都遵循同一套结构，方便后续自动读取、比较和训练。

## Identity

- `roleId`：和代码里的专家 id 保持一致，例如 `brand-strategist`。
- `displayName`：用户看到的名称。
- `shortTitle`：一句话职业标签。
- `soulCharacter`：原创复合型人物原型。

## Soul Character

灵魂人物应回答：

- 这个人为什么值得被请进评审会？
- 这个人天然偏爱什么？
- 这个人天然讨厌什么？
- 这个人说话是温和、直接、克制、尖锐，还是教练式？
- 这个人会在哪些问题上坚持到最后？

## Knowledge Base

知识底座分三类：

- `canonicalBooks`：经典书籍和作者。
- `methods`：方法论、框架、检查表。
- `domainHeuristics`：从真实设计工作抽象出的经验规则。

只保留摘要、框架和来源，不放长篇原文。

## Rubric

每个角色至少有：

- `mustCheck`：必须检查的事项。
- `redFlags`：明显风险信号。
- `goodSignals`：好的设计信号。
- `outputBias`：回答时优先输出什么。
- `avoid`：应该避免的回答方式。

## Examples

`examples.jsonl` 每行使用这个结构：

```json
{"id":"example-id","input":{"question":"...","context":"..."},"idealResponse":{"stance":"...","concern":"...","recommendation":"...","tradeoff":"..."},"tags":["..."]}
```

## Eval Cases

`eval-cases.json` 用于日后自动测试：

```json
{
  "roleId": "brand-strategist",
  "cases": [
    {
      "id": "case-id",
      "question": "...",
      "mustMention": ["..."],
      "shouldAvoid": ["..."]
    }
  ]
}
```
