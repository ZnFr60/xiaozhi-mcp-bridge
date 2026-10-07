#!/usr/bin/env node
/**
 * 多接入点守护进程
 *
 * 背景：本项目自带的 guardian.js 只支持 config.js 里的【单个】接入点；
 * 而 server.js 虽然有「多接入点管理」面板，却没有开机自启、也没有断线重连
 * （child.on('exit') 只删除记录，不拉起重连）。于是多接入点实际上只能靠手动点按钮，
 * 重启即全部掉线。
 *
 * 本文件补齐这两点，把 endpoints.json 作为唯一事实来源：
 *   - 开机为每个接入点各拉起一个 mcp_exe 长连接
 *   - 任一连接退出后按退避重连（5s 起，上限 30s）
 *   - 每 2 小时主动重启一次，规避长连接老化
 *   - 每 60 秒重新读取 endpoints.json，新增的接入点自动上线、删除的自动下线
 *
 * 其余行为（mcp.json 动态生成、日志落 mcp.log）与 guardian.js 保持一致。
 *
 * 注意：本进程与 server.js 面板的「启动」按钮是两个独立的管理者。
 * 同时用会对同一 token 建立重复连接，因此使用本守护时不要再用面板启动接入点。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.execPath;
const APP_DIR = __dirname;
// 依赖可能在本包的 node_modules，也可能被 npm 提升到上层 node_modules
const BRIDGE = require('./lib/mcp-config.js').resolveDep(APP_DIR, 'mcp_exe', 'bin/cli.js');
const CONFIG = path.join(APP_DIR, 'mcp.json');
const ENDPOINTS_FILE = path.join(APP_DIR, 'endpoints.json');
const RUNTIME_STATE_FILE = path.join(APP_DIR, 'runtime-state.json');
const STATUS_FILE = path.join(APP_DIR, 'guardian-status.json');
const PID_FILE = path.join(APP_DIR, 'guardian.pid');
const LOGFILE = path.join(APP_DIR, 'mcp.log');

// mcp_exe 连上 WebSocket 时打印的标志（中英文各一，兼容不同版本）
const CONNECT_MARKERS = ['成功连接到WebSocket服务器', 'Successfully connected to server'];

const MIN_DELAY = 5000;
const MAX_DELAY = 30000;
const RESTART_INTERVAL = 2 * 60 * 60 * 1000; // 每 2 小时
const SCAN_INTERVAL = 60 * 1000;             // 每 60 秒同步一次接入点列表

// ---------- 动态生成 mcp.json（与 guardian.js 一致） ----------
let mcpConfigLib;
try {
  mcpConfigLib = require('./lib/mcp-config.js');
  mcpConfigLib.generateMcpConfig(APP_DIR);
} catch (e) {
  console.error('生成 mcp.json 失败: ' + e.message);
  process.exit(1);
}

// ---------- 日志 ----------
let logFd = fs.openSync(LOGFILE, 'a');
function ts() { return new Date().toISOString(); }
function log(msg) {
  try { fs.writeSync(logFd, `[${ts()}] multi: ${msg}\n`); } catch {}
}

/**
 * 把【实际连接状态】落盘，供 message-tools.js 判定是否启用消息工具。
 *
 * 原项目让 message-tools.js 去数 endpoints.json 的条目数，等于把"配置"当"状态"：
 * 加了两条但一条都没连上时工具照样暴露。这里提供真实状态作为判定依据。
 */
function writeRuntimeState() {
  const endpoints = [];
  for (const [id, entry] of bridges) {
    endpoints.push({
      id,
      name: entry.name,
      connected: !!entry.connected,
      pid: entry.child ? entry.child.pid : null,
      startedAt: entry.startTs || null,
    });
  }
  const tmp = `${RUNTIME_STATE_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), endpoints }, null, 2), 'utf8');
    fs.renameSync(tmp, RUNTIME_STATE_FILE);
  } catch (e) {
    log('写 runtime-state.json 失败: ' + e.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
  writeGuardianStatus(endpoints);
}

/**
 * 写 guardian-status.json 与 guardian.pid。
 *
 * 1.0.8 的单接入点 guardian.js 会写这两个文件：Web 面板的「守护进程」指示读
 * guardian-status.json，start.sh / stop.sh 靠 guardian.pid 精准停进程。
 * 多接入点守护必须保持同样的约定，否则面板会显示 guardian not_running，
 * 且脱离 start.sh 直接运行时 stop.sh 找不到进程。
 */
function writeGuardianStatus(endpoints) {
  try {
    const list = endpoints || [...bridges.values()].map(e => ({ connected: !!e.connected }));
    const connected = list.filter(e => e && e.connected).length;
    const state = !list.length ? 'empty'
      : (connected === list.length ? 'connected'
        : (connected > 0 ? 'partial' : 'disconnected'));
    const status = {
      pid: process.pid,
      running: true,
      state,
      endpoints: list.length,
      connected,
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${STATUS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(status, null, 2), 'utf8');
    fs.renameSync(tmp, STATUS_FILE);
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (e) {
    log('写 guardian-status.json / guardian.pid 失败: ' + e.message);
  }
}

process.on('uncaughtException', (err) => { log(`uncaughtException: ${err && err.stack || err}`); });
process.on('unhandledRejection', (err) => { log(`unhandledRejection: ${err}`); });

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
if (PROXY) log(`检测到代理环境变量: ${PROXY}（ws 库默认不支持 HTTP 代理）`);

// ---------- 接入点列表 ----------
function loadEndpoints() {
  try {
    const raw = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(e => e && e.id && e.wss)
      .map(e => ({
        id: String(e.id),
        name: String(e.name || e.id),
        // 消息收发使用的身份名。老配置没有该字段时退回 name，保证向后兼容。
        userName: String(e.userName || e.name || e.id).trim(),
        wss: String(e.wss),
      }));
  } catch (e) {
    return [];
  }
}

/** 除自己之外其他接入点的用户名称，注入给 message-tools.js 供 AI 参考 */
function peerUserNames(selfId) {
  return loadEndpoints()
    .filter(e => e.id !== selfId)
    .map(e => e.userName)
    .filter(Boolean);
}

const bridges = new Map(); // id -> { child, delay, startTs, name }

function startEndpoint(ep) {
  if (bridges.has(ep.id)) return;
  const entry = { child: null, delay: MIN_DELAY, startTs: 0, name: ep.name || ep.id, connected: false };
  bridges.set(ep.id, entry);
  spawnChild(ep, entry);
}

function spawnChild(ep, entry) {
  log(`[${entry.name}] starting mcp_exe (id=${ep.id}, userName=${ep.userName})`);

  // 为该接入点生成独立 mcp 配置，把身份通过 env 传给 message-tools.js。
  // 这是让消息收发用对名字的根本手段：身份来自配置，不依赖模型自填、也不靠进程推断。
  let epConfig = CONFIG;
  try {
    epConfig = mcpConfigLib.generateMcpConfig(APP_DIR, {
      outFile: `mcp-${ep.id}.json`,
      messageEnv: {
        XZ_ENDPOINT_ID: ep.id,
        XZ_ENDPOINT_USERNAME: ep.userName,
        XZ_PEERS: peerUserNames(ep.id).join(','),
      },
    });
  } catch (e) {
    log(`[${entry.name}] 生成独立 mcp 配置失败，退回共享配置: ${e.message}`);
  }

  let child;
  try {
    child = spawn(NODE, [BRIDGE, '--ws', ep.wss, '--mcp-config', epConfig], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    log(`[${entry.name}] spawn threw: ${e.message}`);
    scheduleRestart(ep, entry);
    return;
  }
  entry.child = child;
  entry.startTs = Date.now();
  // 透传子进程输出到 mcp.log，同时从中识别"已连接"标志
  const onData = (d) => {
    try { fs.writeSync(logFd, d); } catch {}
    if (!entry.connected) {
      const text = d.toString();
      if (CONNECT_MARKERS.some(m => text.includes(m))) {
        entry.connected = true;
        log(`[${entry.name}] 已连接`);
        writeRuntimeState();
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => { log(`[${entry.name}] child error: ${err.message}`); });
  child.on('spawn', () => {
    entry.delay = MIN_DELAY;
    log(`[${entry.name}] mcp_exe spawned successfully pid=${child.pid}`);
  });
  child.on('exit', (code) => {
    entry.child = null;
    entry.connected = false;
    log(`[${entry.name}] mcp_exe exited code=${code}, restart in ${entry.delay / 1000}s`);
    writeRuntimeState();
    scheduleRestart(ep, entry);
  });
}

function scheduleRestart(ep, entry) {
  const delay = entry.delay;
  entry.delay = Math.min(entry.delay + MIN_DELAY, MAX_DELAY);
  setTimeout(() => {
    // 期间若该接入点已被移除，则不再拉起
    if (bridges.get(ep.id) !== entry) return;
    spawnChild(ep, entry);
  }, delay);
}

function stopEndpoint(id, reason) {
  const entry = bridges.get(id);
  if (!entry) return;
  bridges.delete(id);
  entry.connected = false;
  if (entry.child) {
    log(`[${entry.name}] stopping (${reason})`);
    try { entry.child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { entry.child && entry.child.kill('SIGKILL'); } catch {} }, 3000);
  }
  writeRuntimeState();
}

// ---------- 与 endpoints.json 同步 ----------
function syncEndpoints() {
  const eps = loadEndpoints();
  const wantIds = new Set(eps.map(e => e.id));
  for (const ep of eps) {
    if (!bridges.has(ep.id)) {
      log(`新增接入点: ${ep.name || ep.id}`);
      startEndpoint(ep);
    }
  }
  for (const id of [...bridges.keys()]) {
    if (!wantIds.has(id)) stopEndpoint(id, '已从 endpoints.json 移除');
  }
  return eps.length;
}

// ---------- 定期重启（规避长连接老化） ----------
setInterval(() => {
  for (const [id, entry] of bridges) {
    if (!entry.child) continue;
    const uptime = Date.now() - entry.startTs;
    if (uptime >= RESTART_INTERVAL) {
      log(`[${entry.name}] 定期重启（已运行 ${Math.round(uptime / 60000)} 分钟）`);
      try { entry.child.kill('SIGTERM'); } catch {}
    }
  }
}, 60 * 1000);

// ---------- 同步循环 ----------
setInterval(() => {
  try { syncEndpoints(); } catch (e) { log('syncEndpoints 异常: ' + e.message); }
}, SCAN_INTERVAL);

// ---------- 连接状态刷新 ----------
// 状态变化时已即时落盘，这里只做兜底刷新（本进程被 SIGKILL 等情况下的自愈）
setInterval(() => { try { writeRuntimeState(); } catch {} }, 15000);

// 退出时先收掉所有子进程，再清理状态文件。
//
// 必须显式杀子进程：被 kill 的进程其子进程只会被 init/systemd 收养而不会消失
// （实测 stop.sh 之后 mcp_exe 仍以 ppid=1/systemd 继续运行并占着 WebSocket 长连接，
//  下次启动就会变成同 token 的重复连接）。
function clearStateFiles() {
  try { fs.unlinkSync(RUNTIME_STATE_FILE); } catch {}
  try { fs.unlinkSync(STATUS_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  const children = [];
  for (const [, entry] of bridges) if (entry.child) children.push(entry.child);
  log(`收到 ${sig}，正在停止 ${children.length} 个子进程…`);

  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  const forceTimer = setTimeout(() => {
    for (const c of children) { try { c.kill('SIGKILL'); } catch {} }
    clearStateFiles();
    process.exit(0);
  }, 1500);
  forceTimer.unref?.();

  // 子进程全部退出后立刻收尾
  let pending = children.length;
  if (!pending) { clearStateFiles(); process.exit(0); }
  for (const c of children) {
    c.once('exit', () => {
      if (--pending <= 0) { clearTimeout(forceTimer); clearStateFiles(); process.exit(0); }
    });
  }
  // 同时屏蔽"重启"调度，避免退出过程中又拉起新子进程
  bridges.clear();
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => shutdown(sig));
}
process.on('exit', () => { try { clearStateFiles(); } catch {} });

// ---------- 启动 ----------
const count = syncEndpoints();
writeRuntimeState();
log(`multi-guardian started, pid=${process.pid}, node=${NODE}`);
log(`app_dir=${APP_DIR}, 接入点数量=${count}`);
if (count === 0) {
  log('警告：endpoints.json 中没有可用接入点，请用 config-cli.js add 添加');
}
