#!/usr/bin/env bash
# ============================================================
# 小智 AI MCP 桥接 - Linux 一键部署脚本 v2
#
# 无人值守用法:
#   WSS_TOKEN="wss://..." ./install-linux.sh --yes
#   AUTO_START=yes WSS_TOKEN="wss://..." ./install-linux.sh --yes
# ============================================================
set -e

PROJECT_NAME="xiaozhi-mcp-bridge"
INSTALL_DIR="${HOME}/${PROJECT_NAME}"
REPO_URL="https://github.com/ZnFr60/xiaozhi-mcp-bridge.git"
PORT=37246

# 无人值守模式
UNATTENDED=0
if [[ " $* " == *" --yes "* ]] || [[ " $* " == *" -y "* ]]; then
  UNATTENDED=1
fi

# 颜色（非 TTY 时禁用）
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC}  $1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   小智 AI MCP 桥接 - Linux 一键部署 v2       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ---------- 1. 检查 Node.js ----------
info "检查 Node.js 环境..."
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node.js $NODE_VER"
  else
    err "Node.js 版本过低 ($NODE_VER)，需要 >= 20"
    echo "  安装方法: https://nodejs.org/ 或使用 nvm"
    exit 1
  fi
else
  err "未检测到 Node.js，请先安装 Node.js >= 20"
  echo "  安装方法: https://nodejs.org/ 或使用 nvm"
  exit 1
fi

# ---------- 2. 克隆或更新项目 ----------
if [ -d "$INSTALL_DIR" ]; then
  warn "目录已存在: $INSTALL_DIR"
  if [ $UNATTENDED -eq 1 ]; then
    info "无人值守模式，自动更新到最新版本"
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || warn "git pull 失败，继续使用现有版本"
    ok "代码已更新"
  else
    read -p "是否更新到最新版本? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      info "拉取最新代码..."
      cd "$INSTALL_DIR"
      git pull --ff-only 2>/dev/null || warn "git pull 失败，继续使用现有版本"
      ok "代码已更新"
    else
      info "跳过更新，使用现有版本"
      cd "$INSTALL_DIR"
    fi
  fi
else
  info "克隆项目到 $INSTALL_DIR ..."
  if command -v git &>/dev/null; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    ok "克隆完成"
    cd "$INSTALL_DIR"
  else
    err "未检测到 git，请先安装 git"
    exit 1
  fi
fi

# ---------- 3. 安装依赖 ----------
info "安装 npm 依赖..."
npm install --omit=dev 2>&1 | tail -3
ok "依赖安装完成"

# ---------- 4. 配置 token ----------
if [ ! -f config.js ]; then
  info "创建配置文件..."
  cp config.example.js config.js
  ok "已创建 config.js"
else
  warn "config.js 已存在，跳过创建"
fi

# 优先用环境变量，否则交互输入
WSS_TOKEN="${WSS_TOKEN:-}"
if [ -z "$WSS_TOKEN" ] && [ $UNATTENDED -eq 0 ]; then
  echo ""
  echo "┌──────────────────────────────────────────────┐"
  echo "│  接下来需要配置小智 WSS Token                  │"
  echo "│  获取方式: 小智 AI 后台 → MCP 接入点           │"
  echo "└──────────────────────────────────────────────┘"
  echo ""
  read -p "请输入小智 WSS Token (直接回车跳过): " WSS_TOKEN
fi

if [ -n "$WSS_TOKEN" ]; then
  # 用 node -e 安全写入（避免 sed 特殊字符问题）
  WRITE_RESULT=$(node -e "
    const fs = require('fs');
    const token = process.argv[1];
    let content = fs.readFileSync('config.js', 'utf8');
    content = content.replace(/xiaozhiWss:\s*'[^']*'/, \"xiaozhiWss: '\" + token.replace(/'/g, \"\\\\'\") + \"'\");
    fs.writeFileSync('config.js', content, 'utf8');
  " "$WSS_TOKEN" 2>&1)
  if [ $? -eq 0 ]; then
    ok "Token 已写入 config.js"
    # 验证写入
    if node -e "const c=require('./config.js'); if(!c.xiaozhiWss || c.xiaozhiWss.includes('YOUR_TOKEN_HERE')) process.exit(1);" 2>/dev/null; then
      ok "Token 验证通过"
    else
      err "Token 写入验证失败，请手动检查 config.js"
    fi
  else
    err "Token 写入失败: $WRITE_RESULT"
  fi
else
  if [ $UNATTENDED -eq 1 ]; then
    warn "无人值守模式但未设置 WSS_TOKEN，跳过 token 配置"
    warn "  请设置环境变量: export WSS_TOKEN=\"wss://...\""
  else
    warn "跳过 Token 配置，请稍后手动编辑 config.js"
  fi
fi

# ---------- 5. 权限 ----------
chmod +x start.sh 2>/dev/null || true

# ---------- 6. 启动 ----------
AUTO_START="${AUTO_START:-}"
if [ -z "$AUTO_START" ] && [ $UNATTENDED -eq 0 ]; then
  echo ""
  read -p "是否立即启动服务? [Y/n] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then AUTO_START="yes"; fi
fi

if [ "$AUTO_START" = "yes" ]; then
  info "启动服务..."
  nohup ./start.sh > /tmp/xiaozhi-mcp.log 2>&1 &
  sleep 3
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
echo "  配置命令: cd $INSTALL_DIR && node config-cli.js status"
echo "  自检命令: cd $INSTALL_DIR && node test-harness.js"
echo ""
