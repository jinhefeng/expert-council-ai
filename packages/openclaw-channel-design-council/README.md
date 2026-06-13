# OpenClaw Design Council Channel Plugin

这个插件能让你的 **OpenClaw (小龙虾)** 智能体作为专家节点接入 `design-council-ai` 圆桌评审会议。

## 安装方式

1. 将本文件夹拷贝到您的 OpenClaw 项目的 `extensions` 或 `plugins` 目录下：
   ```bash
   cp -r packages/openclaw-channel-design-council /path/to/openclaw/extensions/design-council
   ```

2. 在该目录下安装依赖：
   ```bash
   cd /path/to/openclaw/extensions/design-council
   npm install
   ```

## 配置小龙虾

在您的 OpenClaw 配置文件（如 `~/.openclaw/openclaw.json` 或项目根目录 `config.json`）中添加该通道配置：

```json
{
  "channels": {
    "design-council": {
      "enabled": true,
      "serverUrl": "ws://localhost:18788/bot",
      "botToken": "YOUR_GENERATED_BOT_TOKEN_FROM_DESIGN_COUNCIL_FRONTEND"
    }
  }
}
```

*把 `botToken` 替换为您在 `design-council-ai` 前端“新增智能体”弹窗中复制的那个 Token。*

## 运行

重启您的小龙虾网关：
```bash
openclaw gateway restart
```

成功启动后，小龙虾将建立与平台端口 `18788` 的 WebSocket 长连接。您会在设计评审后台看到该专家的状态变为 **“在线”**，一旦发起评审，小龙虾就会同步听到群聊并参与专业的方案评估！
