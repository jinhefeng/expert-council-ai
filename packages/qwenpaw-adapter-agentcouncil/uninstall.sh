#!/bin/bash

# Target directories for QwenPaw (desktop and regular versions)
COPAW_DIR="$HOME/.copaw/custom_channels/agent_council"
QWENPAW_DIR="$HOME/.qwenpaw/custom_channels/agent_council"

# 旧命名目录（都需要清理）
COPAW_OLD_1="$HOME/.copaw/custom_channels/design_council"
QWENPAW_OLD_1="$HOME/.qwenpaw/custom_channels/design_council"
COPAW_OLD_2="$HOME/.copaw/custom_channels/qwenpaw-adapter-designcouncil"
QWENPAW_OLD_2="$HOME/.qwenpaw/custom_channels/qwenpaw-adapter-designcouncil"

echo "正在为您卸载 Agent Council 频道插件..."

uninstalled=0

# Clean Copaw (Desktop version) custom channel
for dir in "$COPAW_DIR" "$COPAW_OLD_1" "$COPAW_OLD_2"; do
    if [ -d "$dir" ]; then
        echo "正在清理 Copaw (Desktop版本) 中的插件目录: $dir..."
        rm -rf "$dir"
        echo "已成功清理: $dir"
        uninstalled=$((uninstalled + 1))
    fi
done

# Clean QwenPaw (Regular CLI version) custom channel
for dir in "$QWENPAW_DIR" "$QWENPAW_OLD_1" "$QWENPAW_OLD_2"; do
    if [ -d "$dir" ]; then
        echo "正在清理 QwenPaw (常规命令行版) 中的插件目录: $dir..."
        rm -rf "$dir"
        echo "已成功清理: $dir"
        uninstalled=$((uninstalled + 1))
    fi
done

if [ $uninstalled -gt 0 ]; then
    echo "卸载成功！共清理了 $uninstalled 个插件位置。"
else
    echo "未检测到已安装的插件目录，无需清理。"
fi

echo "注：卸载插件后，QwenPaw 将不再加载该自定义频道。"
