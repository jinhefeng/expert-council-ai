#!/bin/bash

# ==========================================================================
# Agent Council AI 一键服务管理脚本
# 支持命令: start, stop, restart, status, logs
# ==========================================================================

# 基础配置
PORT=3000
PID_FILE=".server.pid"
LOG_FILE="server.log"
MODE_FILE=".server.mode"

# 颜色控制台输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

log_err() {
    echo -e "${RED}[ERROR] $(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

# 检查服务是否在运行 (根据 PID 或端口检测)
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0 # 运行中
        fi
    fi
    
    # 作为二次保障，检测端口是否被 node 进程占用
    local port_pid=$(lsof -t -i:"$PORT" -sTCP:LISTEN 2>/dev/null)
    if [ ! -z "$port_pid" ]; then
        return 0 # 运行中
    fi
    
    return 1 # 未运行
}

# 启动服务
start_server() {
    local mode="debug" # 默认模式
    local mode_upper="DEBUG"
    # 循环遍历入参，支持任意顺序传入 --prod
    for arg in "$@"; do
        case "$arg" in
            --prod)
                mode="prod"
                mode_upper="PROD"
                ;;
            --debug)
                mode="debug"
                mode_upper="DEBUG"
                ;;
        esac
    done

    if is_running; then
        local running_pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -z "$running_pid" ]; then
            running_pid=$(lsof -t -i:"$PORT" -sTCP:LISTEN 2>/dev/null)
        fi
        log_warn "服务已经在运行中，PID: $running_pid。请勿重复启动。"
        return 0
    fi

    # 清理陈旧日志
    if [ -f "$LOG_FILE" ]; then
        mv "$LOG_FILE" "${LOG_FILE}.old" 2>/dev/null
    fi

    log_info "正在以 [${mode_upper}] 模式启动服务..."
    echo "${mode}" > "$MODE_FILE"

    if [ "$mode" == "prod" ]; then
        log_info "生产模式：正在执行 pnpm build 打包静态资源 (这可能需要一些时间)..."
        # 编译时需要
        pnpm build >> "$LOG_FILE" 2>&1
        if [ $? -ne 0 ]; then
            log_err "打包静态资源失败！请查看日志 $LOG_FILE 以获取详细错误。"
            exit 1
        fi
        log_info "打包成功。正在启动生产服务..."
        # 启动服务
        pnpm start >> "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
    else
        log_info "调试开发模式：正在直接启动 Next.js dev server..."
        # 启动调试服务
        pnpm dev >> "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
    fi

    # 等待服务就绪并检测端口
    log_info "正在验证服务可用性，等待端口 $PORT 被监听..."
    local count=0
    local success=1
    while [ $count -lt 15 ]; do
        sleep 1
        if lsof -i:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
            success=0
            break
        fi
        count=$((count+1))
    done

    if [ $success -eq 0 ]; then
        local final_pid=$(cat "$PID_FILE")
        log_info "服务已成功启动！"
        echo -e "${BLUE}------------------------------------------------------------${NC}"
        echo -e " 模式:    ${GREEN}${mode_upper}${NC}"
        echo -e " PID:     ${GREEN}${final_pid}${NC}"
        echo -e " 地址:    ${GREEN}http://localhost:${PORT}${NC}"
        echo -e " 日志文件: ${GREEN}${LOG_FILE}${NC}"
        echo -e "${BLUE}------------------------------------------------------------${NC}"
    else
        log_err "服务启动超时或失败！请运行 './run.sh logs' 查看最新日志输出。"
    fi
}

# 停止服务
stop_server() {
    if ! is_running; then
        log_warn "未检测到运行中的服务。"
        # 安全清理遗留的 PID 文件
        rm -f "$PID_FILE" "$MODE_FILE" 2>/dev/null
        return 0
    fi

    log_info "正在停止服务..."
    
    # 1. 尝试使用 PID 终止进程
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        log_info "向进程 PID: $pid 发送 SIGTERM..."
        kill "$pid" 2>/dev/null
        sleep 2
        
        # 强力清除
        if ps -p "$pid" > /dev/null 2>&1; then
            log_warn "进程未响应，发送强制终止信号 SIGKILL..."
            kill -9 "$pid" 2>/dev/null
            sleep 1
        fi
    fi

    # 2. 检查并强制释放端口占用
    local port_pid=$(lsof -t -i:"$PORT" -sTCP:LISTEN 2>/dev/null)
    if [ ! -z "$port_pid" ]; then
        log_warn "端口 $PORT 仍被 PID: $port_pid 占用，正在强制释放端口..."
        kill -9 "$port_pid" 2>/dev/null
        sleep 1
    fi

    # 清理状态文件
    rm -f "$PID_FILE" "$MODE_FILE" 2>/dev/null
    log_info "服务已彻底关闭。"
}

# 查看状态
status_server() {
    if is_running; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -z "$pid" ]; then
            pid=$(lsof -t -i:"$PORT" -sTCP:LISTEN 2>/dev/null)
        fi
        local raw_mode="unknown"
        if [ -f "$MODE_FILE" ]; then
            raw_mode=$(cat "$MODE_FILE")
        fi
        
        local mode=$(echo "$raw_mode" | cut -d':' -f1)

        local mode_upper="UNKNOWN"
        if [ "$mode" == "prod" ]; then
            mode_upper="PROD"
        elif [ "$mode" == "debug" ]; then
            mode_upper="DEBUG"
        fi

        log_info "服务正在运行中:"
        echo -e "  PID:  ${GREEN}${pid}${NC}"
        echo -e "  模式: ${GREEN}${mode_upper}${NC}"
        echo -e "  端口: ${GREEN}${PORT}${NC}"
        echo -e "  地址: ${GREEN}http://localhost:${PORT}${NC}"
    else
        log_info "服务处于 ${RED}已停止${NC} 状态。"
    fi
}

# 追踪查看日志
logs_server() {
    if [ -f "$LOG_FILE" ]; then
        log_info "正在追踪查看日志文件: $LOG_FILE (按 Ctrl+C 退出)..."
        echo -e "${BLUE}========================================================================${NC}"
        tail -n 30 -f "$LOG_FILE"
    else
        log_err "日志文件 $LOG_FILE 不存在！服务可能从未启动过。"
    fi
}

# 打印帮助信息
print_help() {
    echo "使用方法: $0 [Command] [Options]"
    echo ""
    echo "支持的指令 (Command):"
    echo "  start       启动服务 (默认以调试开发模式启动)"
    echo "  stop        停止服务并释放端口"
    echo "  restart     重启服务"
    echo "  status      查看服务当前运行状态"
    echo "  logs        追踪查看控制台最新日志"
    echo ""
    echo "可用的选项 (Options):"
    echo "  --prod      在 start/restart 时指定以生产编译模式运行"
    echo "  --debug     在 start/restart 时指定以开发调试模式运行 (默认)"
    echo ""
    echo "示例:"
    echo "  $0 start --prod       # 生产模式启动"
    echo "  $0 start              # 调试模式启动"
    echo "  $0 restart            # 调试模式重启"
    echo "  $0 stop               # 关闭服务"
}

# 命令路由
ACTION="$1"
case "$ACTION" in
    start)
        shift
        start_server "$@"
        ;;
    stop)
        stop_server
        ;;
    restart)
        shift
        stop_server
        sleep 1
        start_server "$@"
        ;;
    status)
        status_server
        ;;
    logs)
        logs_server
        ;;
    *)
        print_help
        ;;
esac
