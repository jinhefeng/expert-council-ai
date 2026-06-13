# QwenPaw / AgentScope Design Council 连接工具包

本目录提供了两种方式让您本地的 **QwenPaw** / **AgentScope** 智能体接入 `design-council-ai` 圆桌评审会议。

---

## 方式一：集成到 QwenPaw 原生频道 (推荐 - 适合 Desktop 用户)

如果您本地运行的是 macOS 的 QwenPaw Desktop 桌面版本，其工作目录实际上保存在隐藏文件夹 **`~/.copaw`** 中，对应的自定义插件目录是 **`~/.copaw/custom_channels/`**。

我们为您提供了一个自动安装脚本，可以直接将插件注册进去：

### 1. 运行一键安装脚本
在当前项目根目录下运行终端命令：
```bash
sh packages/qwenpaw-adapter-designcouncil/install.sh
```

此脚本会自动：
*   在您的个人目录下创建 `~/.copaw/custom_channels/design_council/`。
*   将 `__init__.py` 和 `design_council_channel.py` 复制进去，作为标准 Python 扩展模块。

> **手动安装（备选）**：
> 如果您不想使用脚本，可以打开 Finder（访达），按下快捷键 `Command + Shift + G`，输入 `~/.copaw/custom_channels/`，并在其中新建一个 `design_council` 文件夹，然后手动将 `__init__.py` 与 `design_council_channel.py` 拖入该文件夹中。

### 2. 配置连接参数
在您的 QwenPaw 配置文件（通常位于 `~/.copaw/settings.json` 或由 Desktop 版在设置界面中提供）的 `channels` 部分添加以下配置：
```json
{
  "channels": {
    "design_council": {
      "enabled": true,
      "serverUrl": "ws://localhost:18788/bot",
      "botToken": "YOUR_GENERATED_BOT_TOKEN_FROM_DESIGN_COUNCIL_FRONTEND"
    }
  }
}
```
*其中 `botToken` 替换为您在 `design-council-ai` 前端“新增智能体”弹窗中复制的那个 Token。*

### 3. 重新加载或重启
在桌面客户端重新加载，或者在命令行客户端运行：
```bash
qwenpaw app
```
一旦连接成功，智能体即会在平台上亮起**绿色“在线”指示灯**。

---

## 方式二：使用独立运行的适配器脚本 (轻量化)

如果您只想快速通过 Python 运行一个对接本地 Qwen 模型或 API 的独立 Agent 进程，可以使用 `adapter.py` 脚本。

### 1. 安装依赖
```bash
pip install websockets agentscope
```

### 2. 连接启动
在 Design Council 平台管理后台“新增组织级智能体”，勾选 **“作为外部自主智能体接入”**。保存并复制生成的 **`Bot Token`**。

运行以下命令启动您的 QwenPaw 智能体客户端：
```bash
python adapter.py YOUR_BOT_TOKEN ws://localhost:18788/bot
```

成功运行后，终端将输出 `[QwenPaw-Adapter] WebSocket 连接建立成功！`。当会议中轮到该专家发言时，本地脚本将自动调起模型，并将打字机效果的流式发言实时回传给圆桌会议。
