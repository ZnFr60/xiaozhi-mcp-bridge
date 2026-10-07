#!/bin/bash
# ============================================
#  小智 MCP 桥接 Linux 启动脚本 v2
#  权限绑定：本脚本以什么权限运行，所有子进程（node/mcp_exe）就继承什么权限
#  普通运行 ./start.sh        → 普通用户权限
#  sudo ./start.sh            → root 权限（全机访问）
#
#  进程管理：使用 PID 文件（server.pid / guardian.pid），不使用 pkill -f
# ============================================
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
LOG="mcp.log"
SERVER_PID_FILE="$APP_DIR/server.pid"
GUARDIAN_PID_FILE="$APP_DIR/guardian.pid"

# 权限检测
if [ "$EUID" -eq 0 ]; then
    echo "[权限] 当前为 root，所有子进程将以 root 运行（全机访问权限）"
else
    echo "[权限] 当前为普通用户 ($(whoami))，子进程继承普通用户权限"
    echo "[提示] 如需全机访问权限，请用: sudo $0"
fi

echo ""
echo "========================================"
echo "  小智 MCP 桥接启动中..."
echo "  工作目录: $APP_DIR"
echo "  用户: $(whoami) (uid=$EUID)"
echo "========================================"
echo ""

# ---------- 停止旧进程（通过 PID 文件，精准杀进程） ----------
echo "[1/3] 停止旧进程..."

stop_by_pid() {
    local pidfile="$1" name="$2"
    if [ -f "$pidfile" ]; then
        local pid
        pid=$(cat "$pidfile" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            # 确认是我们的进程（命令行含对应脚本）
            if ps -p "$pid" -o args= 2>/dev/null | grep -qE "(server\.js|guardian-multi\.js|guardian\.js)"; then
                kill "$pid" 2>/dev/null
                sleep 1
                if kill -0 "$pid" 2>/dev/null; then
                    kill -9 "$pid" 2>/dev/null
                fi
                echo "  已停止 $name (pid=$pid)"
            else
                echo "  PID $pid 不是本项目进程，跳过"
            fi
        else
            echo "  $name 未在运行 (pid=$pid)"
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

sleep 1

# ---------- 启动 UI 管理面板 ----------
echo "[2/3] 启动 Web 管理面板 (端口 37246)..."
nohup node server.js > server.log 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$SERVER_PID_FILE"
echo "  UI PID: $SERVER_PID"

sleep 2

# ---------- 启动桥接守护进程（多接入点） ----------
echo "[3/3] 启动桥接守护进程（多接入点）..."
nohup node guardian-multi.js >> "$LOG" 2>&1 &
GUARDIAN_PID=$!
# guardian-multi.js 会读 endpoints.json 并为每个接入点各起一条长连接；guardian.pid 由它自己写
echo "$GUARDIAN_PID" > "$GUARDIAN_PID_FILE"
echo "  桥接 PID: $GUARDIAN_PID"

echo ""
echo "========================================"
echo "  启动完成！"
echo "  UI 面板: http://localhost:37246"
echo "  桥接日志: $APP_DIR/$LOG"
echo "  UI 日志: $APP_DIR/server.log"
echo ""
echo "  权限: $(if [ "$EUID" -eq 0 ]; then echo 'root (全机访问)'; else echo "$(whoami) (普通用户)"; fi)"
echo "  停止服务: $APP_DIR/stop.sh  （或 kill \$(cat $GUARDIAN_PID_FILE) \$(cat $SERVER_PID_FILE)）"
echo "  查看状态: curl -s http://localhost:37246/api/status"
echo "========================================"
