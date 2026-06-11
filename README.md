# Design Council AI

一个专为设计师及产品团队打造的**本地 AI 专家圆桌会议原型**。
该工具通过调用大模型 API（支持推理模型），结合预设的多个“专家角色”与“主持人”算法，让 AI 在设定议题上展开多角度的分析、辩论与综合总结，极大提升产品架构及设计决策的全面性。

## 核心特性

- **多智能体圆桌讨论**：支持配置不同领域的专家角色（如品牌策略师、前端架构师、UX 研究员等）。
- **流式思考与推理机制**：深度集成带有 `Reasoning` 能力的大模型，支持实时渲染长考（`<think>`）过程。
- **动态发言指派与主持人决策**：基于上一轮讨论内容，智能指派下一个最合适的专家发言，最终由主持人进行综合与下一步建议。
- **本地化隐私安全与多模态支持**：完全运行在本地 Next.js 服务上，支持图片、PDF、Word 等格式文件的直接本地解析上传。
- **模型路由适配**：抽象了一层模型适配层，不仅内置千问（Qwen）流式能力，也可拓展或回退（Mock），规避网络异常。

## 快速入门

### 环境准备

1. 确保安装了 Node.js（建议 `>= 20.x`）及 `pnpm`。
2. 确保依赖已安装（`pnpm install`）。

### API Key 配置

项目需要大模型支持，目前主要接入通义千问（DashScope）与 OpenAI 标准接口。请复制 `.env.local.example` 为 `.env.local`，并填入相应的 Key：

```bash
DASHSCOPE_API_KEY=你的_QWEN_API_KEY
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus

# 如果有自定义或者 OpenAI 模型，也可以在环境变量配置
# OPENAI_API_KEY=xxx
```

*注意：应用内会优先尝试检测 `DASHSCOPE_API_KEY` 以启用真实模型，如果未检测到将可能回退到 Mock 模式或提示配置错误。*

### 启动与管理服务

本项目提供了一个全功能的一键后台管理脚本 `./run.sh`，用于快速启停及查看服务状态：

```bash
# 启动调试开发模式（默认后台运行）
./run.sh start

# 启动生产编译模式（会自动执行 pnpm build 打包）
./run.sh start --prod

# 查看当前运行状态与端口
./run.sh status

# 追踪查看后台日志输出
./run.sh logs

# 彻底停止服务
./run.sh stop
```

服务启动后，请在浏览器中打开提示的本地地址（通常为 [http://localhost:3000](http://localhost:3000)）。
*(注意：本项目在运行参数中使用了 Next.js 内置的 WASM 模块来规避某些平台对本地原生 NPM 模块的签名限制)*

## 文档索引

为了帮助开发者、使用者快速理解并深入本系统，请参考以下深度指南：

| 文档分类 | 文件路径 | 说明 |
| --- | --- | --- |
| 📖 **产品使用说明** | [product-manual.md](.agents/docs/product-manual.md) | 给最终用户看：如何设置专家角色、开启议题与阅读讨论输出。 |
| 🏗 **技术架构设计** | [architecture-design.md](.agents/docs/architecture-design.md) | 给开发人员看：系统的核心调度链路、API Route 以及 `model-router` 机制。 |
| ⚙️ **业务功能总览** | [functional-spec.md](.agents/docs/functional-spec.md) | 给项目维护者看：整理合并后的交互流、核心流程约束与边缘错误处理规范。 |

## 下一步计划 (TODO)

- [ ] 提供更多系统级别的专家预设配置（在 `roles/` 目录补充）。
- [ ] 将模型输出内容稳定 JSON 化，防止极端长考场景下正则匹配失效。
- [ ] 丰富本地记忆持久化系统，支持历史会议的归档查询。
