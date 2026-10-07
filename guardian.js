#!/usr/bin/env node
/**
 * 守护进程 v5：JWT预校验 + 401熔断 + 日志轮转 + 动态mcp.json + 异常兜底 + 退避重启 + 刷屏自愈 + 定期重启
 *
 * v5 新增:
 * - 启动时 JWT 本地预校验（过期/purpose错误/格式非法 → 人话提示，不启动）
 * - 401/403 永久错误熔断（识别后停止重试，写状态文件）
 * - mcp.log 内置轮转（超 10MB 自动 rename .1 重开）
 * - 状态文件 guardian-status.json（供 Web 面板读取守护态）
 * - PID 文件 guardian.pid（供 start.sh 管理进程）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const APP_DIR = __dirname;
const BRIDGE = require('./lib/mcp-config.js').resolveDep(APP_DIR, 'mcp_exe', 'bin/cli.js');
const CONFIG = path.join(APP_DIR, 'mcp.json');
const LOGFILE = path.join(APP_DIR, 'mcp.log');
const STATUS_FILE = path.join(APP_DIR, 'guardian-status.json');
const PID_FILE = path.join(APP_DIR, 'guardian.pid');
const { generateMcpConfig } = require('./lib/mcp-config.js');

// ---------- 配置读取 ----------
let WS = '';
let FILESYSTEM_ROOT = '';
try {
  const cfg = require('./config.js');
  WS = cfg.xiaozhiWss || '';
  FILESYSTEM_ROOT = cfg.filesystemRoot || '';
} catch {}
if (!WS) WS = process.env.XIAOZHI_WSS || '';
if (!FILESYSTEM_ROOT) FILESYSTEM_ROOT = process.env.MCP_FILESYSTEM_ROOT || os.homedir();

if (!WS) {
  console.error('错误：未配置小智接入点，请复制 config.example.js 为 config.js 并填入 token');
  console.error('  或设置环境变量 XIAOZHI_WSS');
  process.exit(1);
}

// ---------- JWT 预校验 ----------
function extractToken(wss) {
  const m = wss.match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function base64UrlDecode(str) {
  try {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
  } catch { return null; }
}

function validateJwt(wss) {
  const token = extractToken(wss);
  if (!token) return { ok: false, error: 'URL 中未找到 token 参数，格式应为 wss://api.xiaozhi.me/mcp/?token=...' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: `Token 格式不合法：不是标准 JWT（应有3段，当前${parts.length}段）。请确认复制完整，不要遗漏字符。` };

  const header = base64UrlDecode(parts[0]);
  const payload = base64UrlDecode(parts[1]);
  if (!header || !payload) return { ok: false, error: 'Token 解码失败：base64 解析出错，token 可能被截断或包含非法字符。' };

  // 检查过期
  if (payload.exp) {
    const expDate = new Date(payload.exp * 1000);
    if (Date.now() > payload.exp * 1000) {
      return { ok: false, error: `Token 已过期（exp = ${expDate.toLocaleString('zh-CN')}）。请重新获取小智 MCP 接入点 token。` };
    }
  }

  // 检查 purpose
  if (payload.purpose && payload.purpose !== 'mcp-endpoint') {
    return { ok: false, error: `Token 的 purpose 不正确（当前: ${payload.purpose}，期望: mcp-endpoint）。请确认使用的是 MCP 接入点 token 而非其他类型。` };
  }

  // 检查签名段长度（粗略检测截断）
  if (parts[2].length < 10) {
    return { ok: false, error: `Token 签名段过短（${parts[2].length}字符），可能被截断。请重新复制完整 token。` };
  }

  return {
    ok: true,
    info: {
      userId: payload.userId || '未知',
      agentId: payload.agentId || '未知',
      endpointId: payload.endpointId || '未知',
      purpose: payload.purpose || '未知',
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toLocaleString('zh-CN') : '未知'
    }
  };
}

const jwtResult = validateJwt(WS);
if (!jwtResult.ok) {
  console.error('========================================');
  console.error('  ❌ Token 预校验失败，守护进程不启动');
  console.error('========================================');
  console.error('');
  console.error('  ' + jwtResult.error);
  console.error('');
  console.error('  请检查 config.js 中的 xiaozhiWss 配置');
  console.error('  或运行: node config-cli.js token "wss://..."');
  console.error('========================================');
  // 写状态文件
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ state: 'fatal', error: jwtResult.error, timestamp: Date.now() }, null, 2)); } catch {}
  process.exit(1);
}

// ---------- 动态生成 mcp.json（从模板） ----------
try {
  generateMcpConfig(APP_DIR);
} catch (e) {
  console.error('生成 mcp.json 失败: ' + e.message);
  process.exit(1);
}

// ---------- 日志（带轮转） ----------
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
function ts() { return new Date().toISOString(); }
let logFd = fs.openSync(LOGFILE, 'a');

function rotateLogIfNeeded() {
  try {
    const size = fs.fstatSync(logFd).size;
    if (size >= MAX_LOG_SIZE) {
      fs.closeSync(logFd);
      const old = LOGFILE + '.1';
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(LOGFILE, old);
      logFd = fs.openSync(LOGFILE, 'a');
      return true;
    }
  } catch {}
  return false;
}

function log(msg) {
  try {
    rotateLogIfNeeded();
    fs.writeSync(logFd, `[${ts()}] guardian: ${msg}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => { log(`uncaughtException: ${err && err.stack || err}`); });
process.on('unhandledRejection', (err) => { log(`unhandledRejection: ${err}`); });

// ---------- 状态文件 ----------
function writeStatus(state, extra = {}) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      state,
      pid: process.pid,
      timestamp: Date.now(),
      ...extra
    }, null, 2));
  } catch {}
}

// 写 PID 文件
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });

// ---------- 代理检测 ----------
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
if (PROXY) {
  log(`检测到代理环境变量: ${PROXY}`);
  log('注意: mcp_exe 的 ws 库默认不支持 HTTP 代理，WebSocket 可能无法连接');
  log('  解决方案: 在无代理环境运行，或使用 proxychains 等工具包装 node 进程');
}

// ---------- 守护参数 ----------
const MIN_DELAY = 5000;
const MAX_DELAY = 30000;
const RESTART_INTERVAL = 2 * 60 * 60 * 1000;
const SPAM_THRESHOLD = 500;
const SPAM_WINDOW = 10000;
const STARTUP_GRACE = 30000;

let restartDelay = MIN_DELAY;
let child = null;
let childStartTs = 0;
let logBaseSize = 0;
let permanentError = null; // 401/403 等永久错误
let attemptCount = 0;

function startBridge() {
  if (permanentError) {
    log(`永久错误未解决，不重试: ${permanentError}`);
    return;
  }

  attemptCount++;
  log(`starting mcp_exe (attempt ${attemptCount})...`);
  log(`  ws: ${WS.slice(0, 50)}...`);
  log(`  token 用户: ${jwtResult.info.userId}, 过期: ${jwtResult.info.expiresAt}`);
  log(`  filesystem root: ${FILESYSTEM_ROOT}`);
  if (PROXY) log(`  proxy: ${PROXY}`);

  writeStatus('connecting', { attempt: attemptCount });

  try {
    child = spawn(NODE, [BRIDGE, '--ws', WS, '--mcp-config', CONFIG], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    log('spawn threw: ' + e.message);
    scheduleRestart();
    return;
  }
  childStartTs = Date.now();
  logBaseSize = getLogSize();

  let stdoutBuf = '';
  child.stdout.on('data', (d) => {
    try {
      rotateLogIfNeeded();
      fs.writeSync(logFd, d);
      // 检测 401/403
      const text = d.toString();
      if (/401|403|Unauthorized|Forbidden/i.test(text)) {
        handleAuthError(text);
      }
      // 检测连接成功
      if (/成功连接|connected|initialize/i.test(text)) {
        writeStatus('connected', { attempt: attemptCount, connectedAt: Date.now() });
        restartDelay = MIN_DELAY;
      }
    } catch {}
  });
  child.stderr.on('data', (d) => {
    try {
      rotateLogIfNeeded();
      fs.writeSync(logFd, d);
      const text = d.toString();
      if (/401|403|Unauthorized|Forbidden/i.test(text)) {
        handleAuthError(text);
      }
    } catch {}
  });
  child.on('error', (err) => { log('child error: ' + err.message); scheduleRestart(); });
  child.on('spawn', () => { log('mcp_exe spawned successfully'); });
  child.on('exit', (code) => {
    log(`mcp_exe exited code=${code}, restart in ${restartDelay / 1000}s`);
    if (!permanentError) writeStatus('reconnecting', { attempt: attemptCount, exitCode: code });
    scheduleRestart();
  });
}

function handleAuthError(text) {
  if (permanentError) return; // 已熔断
  permanentError = '认证失败 (401/403)：token 无效、已过期或权限不足。请检查 config.js 中的 token，或运行 node config-cli.js token 重新设置。';
  log('========================================');
  log('❌ 检测到认证失败 (401/403)，触发永久错误熔断');
  log('  错误片段: ' + text.slice(0, 200).replace(/\n/g, ' '));
  log('  不再重试。请检查 token 后重启守护进程。');
  log('  命令: node config-cli.js token "wss://..."');
  log('========================================');
  writeStatus('fatal', { error: permanentError, attempt: attemptCount });
  // 杀掉当前子进程
  try { child && child.kill('SIGKILL'); } catch {}
}

function getLogSize() {
  try { return fs.statSync(LOGFILE).size; } catch { return 0; }
}

function scheduleRestart() {
  if (permanentError) return; // 永久错误不重试
  const delay = restartDelay;
  restartDelay = Math.min(restartDelay + MIN_DELAY, MAX_DELAY);
  setTimeout(startBridge, delay);
}

// 刷屏检测
setInterval(() => {
  if (!child || child.exitCode !== null || permanentError) return;
  if (Date.now() - childStartTs < STARTUP_GRACE) {
    logBaseSize = getLogSize();
    return;
  }
  const now = getLogSize();
  const growth = now - logBaseSize;
  logBaseSize = now;
  if (growth > SPAM_THRESHOLD * 200) {
    log(`LOG SPAM detected (growth=${growth} bytes in 10s > ${SPAM_THRESHOLD * 200}), force restart bridge`);
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { child && child.kill('SIGKILL'); } catch {} }, 2000);
  }
}, SPAM_WINDOW);

// 定期重启
setInterval(() => {
  if (!child || child.exitCode !== null || permanentError) return;
  const uptime = Date.now() - childStartTs;
  if (uptime >= RESTART_INTERVAL) {
    log(`scheduled restart after ${Math.round(uptime / 60000)} min uptime`);
    try { child.kill('SIGTERM'); } catch {}
  }
}, 60 * 1000);

// ---------- 退出时收掉子进程 ----------
// 被 kill 的进程其子进程只会被 init/systemd 收养而不会消失：
// 若不显式停止，stop.sh 之后 mcp_exe 仍会占着 WebSocket 长连接，
// 下次启动即变成同 token 的重复连接。
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`收到 ${sig}，正在停止子进程…`);
  try { child && child.kill('SIGTERM'); } catch {}
  const t = setTimeout(() => {
    try { child && child.kill('SIGKILL'); } catch {}
    cleanupFiles();
    process.exit(0);
  }, 1500);
  t.unref?.();
  if (!child || child.exitCode !== null) { clearTimeout(t); cleanupFiles(); process.exit(0); }
  child.once('exit', () => { clearTimeout(t); cleanupFiles(); process.exit(0); });
}
function cleanupFiles() {
  try { fs.unlinkSync(STATUS_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => shutdown(sig));
}

log(`guardian v5 started, pid=${process.pid}, node=${NODE}`);
log(`token 校验通过: 用户=${jwtResult.info.userId}, 过期=${jwtResult.info.expiresAt}`);
log(`mcp.json generated from template, app_dir=${APP_DIR}`);
log(`log rotation: max ${MAX_LOG_SIZE / 1024 / 1024}MB`);
startBridge();
