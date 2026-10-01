#!/bin/bash
# ============================================
#  小智 MCP 桥接 Linux 启动脚本
#  权限绑定：本脚本以什么权限运行，所有子进程（node/mcp_exe）就继承什么权限
#  普通运行 ./start.sh        → 普通用户权限
#  sudo ./start.sh            → root 权限（全机访问）
# ============================================
cd "$(dirname "$0")"
LOG="mcp.log"

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
echo "  工作目录: $(pwd)"
echo "  用户: $(whoami) (uid=$EUID)"
echo "========================================"
echo ""

# 停止旧进程
echo "[1/3] 停止旧进程..."
pkill -f "guardian.js" 2>/dev/null
pkill -f "server.js" 2>/dev/null
sleep 1

# 启动 UI 管理面板
echo "[2/3] 启动 UI 管理面板 (端口 37246)..."
nohup node server.js > server.log 2>&1 &
echo "  UI PID: $!"

sleep 2

# 启动桥接守护进程
echo "[3/3] 启动桥接守护进程..."
nohup node guardian.js >> "$LOG" 2>&1 &
echo "  桥接 PID: $!"

echo ""
echo "========================================"
echo "  启动完成！"
echo "  UI 面板: http://localhost:37246"
echo "  桥接日志: $(pwd)/$LOG"
echo "  UI 日志: $(pwd)/server.log"
echo ""
echo "  权限: $(if [ "$EUID" -eq 0 ]; then echo 'root (全机访问)'; else echo "$(whoami) (普通用户)"; fi)"
echo "  停止服务: pkill -f guardian.js; pkill -f server.js"
echo "========================================"
