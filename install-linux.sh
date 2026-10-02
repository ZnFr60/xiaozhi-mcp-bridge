#!/usr/bin/env bash
# ============================================================
# 小智 AI MCP 桥接 - Linux 一键部署脚本
# Xiaozhi AI MCP Bridge - Linux One-Click Deploy
# ============================================================
set -e

PROJECT_NAME="xiaozhi-mcp-bridge"
INSTALL_DIR="${HOME}/${PROJECT_NAME}"
REPO_URL="https://github.com/ZnFr60/xiaozhi-mcp-bridge.git"
PORT=37246

# 颜色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC}  $1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   小智 AI MCP 桥接 - Linux 一键部署          ║"
echo "║   Xiaozhi AI MCP Bridge - Linux Deploy      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ---------- 1. 检查 Node.js ----------
info "检查 Node.js 环境..."
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VER"
  else
    err "Node.js 版本过低 ($NODE_VER)，需要 >= 18"
    echo "  安装方法: https://nodejs.org/ 或使用 nvm"
    exit 1
  fi
else
  err "未检测到 Node.js，请先安装 Node.js >= 18"
  echo "  安装方法: https://nodejs.org/ 或使用 nvm"
  exit 1
fi

# ---------- 2. 克隆或更新项目 ----------
if [ -d "$INSTALL_DIR" ]; then
  warn "目录已存在: $INSTALL_DIR"
  read -p "是否更新到最新版本? [Y/n] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    info "跳过更新，使用现有版本"
  else
    info "拉取最新代码..."
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || warn "git pull 失败，继续使用现有版本"
    ok "代码已更新"
  fi
else
  info "克隆项目到 $INSTALL_DIR ..."
  if command -v git &>/dev/null; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    ok "克隆完成"
  else
    err "未检测到 git，请先安装 git"
    exit 1
  fi
fi

cd "$INSTALL_DIR"

# ---------- 3. 安装依赖 ----------
info "安装 npm 依赖..."
npm install --production 2>&1 | tail -3
ok "依赖安装完成"

# ---------- 4. 配置 ----------
if [ ! -f config.js ]; then
  info "创建配置文件..."
  cp config.example.js config.js
  ok "已创建 config.js"
else
  warn "config.js 已存在，跳过"
fi

echo ""
echo "┌──────────────────────────────────────────────┐"
echo "│  接下来需要配置小智 WSS Token                  │"
echo "│  获取方式: 小智 AI 后台 → MCP 接入点           │"
echo "└──────────────────────────────────────────────┘"
echo ""
read -p "请输入小智 WSS Token (直接回车跳过): " WSS_TOKEN
if [ -n "$WSS_TOKEN" ]; then
  # 替换 config.js 中的 token
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|wss://api.xiaozhi.me/mcp/?token=YOUR_TOKEN_HERE|${WSS_TOKEN}|" config.js 2>/dev/null || true
  else
    sed -i "s|wss://api.xiaozhi.me/mcp/?token=YOUR_TOKEN_HERE|${WSS_TOKEN}|" config.js 2>/dev/null || true
  fi
  ok "Token 已写入 config.js"
else
  warn "跳过 Token 配置，请稍后手动编辑 config.js"
fi

# ---------- 5. 权限 ----------
chmod +x start.sh 2>/dev/null || true

# ---------- 6. 启动 ----------
echo ""
read -p "是否立即启动服务? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  info "启动服务..."
  nohup ./start.sh > /tmp/xiaozhi-mcp.log 2>&1 &
  sleep 2
  if curl -s "http://localhost:${PORT}/api/status" &>/dev/null; then
    ok "服务已启动!"
    echo ""
    echo "  Web 管理面板: http://localhost:${PORT}"
    echo "  日志: tail -f /tmp/xiaozhi-mcp.log"
  else
    warn "服务可能未完全启动，请检查日志"
    echo "  日志: tail -f /tmp/xiaozhi-mcp.log"
  fi
else
  info "跳过启动"
  echo ""
  echo "  手动启动: cd $INSTALL_DIR && ./start.sh"
  echo "  Web 面板:  http://localhost:${PORT}"
fi

echo ""
ok "部署完成!"
echo ""
echo "  项目目录: $INSTALL_DIR"
echo "  配置文件: $INSTALL_DIR/config.js"
echo "  自检命令: cd $INSTALL_DIR && node test-harness.js"
echo ""
