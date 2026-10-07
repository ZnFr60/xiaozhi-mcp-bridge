#!/bin/bash
# ============================================
#  小智 MCP 桥接 Linux 停止脚本
#  通过 PID 文件精准停止，不误杀其他项目
# ============================================
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
SERVER_PID_FILE="$APP_DIR/server.pid"
GUARDIAN_PID_FILE="$APP_DIR/guardian.pid"

echo "停止小智 MCP 桥接服务..."

stop_by_pid() {
    local pidfile="$1" name="$2"
    if [ -f "$pidfile" ]; then
        local pid
        pid=$(cat "$pidfile" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null
            fi
            echo "  已停止 $name (pid=$pid)"
        else
            echo "  $name 未在运行"
        fi
        rm -f "$pidfile"
    else
        echo "  无 $name PID 文件"
    fi
}

stop_by_pid "$GUARDIAN_PID_FILE" "桥接守护进程"
stop_by_pid "$SERVER_PID_FILE" "Web 面板"

# 兜底：清理本项目残留下来的 node 进程。
# 注意：必须用 /proc/<pid>/exe 确认目标确实是 node —— 否则命令行里恰好含
# "server.js"/"guardian-multi.js" 且 cwd 在本目录的用户终端会被一并误杀
# （实测会被误杀）。PID 文件已经足够精准，这段只是最后一道保险。
for pid in $(pgrep -f "node.*(server\.js|guardian-multi\.js|guardian\.js)" 2>/dev/null); do
    [ -d "/proc/$pid" ] || continue
    case "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" in
        */node|*/nodejs)
            if readlink -f "/proc/$pid/cwd" 2>/dev/null | grep -q "$APP_DIR"; then
                kill "$pid" 2>/dev/null
                echo "  清理残留进程 pid=$pid"
            fi
            ;;
    esac
done

echo ""
echo "服务已停止。"
