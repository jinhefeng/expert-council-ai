#!/bin/bash

# Target directories for QwenPaw (desktop and regular versions)
COPAW_DIR="$HOME/.copaw/custom_channels/agent_council"
QWENPAW_DIR="$HOME/.qwenpaw/custom_channels/agent_council"

echo "正在为您本地的 QwenPaw 安装 Agent Council 频道插件..."

installed=0

# Determine helper paths based on current directory
INIT_SRC="__init__.py"
CHANNEL_SRC="agent_council_channel.py"

if [ ! -f "$INIT_SRC" ]; then
    INIT_SRC="packages/qwenpaw-adapter-agentcouncil/__init__.py"
    CHANNEL_SRC="packages/qwenpaw-adapter-agentcouncil/agent_council_channel.py"
fi

if [ ! -f "$INIT_SRC" ]; then
    echo "错误: 找不到 __init__.py 与 agent_council_channel.py 文件！请确保在正确的目录运行安装脚本。"
    exit 1
fi

# Install to ~/.copaw if it exists
if [ -d "$HOME/.copaw" ] || [ -d "$HOME/.copaw/custom_channels" ]; then
    echo "检测到 Copaw (Desktop版本) 目录，正在安装插件..."
    mkdir -p "$COPAW_DIR"
    cp "$INIT_SRC" "$COPAW_DIR/__init__.py"
    cp "$CHANNEL_SRC" "$COPAW_DIR/agent_council_channel.py"
    echo "已成功安装至: $COPAW_DIR"
    installed=$((installed + 1))
fi

# Install to ~/.qwenpaw if it exists
if [ -d "$HOME/.qwenpaw" ] || [ -d "$HOME/.qwenpaw/custom_channels" ] || [ $installed -eq 0 ]; then
    echo "安装至 QwenPaw (常规命令行版) 目录..."
    mkdir -p "$QWENPAW_DIR"
    cp "$INIT_SRC" "$QWENPAW_DIR/__init__.py"
    cp "$CHANNEL_SRC" "$QWENPAW_DIR/agent_council_channel.py"
    echo "已成功安装至: $QWENPAW_DIR"
    installed=$((installed + 1))
fi

echo "安装成功！共安装了 $installed 个位置。"
echo "请确保您已在 ~/.qwenpaw/settings.json 或 ~/.copaw/settings.json 中启用了 agent_council 频道并配置了 botToken。"
