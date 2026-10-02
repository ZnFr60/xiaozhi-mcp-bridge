# 小智 AI MCP 桥接 / Xiaozhi AI MCP Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue.svg)]()
[![NPM](https://img.shields.io/npm/v/xiaozhi-mcp-bridge.svg)](https://www.npmjs.com/package/xiaozhi-mcp-bridge)

> 让小智 AI 通过 MCP 协议调用本机能力，支持多接入点管理、消息互发、工具自检，并提供 Web 管理面板。
> Enable Xiaozhi AI to access local capabilities via the MCP protocol, with multi-endpoint management, inter-agent messaging, self-testing, and a Web dashboard.

---

## 🇨🇳 中文

### 功能特性

- **40+ 工具**：文件操作、多引擎搜索、天气、系统命令、开发者工具、代码执行、消息互发
- **多引擎聚合搜索**：必应 + 360 双引擎并行，自动去重，完全免费无限制
- **多小智接入点管理**：Web 面板可同时配置多个小智 AI 接入点，分别启动/停止
- **消息交换机**：多个小智端之间互发消息（类邮件），支持撤回、已读位置追踪、防重复读取
- **工具自检平台**：模拟 MCP 客户端自动测试所有工具服务器，输出通过/失败报告
- **Web 管理面板**：多接入点管理、连接测试、工具测试、实时日志
- **守护进程**：异常兜底、退避重启、刷屏自愈、2 小时定期重启
- **双平台支持**：Windows（自动 UAC 提权 + 零窗口静默版）、Linux（权限绑定）
- **权限继承**：启动脚本的权限决定所有 MCP 服务进程的权限

### 架构

```
小智云端 A (wss://api.xiaozhi.me)   小智云端 B (wss://api.xiaozhi.me)
       │                                    │
       ▼                                    ▼
   mcp_exe (桥接A)                    mcp_exe (桥接B)
       │                                    │
       └────────── 共享 stdio MCP servers ──┘
              ├── filesystem   本机文件操作
              ├── web          必应+360聚合搜索 + 网页抓取
              ├── weather      Open-Meteo 天气
              ├── system       系统/命令/dsh/密码/二维码/单位换算/自检
              ├── dev          JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口
              ├── code         Python/C/Bash 代码执行
              └── message      消息交换机（≥2接入点时自动启用）

Web 管理面板 (http://localhost:37246)
       ├── 多接入点管理（添加/删除/启动/停止）
       ├── 连接测试
       ├── 本地工具测试
       └── 实时日志
```

### 快速开始

**一键部署（推荐）/ One-Click Deploy：**

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/ZnFr60/xiaozhi-mcp-bridge/main/install-linux.sh | bash

# Windows — 下载 install-windows.bat 双击运行
# https://raw.githubusercontent.com/ZnFr60/xiaozhi-mcp-bridge/main/install-windows.bat
```

**手动部署 / Manual：**

```bash
# 1. 安装依赖 / Install dependencies
cd xiaozhi-mcp-bridge
npm install

# 2. 配置小智接入点 / Configure endpoint
cp config.example.js config.js
# 编辑 config.js，填入你的小智 WSS token

# 3. Linux 启动
chmod +x start.sh
./start.sh

# 4. Windows 启动
# 双击 start-windows.bat（自动提权）
# 或 start-windows-silent.vbs（零窗口静默）
```

启动后访问 **http://localhost:37246** 打开管理面板。

### 命令行配置

除了 Web 面板，也可用命令行管理接入点：

```bash
# 查看配置状态
node config-cli.js status

# 添加接入点（添加第2个后消息交换机自动启用）
node config-cli.js add "我的小智" "wss://api.xiaozhi.me/mcp/?token=xxx"

# 列出所有接入点
node config-cli.js list

# 删除接入点
node config-cli.js remove <接入点ID>

# 设置默认接入点 token（写入 config.js）
node config-cli.js token "wss://api.xiaozhi.me/mcp/?token=xxx"
```

### 工具列表

| 服务器 | 工具数 | 说明 |
|--------|--------|------|
| filesystem | - | 本机文件读写/列出/搜索 |
| web | 3 | 多引擎聚合搜索、网页抓取、搜索状态 |
| weather | 1 | 当前天气 + 5天预报 |
| system | 11 | 系统状态、时间、记事本、命令执行、dsh、密码生成、二维码、单位换算、**自检** |
| dev | 12 | JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口检测 |
| code | 5 | Python/C/Bash 执行、写文件、环境信息 |
| message | 2 | **消息收发**（≥2个接入点时自动启用，支持撤回/已读追踪） |

### 消息交换机

当系统检测到 **≥2 个小智接入点**时，自动启用以下两个工具：

- **send_message**：发送消息（`action=send`）、撤回消息（`action=recall`）、列出用户（`action=list_users`）
- **read_messages**：读取新消息（`action=read`，自动更新已读位置防重复）、列收件箱/发件箱、查看/重置已读位置

消息以 JSON 文件轻量存储（每用户3个文件），撤回不删除消息而是标记 `recalled=true`。

### 工具自检

```bash
# 命令行运行完整自检
node test-harness.js

# 只测试某个服务器
node test-harness.js system

# JSON 格式输出
node test-harness.js --json
```

小智端也可直接调用 `run_self_test` 工具触发自检。

### 关键注意事项

1. **zod 版本锁定**：`zod@3.25.76` 同时写在 `dependencies` 和 `overrides` 中（双重保障），全局安装时也能生效，否则 mcp_exe 报 `_fieldsToZodSchema` 错误
2. **mcp.json 动态生成**：启动时 guardian.js 从 `mcp.template.json` 自动生成 `mcp.json`，所有路径基于安装目录动态解析，无需手动修改
3. **token 保密**：小智 WSS token 存储在 `config.js`，已加入 `.gitignore`，不会提交到公开仓库
4. **搜索**：必应 + 360 双引擎聚合，百度/搜狗反爬严格无法抓取
5. **守护机制**：30秒启动宽限期 + 刷屏自愈（阈值100KB/10s）+ 2小时定期重启
6. **UI 端口**：默认 37246，可通过环境变量 `PORT` 修改
7. **消息工具**：仅在配置 ≥2 个接入点时出现，单个接入点时自动隐藏
8. **代理环境**：mcp_exe 的 WebSocket 默认不支持 HTTP 代理，有代理的环境需用 proxychains 等工具包装或在无代理环境运行

---

## 🇬🇧 English

### Features

- **40+ tools**: file operations, multi-engine search, weather, system commands, dev tools, code execution, inter-agent messaging
- **Multi-engine aggregated search**: Bing + 360 parallel fetching, auto-dedup, completely free with no limits
- **Multi-endpoint management**: configure and manage multiple Xiaozhi AI endpoints from the Web dashboard
- **Message exchange**: send messages between Xiaozhi agents (email-like), with recall, read-position tracking, and duplicate prevention
- **Self-test harness**: simulates an MCP client to automatically test all tool servers and report pass/fail
- **Web dashboard**: multi-endpoint management, connectivity test, tool testing, real-time logs
- **Guardian process**: crash recovery, exponential backoff, spam self-healing, 2h periodic restart
- **Cross-platform**: Windows (auto UAC elevation + zero-window silent mode), Linux (permission binding)
- **Permission inheritance**: the permission level of the launch script determines the permission of all MCP service processes

### Architecture

```
Xiaozhi Cloud A (wss://api.xiaozhi.me)   Xiaozhi Cloud B (wss://api.xiaozhi.me)
       │                                          │
       ▼                                          ▼
   mcp_exe (bridge A)                      mcp_exe (bridge B)
       │                                          │
       └────────── shared stdio MCP servers ──────┘
              ├── filesystem   Local file operations
              ├── web          Bing+360 aggregated search + page fetch
              ├── weather      Open-Meteo weather
              ├── system       System/cmd/dsh/password/QR/unit conversion/self-test
              ├── dev          JSON/Base64/URL/Timestamp/UUID/Hash/Regex/DNS/HTTP/Port
              ├── code         Python/C/Bash execution
              └── message      Message exchange (auto-enabled with ≥2 endpoints)

Web Dashboard (http://localhost:37246)
       ├── Multi-endpoint management (add/remove/start/stop)
       ├── Connectivity test
       ├── Local tool testing
       └── Real-time logs
```

### Quick Start

**One-Click Deploy (recommended):**

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/ZnFr60/xiaozhi-mcp-bridge/main/install-linux.sh | bash

# Windows — download install-windows.bat and double-click
# https://raw.githubusercontent.com/ZnFr60/xiaozhi-mcp-bridge/main/install-windows.bat
```

**Manual:**

```bash
# 1. Install dependencies
cd xiaozhi-mcp-bridge
npm install

# 2. Configure Xiaozhi endpoint
cp config.example.js config.js
# Edit config.js and fill in your Xiaozhi WSS token

# 3. Start on Linux
chmod +x start.sh
./start.sh

# 4. Start on Windows
# Double-click start-windows.bat (auto elevation)
# or start-windows-silent.vbs (zero-window silent)
```

Then open **http://localhost:37246** for the dashboard.

### CLI Configuration

Manage endpoints from the command line (in addition to the Web dashboard):

```bash
# View config status
node config-cli.js status

# Add endpoint (message exchange auto-enables with >=2 endpoints)
node config-cli.js add "My Xiaozhi" "wss://api.xiaozhi.me/mcp/?token=xxx"

# List all endpoints
node config-cli.js list

# Remove endpoint
node config-cli.js remove <endpoint-id>

# Set default endpoint token (writes to config.js)
node config-cli.js token "wss://api.xiaozhi.me/mcp/?token=xxx"
```

### Tool List

| Server | Count | Description |
|--------|-------|-------------|
| filesystem | - | Local file read/write/list/search |
| web | 3 | Multi-engine search, page fetch, search status |
| weather | 1 | Current weather + 5-day forecast |
| system | 11 | System status, time, notes, command exec, dsh, password gen, QR code, unit conversion, **self-test** |
| dev | 12 | JSON/Base64/URL/Timestamp/UUID/Hash/Regex/DNS/HTTP/Port check |
| code | 5 | Python/C/Bash execution, file write, env info |
| message | 2 | **Message send/receive** (auto-enabled with ≥2 endpoints, supports recall/read tracking) |

### Message Exchange

When **≥2 Xiaozhi endpoints** are configured, the following two tools are automatically enabled:

- **send_message**: send (`action=send`), recall (`action=recall`), list users (`action=list_users`)
- **read_messages**: read new messages (`action=read`, auto-updates read position to prevent duplicates), list inbox/outbox, view/reset read position

Messages are stored as lightweight JSON files (3 files per user). Recall marks `recalled=true` instead of deleting.

### Self-Test

```bash
# Run full self-test from CLI
node test-harness.js

# Test a single server
node test-harness.js system

# JSON output
node test-harness.js --json
```

Xiaozhi can also call the `run_self_test` tool directly.

### Important Notes

1. **zod version lock**: `zod@3.25.76` is pinned in both `dependencies` and `overrides` (double protection), works with global installs; otherwise mcp_exe crashes with `_fieldsToZodSchema`
2. **Dynamic mcp.json**: guardian.js generates `mcp.json` from `mcp.template.json` at startup, all paths resolved relative to install dir — no manual editing needed
3. **Token security**: Xiaozhi WSS token is stored in `config.js`, which is gitignored and never committed
4. **Search**: Bing + 360 aggregated; Baidu/Sogou have strict anti-bot protection
5. **Guardian**: 30s startup grace period + spam self-healing (100KB/10s threshold) + 2h periodic restart
6. **UI port**: default 37246, configurable via `PORT` environment variable
7. **Message tools**: only appear when ≥2 endpoints are configured; auto-hidden otherwise
8. **Proxy environments**: mcp_exe's WebSocket does not support HTTP proxies by default; use proxychains or run in a proxy-free environment

---

## 文件说明 / File Structure

| 文件 / File | 作用 / Purpose |
|-------------|----------------|
| `guardian.js` | 守护进程 / Guardian process |
| `server.js` | Web 面板后端（Express，端口 37246）/ Dashboard backend |
| `public/index.html` | Web 面板前端 / Dashboard frontend |
| `mcp.json` | MCP 服务器配置（运行时自动生成）/ MCP server config (auto-generated) |
| `mcp.template.json` | MCP 配置模板（含路径占位符）/ MCP config template with placeholders |
| `config.example.js` | 配置模板 / Config template |
| `web-tools.js` | 网页工具 / Web tools |
| `weather-server.js` | 天气工具 / Weather tools |
| `system-tools.js` | 系统工具（11个，含自检）/ System tools |
| `dev-tools.js` | 开发者工具（12个）/ Dev tools |
| `code-tools.js` | 代码执行工具（5个）/ Code execution tools |
| `message-tools.js` | 消息交换机（2个，≥2接入点启用）/ Message exchange |
| `message-tools.backup.js` | 消息工具备份 / Message tools backup |
| `test-harness.js` | 工具自检平台 / Self-test harness |
| `test-client.js` | MCP stdio 测试客户端 / MCP stdio test client |
| `config-cli.js` | 命令行配置工具 / CLI config tool |
| `start.sh` | Linux 启动脚本 / Linux launcher |
| `start-windows.bat` | Windows 启动脚本（自动提权）/ Windows launcher |
| `start-windows-silent.vbs` | Windows 静默启动（零窗口）/ Windows silent launcher |
| `install-linux.sh` | Linux 一键部署脚本 / Linux one-click deploy (GitHub only) |
| `install-windows.bat` | Windows 一键部署脚本 / Windows one-click deploy (GitHub only) |

## License

MIT
