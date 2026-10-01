# 小智 AI MCP 桥接 / Xiaozhi AI MCP Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue.svg)]()

> 让小智 AI 通过 MCP 协议调用本机能力，并提供 Web 管理面板。
> Enable Xiaozhi AI to access local capabilities via the MCP protocol, with a Web management dashboard.

---

## 🇨🇳 中文

### 功能特性

- **30+ 工具**：文件操作、多引擎搜索、天气、系统命令、开发者工具、代码执行
- **多引擎聚合搜索**：必应 + 360 双引擎并行，自动去重，完全免费无限制
- **Web 管理面板**：多接入点管理、连接测试、工具测试、实时日志
- **守护进程**：异常兜底、退避重启、刷屏自愈、2 小时定期重启
- **双平台支持**：Windows（自动 UAC 提权 + 零窗口静默版）、Linux（权限绑定）
- **权限继承**：启动脚本的权限决定所有 MCP 服务进程的权限

### 架构

```
小智云端 (wss://api.xiaozhi.me)
       │  WebSocket
       ▼
   mcp_exe (桥接，组合多个 stdio MCP server)
       ├── filesystem   本机文件操作
       ├── web          必应+360聚合搜索 + 网页抓取
       ├── weather      Open-Meteo 天气
       ├── system       系统/命令/dsh/密码/二维码/单位换算
       ├── dev          JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口
       └── code         Python/C/Bash 代码执行

Web 管理面板 (http://localhost:37246)
       ├── 多接入点管理（添加/删除/启动/停止）
       ├── 连接测试
       ├── 本地工具测试
       └── 实时日志
```

### 快速开始

```bash
# 1. 安装依赖
cd xiaozhi-mcp-bridge
npm install

# 2. 配置小智接入点
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

### 工具列表

| 服务器 | 工具数 | 说明 |
|--------|--------|------|
| filesystem | - | 本机文件读写/列出/搜索 |
| web | 3 | 多引擎聚合搜索、网页抓取、搜索状态 |
| weather | 1 | 当前天气 + 5天预报 |
| system | 10 | 系统状态、时间、记事本、命令执行、dsh、密码生成、二维码、单位换算 |
| dev | 12 | JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口检测 |
| code | 5 | Python/C/Bash 执行、写文件、环境信息 |

### 关键注意事项

1. **zod 版本锁定**：`package.json` 中 `overrides.zod = "3.25.76"` 不可删，否则 mcp_exe 报错
2. **token 保密**：小智 WSS token 存储在 `config.js`，已加入 `.gitignore`，不会提交到公开仓库
3. **搜索**：必应 + 360 双引擎聚合，百度/搜狗反爬严格无法抓取
4. **守护机制**：刷屏自愈 + 2 小时定期重启，防止 WebSocket 长连接漂移
5. **UI 端口**：默认 37246，可通过环境变量 `PORT` 修改

---

## 🇬🇧 English

### Features

- **30+ tools**: file operations, multi-engine search, weather, system commands, dev tools, code execution
- **Multi-engine aggregated search**: Bing + 360 parallel fetching, auto-dedup, completely free with no limits
- **Web dashboard**: multi-endpoint management, connectivity test, tool testing, real-time logs
- **Guardian process**: crash recovery, exponential backoff, spam self-healing, 2h periodic restart
- **Cross-platform**: Windows (auto UAC elevation + zero-window silent mode), Linux (permission binding)
- **Permission inheritance**: the permission level of the launch script determines the permission of all MCP service processes

### Architecture

```
Xiaozhi Cloud (wss://api.xiaozhi.me)
       │  WebSocket
       ▼
   mcp_exe (bridge, combines multiple stdio MCP servers)
       ├── filesystem   Local file operations
       ├── web          Bing+360 aggregated search + page fetch
       ├── weather      Open-Meteo weather
       ├── system       System/cmd/dsh/password/QR/unit conversion
       ├── dev          JSON/Base64/URL/Timestamp/UUID/Hash/Regex/DNS/HTTP/Port
       └── code         Python/C/Bash execution

Web Dashboard (http://localhost:37246)
       ├── Multi-endpoint management (add/remove/start/stop)
       ├── Connectivity test
       ├── Local tool testing
       └── Real-time logs
```

### Quick Start

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

### Tool List

| Server | Count | Description |
|--------|-------|-------------|
| filesystem | - | Local file read/write/list/search |
| web | 3 | Multi-engine search, page fetch, search status |
| weather | 1 | Current weather + 5-day forecast |
| system | 10 | System status, time, notes, command exec, dsh, password gen, QR code, unit conversion |
| dev | 12 | JSON/Base64/URL/Timestamp/UUID/Hash/Regex/DNS/HTTP/Port check |
| code | 5 | Python/C/Bash execution, file write, env info |

### Important Notes

1. **zod version lock**: `overrides.zod = "3.25.76"` in `package.json` is required, otherwise mcp_exe crashes
2. **Token security**: Xiaozhi WSS token is stored in `config.js`, which is gitignored and never committed
3. **Search**: Bing + 360 aggregated; Baidu/Sogou have strict anti-bot protection
4. **Guardian**: spam self-healing + 2h periodic restart to prevent WebSocket connection drift
5. **UI port**: default 37246, configurable via `PORT` environment variable

---

## 文件说明 / File Structure

| 文件 / File | 作用 / Purpose |
|-------------|----------------|
| `guardian.js` | 守护进程 / Guardian process |
| `server.js` | Web 面板后端（Express，端口 37246）/ Dashboard backend |
| `public/index.html` | Web 面板前端 / Dashboard frontend |
| `mcp.json` | MCP 服务器配置（6个 server）/ MCP server config |
| `config.example.js` | 配置模板 / Config template |
| `web-tools.js` | 网页工具 / Web tools |
| `weather-server.js` | 天气工具 / Weather tools |
| `system-tools.js` | 系统工具（10个）/ System tools |
| `dev-tools.js` | 开发者工具（12个）/ Dev tools |
| `code-tools.js` | 代码执行工具（5个）/ Code execution tools |
| `start.sh` | Linux 启动脚本 / Linux launcher |
| `start-windows.bat` | Windows 启动脚本（自动提权）/ Windows launcher |
| `start-windows-silent.vbs` | Windows 静默启动（零窗口）/ Windows silent launcher |

## License

MIT
