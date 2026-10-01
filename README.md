# 小智 AI MCP 桥接 v2.0（Linux 版）

让小智 AI 通过 MCP 协议调用本机能力，并提供 Web 管理面板。

## 架构

```
小智云端 (wss://api.xiaozhi.me)
       │  WebSocket
       ▼
   mcp_exe (桥接，组合多个 stdio MCP server)
       ├── filesystem   本机文件操作（/home/user）
       ├── web          必应搜索 + 网页抓取
       ├── weather      Open-Meteo 天气（绵阳）
       ├── system       系统/命令/dsh/密码/二维码/单位换算
       └── dev          JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口

Web 管理面板 (http://localhost:37246)
       ├── 多接入点管理（添加/删除/启动/停止）
       ├── 连接测试
       ├── 本地工具测试
       └── 实时日志
```

## 文件说明

| 文件 | 作用 |
|------|------|
| `guardian.js` | 守护进程：异常兜底、退避重启、刷屏自愈、2小时定期重启 |
| `server.js` | Web 管理面板后端（Express，端口 37246） |
| `public/index.html` | 管理面板前端 |
| `mcp.json` | MCP 服务器配置（5 个 server） |
| `web-tools.js` | 网页工具：search_web、fetch_page |
| `weather-server.js` | 天气工具：get_weather |
| `system-tools.js` | 系统工具（10个） |
| `dev-tools.js` | 开发者工具（12个） |
| `start.sh` | 一键启动（桥接 + UI 面板） |
| `endpoints.json` | 接入点配置（自动生成） |
| `package.json` | 依赖清单（zod 锁 3.25.76） |

## 安装

```bash
cd xiaozhi-mcp
npm install
chmod +x start.sh
```

## 启动

```bash
./start.sh
```

启动后：
- 桥接守护进程自动连接小智云端
- Web 管理面板：**http://localhost:37246**

## 工具列表（共 25+）

### filesystem
- 读/写/列出/搜索 `/home/user` 下的文件

### web（3个）
- `search_web(query, count, engine)` — 多引擎聚合搜索（必应+360），自动合并去重，完全免费无限制，UA轮换防封
- `fetch_page(url, max_length)` — 抓取网页正文
- `search_status()` — 查看搜索引擎状态

### weather（1个）
- `get_weather()` — 绵阳当前天气 + 未来5天预报

### system（10个）
- `get_system_status()` — 系统状态
- `get_current_time()` — 当前时间
- `add_note` / `list_notes` / `clear_notes` — 本地记事本
- `run_command(command, timeout)` — 执行 bash 命令
- `run_dsh(task, cwd, timeout)` — 调用 DeepSeek Harness
- `password_gen(length, numbers, symbols, uppercase, count)` — 密码生成
- `qrcode_gen(text, size)` — 二维码生成
- `unit_convert(value, from, to)` — 单位换算（长度/重量/温度）

### dev（12个）
- `json_format(input)` — JSON 格式化/校验
- `base64_encode(text)` / `base64_decode(text)` — Base64
- `url_encode(text)` / `url_decode(text)` — URL 编解码
- `timestamp_convert(input)` — 时间戳↔日期
- `uuid_gen(count)` — UUID v4 生成
- `hash_calc(algorithm, text)` — MD5/SHA1/SHA256/SHA512
- `regex_test(pattern, text)` — 正则测试
- `dns_lookup(domain)` — DNS 查询
- `http_request(url, method, headers, body)` — HTTP 请求
- `port_check(host, port, timeout)` — 端口检测

## Web 管理面板功能

1. **多接入点管理**：添加多个小智 WSS 接入点，分别启动/停止桥接
2. **连接测试**：一键测试 WSS 连通性和握手
3. **工具测试**：选择本地工具服务器，查看工具列表，填写参数调用
4. **实时日志**：查看每个桥接进程的 stdout/stderr

## 关键注意事项

1. **zod 版本锁定**：`overrides.zod = "3.25.76"` 不可删
2. **天气坐标**：绵阳固定 (31.468, 104.679)
3. **搜索源**：cn.bing.com
4. **守护机制**：刷屏自愈 + 2小时定期重启
5. **token**：小智 wss token 写在 guardian.js 中，注意保密
6. **UI 端口**：默认 37246，可通过环境变量 PORT 修改
