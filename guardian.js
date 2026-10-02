#!/usr/bin/env node
/**
 * 守护进程 v4：动态生成 mcp.json + 异常兜底 + 退避重启 + 刷屏自愈 + 定期重启 + 代理检测
 *
 * 修复：
 * - mcp.json 路径不再硬编码，启动时从 mcp.template.json 动态生成绝对路径
 * - 刷屏检测阈值提高 + 30秒启动宽限期（避免启动日志密集导致死循环）
 * - 检测 HTTPS_PROXY/HTTP_PROXY 环境变量并提示
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const APP_DIR = __dirname;
const BRIDGE = path.join(APP_DIR, 'node_modules', 'mcp_exe', 'bin', 'cli.js');
const CONFIG = path.join(APP_DIR, 'mcp.json');
const LOGFILE = path.join(APP_DIR, 'mcp.log');
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

// ---------- 动态生成 mcp.json（从模板） ----------
try {
  generateMcpConfig(APP_DIR);
} catch (e) {
  console.error('生成 mcp.json 失败: ' + e.message);
  process.exit(1);
}

// ---------- 日志 ----------
function ts() { return new Date().toISOString(); }
let logFd = fs.openSync(LOGFILE, 'a');
function log(msg) {
  try { fs.writeSync(logFd, `[${ts()}] guardian: ${msg}\n`); } catch {}
}

process.on('uncaughtException', (err) => { log(`uncaughtException: ${err && err.stack || err}`); });
process.on('unhandledRejection', (err) => { log(`unhandledRejection: ${err}`); });

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
const RESTART_INTERVAL = 2 * 60 * 60 * 1000; // 每 2 小时定期重启
const SPAM_THRESHOLD = 500;       // 10 秒内日志超过 100KB 判定为刷屏（原 16KB 过低）
const SPAM_WINDOW = 10000;
const STARTUP_GRACE = 30000;      // 启动后 30 秒内不做刷屏检测

let restartDelay = MIN_DELAY;
let child = null;
let childStartTs = 0;
let logBaseSize = 0;

function startBridge() {
  log('starting mcp_exe...');
  log(`  ws: ${WS.slice(0, 50)}...`);
  log(`  filesystem root: ${FILESYSTEM_ROOT}`);
  if (PROXY) log(`  proxy: ${PROXY}`);

  try {
    child = spawn(NODE, [BRIDGE, '--ws', WS, '--mcp-config', CONFIG], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    log('spawn threw: ' + e.message);
    setTimeout(startBridge, restartDelay);
    return;
  }
  childStartTs = Date.now();
  logBaseSize = getLogSize();
  child.stdout.on('data', (d) => { try { fs.writeSync(logFd, d); } catch {} });
  child.stderr.on('data', (d) => { try { fs.writeSync(logFd, d); } catch {} });
  child.on('error', (err) => { log('child error: ' + err.message); scheduleRestart(); });
  child.on('spawn', () => { restartDelay = MIN_DELAY; log('mcp_exe spawned successfully'); });
  child.on('exit', (code) => {
    log(`mcp_exe exited code=${code}, restart in ${restartDelay / 1000}s`);
    scheduleRestart();
  });
}

function getLogSize() {
  try { return fs.statSync(LOGFILE).size; } catch { return 0; }
}

function scheduleRestart() {
  const delay = restartDelay;
  restartDelay = Math.min(restartDelay + MIN_DELAY, MAX_DELAY);
  setTimeout(startBridge, delay);
}

// 刷屏检测：每 10 秒看日志增量（启动宽限期内跳过）
setInterval(() => {
  if (!child || child.exitCode !== null) return;
  // 启动宽限期：前 30 秒不检测（启动日志必然密集）
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

// 定期重启：每 2 小时
setInterval(() => {
  if (!child || child.exitCode !== null) return;
  const uptime = Date.now() - childStartTs;
  if (uptime >= RESTART_INTERVAL) {
    log(`scheduled restart after ${Math.round(uptime / 60000)} min uptime`);
    try { child.kill('SIGTERM'); } catch {}
  }
}, 60 * 1000);

log(`guardian v4 started, pid=${process.pid}, node=${NODE}`);
log(`mcp.json generated from template, app_dir=${APP_DIR}`);
startBridge();
