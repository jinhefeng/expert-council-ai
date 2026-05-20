# Design Council AI

一个给设计师使用的本地 AI 专家圆桌原型。

## 当前状态

- Next.js 本地网站
- 专家角色选择
- Angular / Vue 前端开发可行性评审角色
- 自定义人物角色，本地保存
- 主持模式选择
- Mock 讨论结果
- 千问 Qwen 接口预留
- 多模型适配层雏形

## Getting Started

安装依赖已经完成。运行本地开发服务：

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

本项目在 Codex 内置 Node 环境里使用 WASM + Webpack 跑 Next.js，避免 macOS 对原生 npm 模块的签名限制。

## Qwen

复制 `.env.local.example` 为 `.env.local`，填入：

```bash
DASHSCOPE_API_KEY=你的 API Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

页面里选择 `Qwen` 后，如果检测到 key，会走真实模型；否则自动回退到 mock。

## 关键文件

- `src/app/page.tsx`：本地产品界面
- `src/app/api/discussions/route.ts`：讨论 API
- `src/lib/experts.ts`：专家角色配置
- `src/lib/model-router.ts`：模型适配和讨论编排

## 下一步

1. 确认专家角色和界面结构。
2. 接入 Qwen API Key。
3. 把真实模型输出改成稳定 JSON。
4. 增加项目记忆和历史讨论。
