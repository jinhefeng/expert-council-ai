#!/bin/bash

# Target directory for QwenPaw custom channels on macOS
TARGET_DIR="$HOME/.copaw/custom_channels/design_council"

echo "正在为您本地的 QwenPaw Desktop 版安装 Design Council 频道插件..."

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Copy files
cp packages/qwenpaw-adapter-designcouncil/__init__.py "$TARGET_DIR/__init__.py"
cp packages/qwenpaw-adapter-designcouncil/design_council_channel.py "$TARGET_DIR/design_council_channel.py"

echo "安装成功！"
echo "插件已复制到: $TARGET_DIR"
echo "请确保您已在 ~/.qwenpaw/settings.json 或 ~/.copaw/settings.json 中启用了 design_council 频道并配置了 botToken。"
