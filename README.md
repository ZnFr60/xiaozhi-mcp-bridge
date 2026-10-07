# 小智 AI MCP 桥接 / Xiaozhi AI MCP Bridge

> 让你的小智 AI 真正"用上"这台电脑：读写文件、执行命令、查天气、搜网页、写代码，
> 并让**两个小智互相发消息**。
>
> Let your Xiaozhi AI actually *use* this computer: read/write files, run commands,
> check weather, search the web, write code — and let **two Xiaozhi agents message each other**.

**当前版本 / Current version: v1.1.4** ｜ [更新日志 CHANGELOG](CHANGELOG.md)

---

## 目录 / Table of Contents

- [中文文档](#中文文档)
  - [一、这是什么](#一这是什么)
  - [二、能做什么](#二能做什么)
  - [三、环境要求](#三环境要求)
  - [四、安装](#四安装)
  - [五、配置接入点](#五配置接入点)
  - [六、启动与停止](#六启动与停止)
  - [七、Web 管理面板](#七web-管理面板)
  - [八、让两个小智互相发消息](#八让两个小智互相发消息)
  - [九、开机自启（Linux）](#九开机自启linux)
  - [十、常见问题 FAQ](#十常见问题-faq)
  - [十一、⚠️ 局限性与已知问题](#十一️-局限性与已知问题)
  - [十二、安全须知](#十二安全须知)
  - [十三、升级与迁移](#十三升级与迁移)
- [English Documentation](#english-documentation)

---

# 中文文档

## 一、这是什么

小智 AI（`xiaozhi.me`）是一个语音助手。它自己**不能**碰你的电脑 ——
你让它"帮我看看 D 盘还剩多少空间"，它只能干瞪眼。

这个项目是一座**桥**：它在你的电脑上跑一个小程序，通过 MCP
（Model Context Protocol，一种让 AI 调用本地工具的标准协议）把小智和你的电脑连起来。
连上之后，小智就真的能读文件、跑命令、查资料了。

**一句话：给语音助手装上手脚。**

### 它由三部分组成

| 组件 | 文件 | 作用 |
|---|---|---|
| **桥接进程** | `guardian-multi.js` | 为每个接入点维持一条到小智服务器的长连接 |
| **Web 面板** | `server.js` | 浏览器里管理接入点、看日志、测工具（端口 37246）|
| **工具服务器** | `*-tools.js` / `*-server.js` | 真正干活的部分，一个文件一类能力 |

三者都以**当前用户权限**运行 —— 你用 root 启动，小智就有 root 权限。

---

## 二、能做什么

连接成功后，小智会获得这些工具（取决于你启用了哪些）：

| 类别 | 数量 | 能做什么 |
|---|---|---|
| **文件** | — | 读、写、列目录、搜索文件（根目录可在配置里限定）|
| **网页** | 3 | 多引擎聚合搜索、抓取网页正文、查搜索状态 |
| **天气** | 1 | 当前天气 + 未来 5 天预报 |
| **系统** | 11 | 系统状态、当前时间、记事本、执行命令、生成密码、二维码、单位换算、自检 |
| **开发** | 12 | JSON/Base64/URL 编解码、时间戳、UUID、哈希、正则、DNS、HTTP、端口检测 |
| **代码** | 5 | 执行 Python / C / Bash 代码、写文件、查环境信息 |
| **消息** | 2 | 和其他小智互发消息（**需要至少 2 个接入点**）|

---

## 三、环境要求

### 1. 一台电脑

Windows / macOS / Linux 都行。这台电脑要能上网（小智的服务器在公网）。

### 2. Node.js 20 或更高版本

**这是唯一的硬性依赖。** 检查方法：打开终端（Windows 是 PowerShell / CMD），输入：

```bash
node -v
```

如果显示 `v20.x.x` 或更高就可以了。如果提示"命令不存在"或版本低于 20，去
<https://nodejs.org> 下载 **LTS 版本**安装即可（一路下一步）。

> 为什么要求 20+：项目用到了 Node 20 才有的新特性。18 也能勉强跑，但官方不再保证。

### 3. 一个小智 MCP 接入点

去小智后台创建一个 MCP 接入点，你会拿到一串 **WSS 地址**，长这样：

```
wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJIUzI1NiIs...
```

**这串东西就是钥匙，请像密码一样保管**，不要发到群里或提交到 Git 仓库。

---

## 四、安装

有两种方式，**功能完全一样**，选一种即可。

### 方式 A：git clone（推荐）

适合想改代码、或者想跟着更新走的用户。

```bash
git clone https://github.com/ZnFr60/xiaozhi-mcp-bridge.git
cd xiaozhi-mcp-bridge
npm install
```

### 方式 B：从 npm 安装

适合只想用、不想管代码的用户。

```bash
mkdir my-xiaozhi && cd my-xiaozhi
npm init -y
npm install xiaozhi-mcp-bridge
cd node_modules/xiaozhi-mcp-bridge
```

> **注意**：这种方式安装后，项目目录在 `node_modules/xiaozhi-mcp-bridge` 里面，
> 后续所有命令都要在这个目录里执行。

---

## 五、配置接入点

### 5.1 最简单的用法：只配一个接入点

在项目目录里执行（把 `你的WSS地址` 换成你真实的那串）：

```bash
node config-cli.js add "我的小智" "你的WSS地址" "我的小智"
```

看到 `[OK] 已添加接入点` 就成功了。查看配置：

```bash
node config-cli.js list
```

### 5.2 想要两个小智互相发消息：配两个接入点

再执行一次，用**第二个**接入点的地址：

```bash
node config-cli.js add "小智B" "第二个WSS地址" "小智B"
```

当接入点数量 **≥ 2** 时，消息工具会自动出现在小智的工具列表里。

### 5.3 ⚠️ 用户名称（userName）—— 最容易配错的地方

上面每条命令的**第三个参数**就是**用户名称**。请把这一节读完，它决定了消息能不能发出去。

#### 它是什么

消息收发时，两个小智是靠**名字**互相认识的。这个"用户名称"就是这个接入点
在消息系统里的**身份证**。

#### 为什么必须配对

消息的投递规则很简单：

> **发送方填的"收件人"，必须等于接收方的"用户名称"。**

如果对不上，消息会被投进**另一个信箱**。你会看到一个非常迷惑的现象：

> 发送方显示"消息已发送"，但接收方**永远收不到**。

这台设备不会报错，只会静默地把消息投错地方。**这是最常见的失败原因。**

#### 怎么命名

- 每个接入点一个名字，**彼此必须不同**
- 中文、英文、数字都支持
- 建议取得有意义，比如 `小智A` / `小智B`、`书房的电脑` / `客厅的电脑`
- 名字确定后**不要随便改**，改了之后旧消息就找不到了

#### 好消息：现在不用你自己操心

v1.1.0 起，程序会**自动**把你的身份和对方的名字写进工具说明里。
小智在调用工具时会直接看到这样一段话：

```
【你的身份是「小智A」；可发送给：小智B。
 发消息时 to 填对端名字即可；from / user 可省略，系统会按身份自动填写。】
```

也就是说：**小智不需要猜，也不需要你教它该填什么。**
即使它填错了（比如把收件人写成"对方"、"你"），只要只有一个对端，
系统也会自动纠正到正确的名字。

#### 修改 / 删除接入点

```bash
node config-cli.js list                  # 先查出接入点 ID
node config-cli.js user <ID> "新名字"     # 改用户名称
node config-cli.js remove <ID>           # 删除接入点
```

#### 查看当前配置状态

```bash
node config-cli.js status
```

---

## 六、启动与停止

### 启动

```bash
./start.sh
```

Windows 用户双击 `start-windows.bat`。

看到这些就成功了：

```
[2/3] 启动 Web 管理面板 (端口 37246)...
  UI PID: 12345
[3/3] 启动桥接守护进程（多接入点）...
  桥接 PID: 12346
  启动完成！
```

### 怎么知道连上了

```bash
curl http://localhost:37246/api/status
```

看到 `"connected":2`（数字等于你的接入点数量）就是全部连上了。

或者直接在浏览器打开 <http://localhost:37246> 看面板。

### 停止

```bash
./stop.sh
```

Windows 用户直接关掉那两个命令行窗口，或者在任务管理器里结束 `node.exe`。

### 进阶：手动分开启动

```bash
node server.js            # 只启动 Web 面板
node guardian-multi.js    # 只启动桥接守护（多接入点）
npm run bridge:single     # 用旧版单接入点守护
```

---

## 七、Web 管理面板

浏览器打开 <http://localhost:37246>。

面板能做什么：

- 看每个接入点的**实时连接状态**（谁连上了、谁掉线了）
- 添加 / 删除接入点
- 测试某个接入点能否连通
- **单独测试每个工具**，不经过小智也能验证功能是否正常（排查问题很有用）
- 看实时日志

> ⚠️ **不要用面板的"启动接入点"按钮** —— 桥接的生命周期由后台守护进程管理，
> 面板再启动一次会造成**同一个 token 建立两条连接**。看状态可以，别点启动。

### 面板访问控制（重要）

面板能执行**任意代码**，而且服务通常以 root 运行 —— 也就是说，
**谁能打开这个页面，谁就等于拿到了这台电脑的最高权限。**

所以 v1.1.0 起，面板默认**只允许**：

- 本机（`127.0.0.1`）
- Tailscale 内网段（`100.64.0.0/10`）

从局域网其他设备（比如 `192.168.1.x`）访问会返回 **403**。这是故意的。

需要放行局域网时，在启动前设置环境变量：

```bash
export PANEL_ALLOW_CIDRS="192.168.1.,10.0.0."   # 逗号分隔的前缀
./start.sh
```

需要口令时：

```bash
export PANEL_TOKEN="你自己设一个复杂口令"
./start.sh
# 之后访问要带 ?token=口令，或请求头 Authorization: Bearer 口令
```

---

## 八、让两个小智互相发消息

这是本项目最特别的功能。完整走一遍：

### 第 1 步：准备两个小智

在小智后台创建**两个** MCP 接入点，各拿到一个 WSS 地址。

> 两个接入点可以是同一个账号下的两个智能体，也可以是两台不同设备。

### 第 2 步：把两个都配上

在**同一台**电脑上（消息存在本地文件，所以必须在同一台机器）：

```bash
node config-cli.js add "小智A" "第一个WSS地址" "小智A"
node config-cli.js add "小智B" "第二个WSS地址" "小智B"
```

### 第 3 步：启动

```bash
./start.sh
```

确认 `curl http://localhost:37246/api/status` 里 `connected` 是 2。

### 第 4 步：让小智发消息

对着**小智A**说（或者打字）：

> 给"小智B"发条消息，内容是：晚上七点提醒我吃饭

小智会调用 `send_message`，你会在它的回复里看到：

```
消息已发送
  消息ID: msg_xxxxx
  从: 小智A → 到: 小智B
```

### 第 5 步：让对方收消息

> ⚠️ **关键：对方不会自动收到通知。** 消息只是安静地躺在信箱里。

你需要主动对**小智B**说：

> 看看有没有新消息

它才会调用 `read_messages` 把消息取出来。

### 消息工具能做的全部事情

**`send_message`（发）**

| action | 作用 |
|---|---|
| `send`（默认）| 发一条消息 |
| `recall` | 撤回自己发过的消息（标记为已撤回，不删除）|
| `list_users` | 列出所有出现过的用户名称 |

**`read_messages`（收）**

| action | 作用 |
|---|---|
| `read`（默认）| 读新消息，并更新"已读位置"（不会重复读）|
| `list_inbox` | 看收件箱全部消息 |
| `list_outbox` | 看发件箱全部消息 |
| `get_position` | 看当前已读位置 |
| `reset_position` | 重置已读位置（之后能重新读到所有消息）|

---

## 九、开机自启（Linux）

项目自带一个 systemd 模板 `xiaozhi-mcp.service`。用法：

```bash
# 1. 改路径和用户名（把 your_username 换成你的）
nano xiaozhi-mcp.service

# 2. 安装
sudo cp xiaozhi-mcp.service /etc/systemd/system/xiaozhi-mcp.service
sudo systemctl daemon-reload

# 3. 启用并启动
sudo systemctl enable --now xiaozhi-mcp.service

# 4. 看状态 / 看日志
systemctl status xiaozhi-mcp.service
journalctl -u xiaozhi-mcp.service -f
```

> 模板默认只启动桥接守护。想连面板一起启动，把文件里那行
> `# ExecStartPost=...server.js` 的注释去掉，或者单独再写一个 service。

---

## 十、常见问题 FAQ

### Q1. 小智说找不到工具 / 工具列表是空的

**原因**：桥接没连上，或者只连上了 1 个接入点（消息工具需要 ≥ 2 个）。

**排查**：
```bash
curl http://localhost:37246/api/status
```
看 `endpoints` 和 `guardian.connected`。如果 `connected` 是 0：

```bash
tail -50 mcp.log
```
常见错误：
- `Cannot find module` → 依赖没装好，重新 `npm install`
- `token 已过期` → 去小智后台重新生成接入点
- `401 / 403` → token 无效，同上

### Q2. 消息显示"已发送"，但对方收不到

**99% 是用户名称没对上。** 检查：

```bash
node config-cli.js list
```

确认两个接入点的"用户名称"是**两个不同的名字**，且发送方填的收件人等于接收方的用户名称。

如果拿不准，直接让对方说"看看有没有新消息"，然后在 `messages/identity.log` 里
确认每个进程识别到的身份是否正确：

```bash
cat messages/identity.log
```

### Q3. 改了用户名称之后，旧消息不见了

正常。消息按"用户名称"分信箱存放，改名等于换了一个信箱。
旧数据仍在 `messages/` 目录里（对应的文件名是哈希值），但没有对应关系了。

### Q4. 从别的电脑打不开面板

这是**故意的**。见[面板访问控制](#面板访问控制重要)。
要放行就设 `PANEL_ALLOW_CIDRS`。

### Q5. 面板能打开，但显示 `guardian: not_running`

说明守护进程没起来，或者不是用 `./start.sh` 启动的。
用 `./start.sh` 重新启动一次。

### Q6. `stop.sh` 之后还有 node 进程

正常情况不该有。检查：

```bash
ps aux | grep node
```

如果有残留的 `mcp_exe`，说明守护进程是被强杀（`kill -9`）的，
来不及清理子进程。手动杀掉即可。

### Q7. 换了一台电脑，配置怎么迁移

把整个项目目录复制过去（**除了 `node_modules`**），然后：
```bash
npm install
```
配置文件（`config.js` / `endpoints.json` / `messages/`）会一起带过去。

### Q8. 怎么升级到新版本

```bash
./stop.sh
git pull            # git 方式
npm install
./start.sh
```
npm 方式：`npm install xiaozhi-mcp-bridge@latest`

### Q9. 日志在哪

- `mcp.log` —— 桥接日志（主要看这个）
- `server.log` —— 面板日志
- 系统日志 —— `journalctl -u xiaozhi-mcp.service`

日志超过 10MB 会自动轮转成 `mcp.log.1`。

### Q10. 支持 Windows 吗

支持，`start-windows.bat`。但**开机自启的 systemd 方案只适用于 Linux**。
Windows 上想开机自启，可以用「任务计划程序」触发 `start-windows.bat`。

---

## 十一、⚠️ 局限性与已知问题

**请在使用前读完这一节。** 这不是一个"装上就完事"的成品，以下限制是设计使然或尚未解决。

### 11.1 消息是"拉取"模式，没有推送

**对方的 AI 不会自动知道有新消息。** 消息只是写进本地文件，
必须由人主动问（或由 AI 自己定时去查），才会被读出来。

做不到"你发过去，对面音箱立刻响"。想要接近实时的效果，
只能在小智那边设置定时任务，让它每隔几分钟自己调一次 `read_messages`。

### 11.2 两个接入点必须在同一台电脑上

消息存在**本地 JSON 文件**里，不经过网络中转。
所以两个小智的桥接**必须跑在同一台机器**。分两台机器各自跑是收不到消息的。

### 11.3 消息没有加密，也没有身份校验

- 消息以**明文 JSON** 存在 `messages/` 目录里，任何能读该目录的程序都能看
- `from`（发送者）是调用方自己填的，**可以被伪造** —— AI 理论上能冒充别人发消息
- 没有端到端加密

**不要把敏感信息（密码、密钥、身份证号）通过这个通道传。**

### 11.4 单个信箱最多保留 500 条

超出后最旧的会被丢弃，防止 7×24 长期运行把磁盘写满。
可用环境变量 `MSG_MAX_PER_BOX` 调整。

### 11.5 同一个 token 只能被一个地方连接

如果你同时用 `./start.sh` 和面板的"启动"按钮，会建立**两条**连接，
可能导致小智那边行为异常（消息重复、工具调用错乱）。

**记住一个原则：桥接的生命周期交给 `guardian-multi.js`，不要在面板里点启动。**

### 11.6 面板能执行任意代码

面板里的 `code` 工具能跑 Python / C / Bash。这是**功能**，也是**风险** ——
一旦被外人访问，等于把电脑交出去。

**绝不要把面板端口直接暴露到公网。** 需要远程访问请用 Tailscale / WireGuard 这类
内网方案，不要用路由器端口转发。

### 11.7 以什么权限运行，小智就有什么权限

- 用 `./start.sh`（普通用户）→ 小智只能动你有权限的文件
- 用 `sudo ./start.sh` → **小智拥有 root 权限，能改系统任何东西**

如果没有特殊需要，**建议用普通用户运行**。

### 11.8 token 会过期

小智的 WSS token 是 JWT，带过期时间（一般一年）。
过期后连接会失败，需要去小智后台重新生成接入点。
可以在 <https://jwt.io> 粘贴 token 看 `exp` 字段，或直接在面板上看连接测试的报错。

### 11.9 只支持 stdio 类型的 MCP 工具服务器

`mcp.json` 里配置的工具服务器必须是命令行程序（stdio 模式）。
不支持 SSE / HTTP 类型的 MCP 服务器。

### 11.10 已知缺陷：`stop.sh` 的兜底清理可能误杀

`stop.sh` 除了按 PID 文件停止，还有一段"兜底清理"：
它会查找命令行里含 `server.js` / `guardian-multi.js`、且工作目录正好是本项目
目录的进程并杀掉。

**副作用**：如果你自己的终端恰好 `cd` 到了项目目录、且命令行里出现过这些字样，
你的终端也可能被误杀。

正常情况下 PID 文件已经足够精准，这段兜底其实是多余的。
**这个问题尚未修复**，遇到时重新打开终端即可。

### 11.11 首次启动时消息工具可能延迟出现

消息工具的启用条件是"**实际已连接**的接入点 ≥ 2"。
刚启动时连接还没建立完，工具可能暂时不出现，等十几秒刷新即可。

### 11.12 工具执行的输出长度有限

`system` 的"执行命令"和 `code` 的代码执行都有输出长度上限，
超长输出会被截断。跑长时间任务（如编译）可能超时。

---

## 十二、安全须知

按重要性排序：

1. **绝不要把面板端口暴露到公网。** 需要远程就用 Tailscale 等内网方案。
2. **保管好 WSS token。** 它等同于这台电脑的操作权限。
3. **尽量用普通用户运行。** 除非你明确需要 root。
4. **定期看日志。** `mcp.log` 里能看到所有工具调用记录。
5. **`config.js` / `endpoints.json` / `messages/` 已在 `.gitignore` 里**，
   不要手动把它们提交到公开仓库。
6. **不确定的工具先别开。** 用不上的工具服务器可以从 `mcp.template.json` 里删掉。

---

## 十三、升级与迁移

### 从 v1.0.x 升级到 v1.1.x

v1.1.0 有一个**不兼容改动**：接入点新增了必填的"用户名称"字段。

```bash
./stop.sh
git pull && npm install      # 或 npm install xiaozhi-mcp-bridge@latest

# 1. 给每个接入点补上用户名称
node config-cli.js list
node config-cli.js user <接入点ID> "你的名字"

# 2. 如果已有中文名的历史消息，迁移一次文件名
node migrate-message-files.js

# 3. 重新启动
./start.sh
```

> 老配置缺少"用户名称"时会自动退回使用接入点名称，但仍**强烈建议显式补齐**。

### 版本历史

见 [CHANGELOG.md](CHANGELOG.md)。

---

## 许可证

[MIT](LICENSE)

---
---

# English Documentation

## What is this?

Xiaozhi AI (`xiaozhi.me`) is a voice assistant. By itself it **cannot** touch your computer —
ask it "how much space is left on my disk?" and it can only shrug.

This project is a **bridge**. It runs a small program on your computer and connects
Xiaozhi to it over MCP (Model Context Protocol — a standard that lets AI call local tools).
Once connected, Xiaozhi can really read files, run commands and look things up.

**In one line: it gives your voice assistant hands.**

### Three parts

| Component | File | Role |
|---|---|---|
| **Bridge** | `guardian-multi.js` | Keeps one long-lived connection per endpoint |
| **Web dashboard** | `server.js` | Manage endpoints, view logs, test tools (port 37246) |
| **Tool servers** | `*-tools.js` / `*-server.js` | The parts that actually do the work |

All three run with **your** privileges — start as root and Xiaozhi gets root.

---

## What can it do?

| Category | Count | Capabilities |
|---|---|---|
| **Filesystem** | — | Read, write, list, search files (root dir is configurable) |
| **Web** | 3 | Multi-engine search, fetch page text, search status |
| **Weather** | 1 | Current weather + 5-day forecast |
| **System** | 11 | System status, time, notepad, run commands, password generator, QR code, unit conversion, self-test |
| **Dev** | 12 | JSON/Base64/URL, timestamps, UUID, hashes, regex, DNS, HTTP, port check |
| **Code** | 5 | Run Python / C / Bash, write files, environment info |
| **Message** | 2 | Message another Xiaozhi agent (**requires ≥ 2 endpoints**) |

---

## Requirements

### 1. A computer

Windows / macOS / Linux. It needs internet access (Xiaozhi's servers are on the public internet).

### 2. Node.js 20 or newer

**The only hard dependency.** Check:

```bash
node -v
```

`v20.x.x` or higher is fine. If it says "command not found" or the version is below 20,
download the **LTS build** from <https://nodejs.org> and install it (click through the installer).

> Why 20+: the project uses features introduced in Node 20. Node 18 may partly work
> but is not guaranteed.

### 3. A Xiaozhi MCP endpoint

Create an MCP endpoint in the Xiaozhi dashboard. You will get a **WSS URL** like:

```
wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJIUzI1NiIs...
```

**Treat this string like a password.** Do not paste it in chat groups or commit it to Git.

---

## Installation

Two ways — **functionally identical**, pick one.

### Option A: git clone (recommended)

Best if you want to modify the code or follow updates.

```bash
git clone https://github.com/ZnFr60/xiaozhi-mcp-bridge.git
cd xiaozhi-mcp-bridge
npm install
```

### Option B: install from npm

Best if you just want to use it.

```bash
mkdir my-xiaozhi && cd my-xiaozhi
npm init -y
npm install xiaozhi-mcp-bridge
cd node_modules/xiaozhi-mcp-bridge
```

> **Note**: with this option the project lives inside `node_modules/xiaozhi-mcp-bridge`.
> Run all the following commands from that directory.

---

## Configuring endpoints

### Single endpoint (simplest)

From the project directory (replace `YOUR_WSS_URL` with your real one):

```bash
node config-cli.js add "My Xiaozhi" "YOUR_WSS_URL" "My Xiaozhi"
```

`[OK]` means it worked. List your configuration with:

```bash
node config-cli.js list
```

### Two endpoints (enables messaging)

Run it again with your **second** endpoint's URL:

```bash
node config-cli.js add "Xiaozhi Two" "SECOND_WSS_URL" "Xiaozhi Two"
```

Once you have **≥ 2** endpoints, the messaging tools appear in Xiaozhi's tool list.

### ⚠️ userName — the easiest thing to get wrong

The **third argument** of every `add` command is the **user name**.
Please read this section — it decides whether messages actually arrive.

#### What it is

When exchanging messages, the two agents recognise each other **by name**.
The user name is this endpoint's **identity** in the messaging system.

#### Why it matters

The delivery rule is simple:

> **The sender's "to" must equal the receiver's "userName".**

If they don't match, the message goes into a **different mailbox**. You will see a very
confusing symptom:

> The sender reports "message sent", but the receiver **never gets it**.

Nothing errors out — the message is just silently delivered to the wrong place.
**This is the most common cause of failure.**

#### How to name them

- One name per endpoint, and **they must all be different**
- Chinese, English and digits are all fine
- Pick something meaningful, e.g. `office-pc` / `living-room-pc`
- Once set, **don't rename casually** — old messages won't be found afterwards

#### Good news: you don't have to worry about it anymore

Since v1.1.0 the program **automatically** writes your identity and the peer's name into
the tool description. Xiaozhi sees this directly:

```
[Your identity is "Xiaozhi One"; you can send to: Xiaozhi Two.
 Fill "to" with the peer's name; "from" / "user" are optional and filled in automatically.]
```

So the model doesn't have to guess, and you don't have to teach it.
Even if it fills in something wrong (like `to: "the other one"`), as long as there is
exactly one peer it will be auto-corrected.

#### Modifying / removing endpoints

```bash
node config-cli.js list                  # find the endpoint ID
node config-cli.js user <ID> "newname"   # change the user name
node config-cli.js remove <ID>           # remove an endpoint
```

#### Inspecting current state

```bash
node config-cli.js status
```

---

## Start and stop

### Start

```bash
./start.sh
```

On Windows, double-click `start-windows.bat`.

A successful start looks like:

```
[2/3] Starting web dashboard (port 37246)...
  UI PID: 12345
[3/3] Starting bridge guardian (multi-endpoint)...
  Bridge PID: 12346
  Started!
```

### Verify it connected

```bash
curl http://localhost:37246/api/status
```

`"connected":2` (matching your endpoint count) means everything is up.
Or just open <http://localhost:37246> in a browser.

### Stop

```bash
./stop.sh
```

On Windows, close the two console windows — or end `node.exe` in Task Manager.

### Advanced: start components separately

```bash
node server.js            # web dashboard only
node guardian-multi.js    # multi-endpoint bridge guardian only
npm run bridge:single     # legacy single-endpoint guardian
```

---

## Web dashboard

Open <http://localhost:37246>.

What it does:

- **Live connection status** per endpoint (who's up, who dropped)
- Add / remove endpoints
- Test whether an endpoint is reachable
- **Test each tool individually**, without going through Xiaozhi (very useful for debugging)
- Live logs

> ⚠️ **Do not use the dashboard's per-endpoint "Start" button.** The bridge lifecycle is
> owned by the background guardian; starting it again creates **two connections for the
> same token**. Watching status is fine — just don't click start.

### Dashboard access control (important)

The dashboard can execute **arbitrary code**, and the service often runs as root —
meaning **anyone who can open that page effectively has full control of this computer**.

So since v1.1.0 it only accepts, by default:

- loopback (`127.0.0.1`)
- the Tailscale CGNAT range (`100.64.0.0/10`)

Access from other LAN devices (e.g. `192.168.1.x`) returns **403**. That is intentional.

To allow extra networks, set an environment variable before starting:

```bash
export PANEL_ALLOW_CIDRS="192.168.1.,10.0.0."   # comma-separated prefixes
./start.sh
```

To require a token:

```bash
export PANEL_TOKEN="pick-a-strong-secret"
./start.sh
# then access with ?token=YOUR_SECRET or header Authorization: Bearer YOUR_SECRET
```

---

## Making two Xiaozhi agents message each other

This is the project's most distinctive feature. Full walkthrough:

### Step 1: prepare two agents

Create **two** MCP endpoints in the Xiaozhi dashboard and note both WSS URLs.

> They can be two agents under the same account, or two different devices.

### Step 2: register both

On the **same** computer (messages are local files, so both must run here):

```bash
node config-cli.js add "Xiaozhi One" "FIRST_WSS_URL" "Xiaozhi One"
node config-cli.js add "Xiaozhi Two" "SECOND_WSS_URL" "Xiaozhi Two"
```

### Step 3: start

```bash
./start.sh
```

Confirm `connected` is 2 via `curl http://localhost:37246/api/status`.

### Step 4: send

Tell **Xiaozhi One** (by voice or text):

> Send a message to "Xiaozhi Two" saying: remember to eat at 7pm

It calls `send_message` and you'll see:

```
Message sent
  Message ID: msg_xxxxx
  From: Xiaozhi One -> To: Xiaozhi Two
```

### Step 5: receive

> ⚠️ **Critical: the other side is NOT notified automatically.** The message just sits in a mailbox.

You must ask **Xiaozhi Two**:

> Check for new messages

Only then does it call `read_messages` and pick them up.

### Everything the messaging tools can do

**`send_message`**

| action | Effect |
|---|---|
| `send` (default) | Send a message |
| `recall` | Recall a message you sent (marked recalled, not deleted) |
| `list_users` | List all user names ever seen |

**`read_messages`**

| action | Effect |
|---|---|
| `read` (default) | Read new messages and advance the read position (no duplicates) |
| `list_inbox` | Show the whole inbox |
| `list_outbox` | Show the whole outbox |
| `get_position` | Show the current read position |
| `reset_position` | Reset it (so everything can be read again) |

---

## Autostart on Linux (systemd)

A systemd template ships as `xiaozhi-mcp.service`:

```bash
# 1. Edit paths and user (replace your_username)
nano xiaozhi-mcp.service

# 2. Install
sudo cp xiaozhi-mcp.service /etc/systemd/system/xiaozhi-mcp.service
sudo systemctl daemon-reload

# 3. Enable and start
sudo systemctl enable --now xiaozhi-mcp.service

# 4. Status / logs
systemctl status xiaozhi-mcp.service
journalctl -u xiaozhi-mcp.service -f
```

> The template starts the guardian only. To start the dashboard too, uncomment the
> `# ExecStartPost=...server.js` line, or write a separate service.

---

## FAQ

### Q1. Xiaozhi says the tools are missing / the tool list is empty

**Cause**: the bridge isn't connected, or only one endpoint is connected
(messaging tools need ≥ 2).

**Check**:
```bash
curl http://localhost:37246/api/status
```
Look at `endpoints` and `guardian.connected`. If `connected` is 0:

```bash
tail -50 mcp.log
```
Common errors:
- `Cannot find module` → dependencies not installed; re-run `npm install`
- `token expired` → regenerate the endpoint in the Xiaozhi dashboard
- `401 / 403` → invalid token, same fix

### Q2. It says "sent" but the other side never receives it

**99% of the time the user names don't match.** Check:

```bash
node config-cli.js list
```

Make sure the two endpoints have **two different** user names, and that the sender's
recipient equals the receiver's user name.

If unsure, ask the other side to "check for new messages", then confirm each process
detected the right identity:

```bash
cat messages/identity.log
```

### Q3. I renamed a user and old messages disappeared

Expected. Messages are stored per user name, so renaming switches mailboxes.
The old data still exists under `messages/` (as hashed filenames) but is no longer linked.

### Q4. I can't open the dashboard from another computer

That is **intentional**. See [Dashboard access control](#dashboard-access-control-important).
Set `PANEL_ALLOW_CIDRS` to allow more.

### Q5. The dashboard opens but shows `guardian: not_running`

The guardian isn't running, or wasn't started via `./start.sh`.
Restart with `./start.sh`.

### Q6. There are still node processes after `stop.sh`

There shouldn't be. Check:

```bash
ps aux | grep node
```

Leftover `mcp_exe` processes mean the guardian was killed forcefully (`kill -9`)
and had no chance to clean up its children. Kill them manually.

### Q7. How do I move the setup to another computer?

Copy the whole project directory (**except `node_modules`**) and run:
```bash
npm install
```
Your configuration (`config.js` / `endpoints.json` / `messages/`) comes along.

### Q8. How do I upgrade?

```bash
./stop.sh
git pull            # git installs
npm install
./start.sh
```
For npm installs: `npm install xiaozhi-mcp-bridge@latest`

### Q9. Where are the logs?

- `mcp.log` — bridge log (the main one)
- `server.log` — dashboard log
- system log — `journalctl -u xiaozhi-mcp.service`

`mcp.log` rotates to `mcp.log.1` at 10 MB.

### Q10. Does it support Windows?

Yes, via `start-windows.bat`. Note that **the systemd autostart recipe is Linux-only**.
On Windows, use Task Scheduler to run `start-windows.bat` at logon.

---

## ⚠️ Limitations and known issues

**Please read this before using it.** This is not a polished turnkey product;
the following are by design or not yet solved.

### 1. Messaging is pull-based, with no push

**The other agent is never notified automatically.** Messages are written to a local file
and only read when a human asks (or the agent polls on a timer).

There is no "send it and the other speaker instantly chimes". For near-real-time behaviour,
set up a scheduled task on the Xiaozhi side that calls `read_messages` every few minutes.

### 2. Both endpoints must run on the same machine

Messages are stored as **local JSON files**, not relayed over the network.
Both bridges must run on the **same computer**. Running them on two machines will not work.

### 3. Messages are neither encrypted nor authenticated

- Stored as **plain-text JSON** under `messages/`; anything that can read that directory can read them
- `from` is supplied by the caller and **can be forged** — an agent could impersonate another
- No end-to-end encryption

**Never send secrets (passwords, keys, ID numbers) through this channel.**

### 4. Each mailbox keeps at most 500 messages

Oldest messages are dropped beyond that, to avoid filling the disk during 24/7 operation.
Tune with the `MSG_MAX_PER_BOX` environment variable.

### 5. One token can only be connected from one place

Running `./start.sh` *and* clicking "Start" in the dashboard creates **two** connections,
which can confuse the Xiaozhi side (duplicate messages, erratic tool calls).

**Rule of thumb: the guardian owns the bridge lifecycle. Don't click Start in the dashboard.**

### 6. The dashboard can execute arbitrary code

The `code` tool runs Python / C / Bash. That is a **feature** and a **risk** —
if an outsider can reach it, they effectively own the machine.

**Never expose the dashboard port to the public internet.** For remote access use an
overlay network such as Tailscale / WireGuard, not router port forwarding.

### 7. Whatever privilege you start with is what Xiaozhi gets

- `./start.sh` (normal user) → Xiaozhi can only touch files you can
- `sudo ./start.sh` → **Xiaozhi has root and can change anything on the system**

Unless you specifically need it, **run as a normal user**.

### 8. Tokens expire

The WSS token is a JWT with an expiry (typically one year). Once expired the connection
fails and you must regenerate the endpoint. Paste the token into <https://jwt.io> to read
its `exp` claim, or read the error from the dashboard's connection test.

### 9. Only stdio MCP tool servers are supported

Tool servers in `mcp.json` must be command-line programs (stdio transport).
SSE / HTTP MCP servers are not supported.

### 10. Known defect: `stop.sh` fallback cleanup can kill the wrong process

Besides stopping by PID file, `stop.sh` has a "fallback cleanup" that finds processes whose
command line mentions `server.js` / `guardian-multi.js` **and** whose working directory is
the project directory, then kills them.

**Side effect**: if your own terminal happens to be `cd`'d into the project directory and
its command line contains those strings, your terminal can be killed too.

The PID files are already precise enough, so this fallback is arguably unnecessary.
**This is not yet fixed** — if it happens, just open a new terminal.

### 11. Messaging tools may appear with a delay on first start

They are enabled when **actually connected** endpoints ≥ 2. Right after startup the
connections may not be established yet; wait ten seconds or so and refresh.

### 12. Tool output length is capped

The `system` "run command" and `code` execution tools cap their output; very long output
is truncated. Long-running tasks (e.g. compiling) may time out.

---

## Security notes

In order of importance:

1. **Never expose the dashboard port to the public internet.** Use Tailscale or similar.
2. **Guard your WSS token.** It is equivalent to control of this computer.
3. **Run as a normal user** unless you explicitly need root.
4. **Watch the logs.** `mcp.log` records every tool invocation.
5. **`config.js` / `endpoints.json` / `messages/` are gitignored** —
   don't commit them to a public repository.
6. **Disable tools you don't need** by removing them from `mcp.template.json`.

---

## Upgrading

### From v1.0.x to v1.1.x

v1.1.0 introduced a **breaking change**: endpoints now require a "user name".

```bash
./stop.sh
git pull && npm install      # or: npm install xiaozhi-mcp-bridge@latest

# 1. Add a user name to every endpoint
node config-cli.js list
node config-cli.js user <ENDPOINT_ID> "your-name"

# 2. If you have Chinese-named message history, migrate the filenames once
node migrate-message-files.js

# 3. Restart
./start.sh
```

> Legacy configs without a user name fall back to the endpoint name, but
> **setting it explicitly is strongly recommended**.

### Version history

See [CHANGELOG.md](CHANGELOG.md).

---

## License

[MIT](LICENSE)
