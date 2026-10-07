# 更新日志 / Changelog

## v1.1.2

**修复「`npm i` 安装后跑不起来」以及停止时的孤儿进程问题。**

这三个问题都是把包真正当依赖安装、走一遍完整流程才暴露出来的：

- **依赖路径写死，`npm i` 后必然启动失败。**
  `guardian.js` / `guardian-multi.js` / `server.js` / `lib/mcp-config.js` 都用
  `path.join(APP_DIR, 'node_modules', ...)` 定位依赖。作为依赖安装时 npm 会把
  `mcp_exe`、`@modelcontextprotocol/server-filesystem` 提升到上层 `node_modules`，
  于是报 `MODULE_NOT_FOUND` 并无限重启。
  现改为新增 `lib/mcp-config.js` 的 `resolveDep()`，手动向上遍历 `node_modules`
  （不用 `require.resolve(pkg/package.json)` —— `mcp_exe` 声明了 `exports`，未导出
  `package.json`，那种写法会被拒绝）。两种布局都能正确解析。
- **守护进程退出时留下孤儿 `mcp_exe`。** 被 kill 的进程其子进程只会被 init/systemd
  收养而不会消失。实测 `stop.sh` 之后子进程仍以 `ppid=1` 运行并占着 WebSocket 长连接，
  下次启动即产生同 token 重复连接。`guardian-multi.js` 与 `guardian.js` 现在收到
  SIGTERM/SIGINT/SIGHUP 时先收子进程（1.5s 宽限后强杀），再清理状态文件。
- **多接入点守护不写 `guardian.pid` / `guardian-status.json`。**
  面板的「守护进程」指示读 `guardian-status.json`，`stop.sh` 依赖 `guardian.pid`。
  缺失时面板显示 `not_running`，脱离 `start.sh` 直接运行时 `stop.sh` 找不到进程。
  现按 1.0.8 `guardian.js` 的同样约定写出这两个文件。

### 其他

- 收录作者的双端交互测试 `test-dual-endpoint.js`（26 项断言），新增 `npm run test:dual`。
- `doListUsers` 合并两个来源：`users.json` 映射 + 消息内容里的 from/to，
  两者互为兜底（老数据没有映射文件时也能显示可读名字）。
- 补回仓库中未被 npm `files` 收录的文件：`.env.example`、`install-linux.sh`、
  `install-windows.bat`、`package-lock.json`。

---

## v1.1.1

**修复 v1.1.0 的基底错误。**

v1.1.0 误以 **v1.0.6** 为基底打包，导致 v1.0.7 / v1.0.8 的改进被**回退**：

- `guardian.js` v5 —— JWT 预校验、401/403 熔断、日志轮转、`guardian-status.json`、`guardian.pid`
- `start.sh` v2 / `stop.sh` —— 改用 PID 文件管理进程（原先靠 `pkill -f`）
- `xiaozhi-mcp.service`
- `engines.node >= 20`

v1.1.1 已改为**基于 v1.0.8 重建**，并重新套用 v1.1.0 的全部修复。
**请使用 v1.1.1，不要使用 v1.1.0。**

---

## v1.1.0

本次发布集中修复**多接入点在真实部署中不可用**的一系列缺陷。核心问题是：消息收发的
`from` / `to` / `user` 原本全部由 AI 自填，没有和接入点身份绑定，双方名字对不上时
消息会写进另一个信箱，**发送方显示成功、接收方永远收不到**。

> 本版本基于 **v1.0.8** 开发，完整保留 1.0.8 的全部改进：
> `guardian.js` v5（JWT 预校验、401/403 熔断、日志轮转、`guardian-status.json`、`guardian.pid`）、
> `start.sh` v2 / `stop.sh`（PID 文件进程管理）、`xiaozhi-mcp.service`、`engines.node >= 20`。

### 破坏性变更（需人工干预一次）

- **接入点新增必填字段 `userName`（用户名称）。**
  它是消息收发时双方互认的身份，不再允许由模型自行发挥。
  - `config-cli.js add` 现在要求第三个参数：`add <名称> <WSS地址> <用户名称>`
  - 新增 `config-cli.js user <接入点ID> <用户名称>` 用于修改
  - 旧配置（无 `userName`）会自动退回使用 `name`，但**强烈建议显式补齐**
- **`message-tools.js` 的启用条件由「配置条数 >= 2」改为「实际已连接数 >= 2」。**
  需要 `guardian-multi.js` 写出的 `runtime-state.json`；该文件缺失时退回旧行为。

### 新增

- **`guardian-multi.js`：多接入点守护进程。**
  原 `guardian.js` 只支持 `config.js` 里的单个接入点；`server.js` 虽有「多接入点管理」
  面板，却既不自启也不重连。结果是多接入点只能靠手动点按钮，重启即全部掉线。
  新守护以 `endpoints.json` 为唯一事实来源：
  - 为每个接入点各维持一条长连接，退出后退避重连（5s 起，上限 30s）
  - 每 2 小时主动重启一次，规避长连接老化
  - 每 60 秒重新读取 `endpoints.json`，新增自动上线、删除自动下线
  - 为每个接入点生成独立的 `mcp-<id>.json`，把用户名称通过 `env` 注入 `message-tools.js`
  - 写出 `runtime-state.json` 供消息工具判定与面板显示真实连接状态
- **`migrate-message-files.js`：历史消息文件名迁移脚本**（幂等）。
- `config-cli.js` 新增 `user` 子命令；`list` / `status` 现在显示用户名称。
- `messages/identity.log`：消息工具每次启动记录一行识别到的身份，便于排查投递问题。

### 修复

- **中文用户名互相覆盖（数据串号）。**
  旧的 `sanitize()` 把所有非 ASCII 字符统一替换成 `_`，实测
  `"智能体甲" / "智能体乙" / "助手甲" / "助手乙"` 全部得到 `"___"` ——
  四个不同用户共用同一份收件箱、发件箱和已读位置，消息互相覆盖且静默丢失。
  现改为：纯 ASCII 名保持原样，其余取名字的 SHA-1 前缀。
- **并发写损坏。** `writeJsonAtomic()` 使用固定的 `${fp}.tmp`，而每个接入点会各派生
  一个 `message-tools.js` 进程，同时写同一信箱时会互相截断并在 `rename` 上竞态。
  临时文件名现在包含 pid 与随机数。
- **面板是未鉴权的 root 代码执行入口。** 面板可调用 `code-tools.js`（任意代码执行），
  且服务往往以 root 运行，却监听 `0.0.0.0` 且没有任何鉴权中间件。
  现默认只放行本机回环与 Tailscale CGNAT 段 `100.64.0.0/10`；
  可用 `PANEL_ALLOW_CIDRS` 追加网段，用 `PANEL_TOKEN` 要求 Bearer 口令。
- **面板与守护重复建立同 token 连接。** 除 1.0.8 已有的 `guardian-status.json` 探测外，
  面板的启动/停止/测试接口现在也会读取 `runtime-state.json`，对由多接入点守护管理的
  接入点拒绝重复操作，并在 `/api/endpoints` 中标注 `managedByGuardian`。
- **`stopBridge` 竞态。** 原实现先 `delete` 再 `kill`，紧接着到达的 start 请求会起出
  第二个同 token 进程。现在标记「停止中」并在子进程 `exit` 回调里才移除。
- **`doSend` 不校验收件人。** 空 `from` / `to` 会把消息写进 `u_empty.json` 成为黑洞；
  收发同人也不报错。现在均直接拒绝并给出说明。
- **中文用户名在 `list_users` 里显示为不可读哈希。** 新增 `messages/users.json`
  映射，输出还原为可读名字。
- 移除 `server.js` 中未使用的 `http` 模块导入。

### 行为变化

- **`start.sh`、`bin/cli.js`、`xiaozhi-mcp.service` 默认改用 `guardian-multi.js`。**
  仍保留 `npm run bridge:single` 走旧的单接入点 `guardian.js`。
- 信箱新增保留上限：每个信箱默认最多 500 条（`MSG_MAX_PER_BOX` 可调），
  防止 7x24 长期运行写满存储。

### 移除

- `message-tools.backup.js`：内容为修复前的旧版本，保留只会造成混淆。

### 升级步骤（从 v1.0.x）

```bash
npm i xiaozhi-mcp-bridge@1.1.0

# 1. 为每个接入点补上用户名称（必填）
node config-cli.js list
node config-cli.js user <接入点ID> "小智1"

# 2. 若已有中文名的历史消息，迁移一次文件名
node migrate-message-files.js

# 3. 用多接入点守护启动
./start.sh
```

---

## v1.0.8 及更早

见 Git 提交历史。
