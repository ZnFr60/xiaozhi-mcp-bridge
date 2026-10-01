#!/usr/bin/env node
/**
 * 守护进程 v3 (Linux)：异常兜底 + 退避重启 + 刷屏自愈 + 定期重启
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.execPath;
const BRIDGE = path.join(__dirname, 'node_modules', 'mcp_exe', 'bin', 'cli.js');
// 从 config.js 读取小智接入点（config.js 已加入 .gitignore，不会泄露到公开仓库）
let WS = '';
try { WS = require('./config.js').xiaozhiWss; } catch { WS = process.env.XIAOZHI_WSS || ''; }
if (!WS) { console.error('错误：未配置小智接入点，请复制 config.example.js 为 config.js 并填入 token'); process.exit(1); }
const CONFIG = path.join(__dirname, 'mcp.json');
const LOGFILE = path.join(__dirname, 'mcp.log');

function ts() { return new Date().toISOString(); }

let logFd = fs.openSync(LOGFILE, 'a');
function log(msg) {
  try { fs.writeSync(logFd, `[${ts()}] guardian: ${msg}\n`); } catch {}
}

process.on('uncaughtException', (err) => { log(`uncaughtException: ${err && err.stack || err}`); });
process.on('unhandledRejection', (err) => { log(`unhandledRejection: ${err}`); });

const MIN_DELAY = 5000;
const MAX_DELAY = 30000;
const RESTART_INTERVAL = 2 * 60 * 60 * 1000; // 每 2 小时定期重启
const SPAM_THRESHOLD = 80;  // 10 秒内日志超过阈值判定为刷屏
const SPAM_WINDOW = 10000;

let restartDelay = MIN_DELAY;
let child = null;
let childStartTs = 0;
let logBaseSize = 0;

function startBridge() {
  log('starting mcp_exe...');
  try {
    child = spawn(NODE, [BRIDGE, '--ws', WS, '--mcp-config', CONFIG], {
      cwd: __dirname,
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
  child.on('spawn', () => { restartDelay = MIN_DELAY; });
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

// 刷屏检测：每 10 秒看日志增量
setInterval(() => {
  if (!child || child.exitCode !== null) return;
  const now = getLogSize();
  const growth = now - logBaseSize;
  logBaseSize = now;
  if (growth > SPAM_THRESHOLD * 200) {
    log(`LOG SPAM detected (growth=${growth} bytes in 10s), force restart bridge`);
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

log(`guardian (re)started, pid=${process.pid}, node=${NODE}`);
startBridge();
