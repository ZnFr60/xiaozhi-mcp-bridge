#!/usr/bin/env node
/**
 * 实用工具 MCP 服务器（stdio）— 跨平台版
 * Windows: PowerShell | Linux/macOS: bash
 * 包含：系统状态、当前时间、本地记事本、执行命令、DeepSeek Harness (dsh)、密码/二维码/单位换算
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const SHELL = IS_WINDOWS ? 'powershell.exe' : '/bin/bash';
const SHELL_NAME = IS_WINDOWS ? 'PowerShell' : 'Bash';

const NOTES_FILE = path.join(__dirname, 'notes.json');

function loadNotes() {
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); }
  catch { return []; }
}
function saveNotes(notes) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return `${d}天 ${h}时 ${m}分`;
}
function fmtGB(b) { return (b / 1073741824).toFixed(1) + ' GB'; }

function diskInfo() {
  try {
    if (IS_WINDOWS) {
      const out = execSync('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N=\'Used(GB)\';E={[math]::Round($_.Used/1GB,1)}},@{N=\'Free(GB)\';E={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize"', { encoding: 'utf8' });
      return out.trim();
    } else {
      const out = execSync('df -h --output=source,size,used,avail,pcent,target 2>/dev/null | grep -v tmpfs | grep -v overlay', { encoding: 'utf8' });
      return out.trim();
    }
  } catch (e) {
    return '  (磁盘信息获取失败: ' + e.message + ')';
  }
}

function systemStatus() {
  const cpus = os.cpus();
  const load1 = os.loadavg()[0];
  const totalMem = os.totalmem(), freeMem = os.freemem();
  const usedPct = (((totalMem - freeMem) / totalMem) * 100).toFixed(0);
  return [
    `主机: ${os.hostname()}`,
    `系统: ${os.type()} ${os.release()} (${os.arch})`,
    `命令行: ${SHELL_NAME}`,
    `CPU: ${cpus[0] ? cpus[0].model : '未知'}  (${cpus.length} 核)  1分钟负载: ${load1.toFixed(2)}`,
    `内存: 已用 ${usedPct}%  (${fmtGB(totalMem - freeMem)} / ${fmtGB(totalMem)})`,
    `运行: ${fmtUptime(os.uptime())}`,
    `磁盘:\n${diskInfo()}`
  ].join('\n');
}

function nowInfo() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `现在是 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ` +
    `(时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

/**
 * 跨平台执行命令：Windows 用 PowerShell，Linux/macOS 用 bash
 */
async function runCommand(command, timeoutSec) {
  return new Promise((resolve) => {
    const t = Number.isFinite(timeoutSec) ? Math.min(timeoutSec, 120) * 1000 : 30000;
    const shellArgs = IS_WINDOWS
      ? ['-NoProfile', '-NonInteractive', '-Command', String(command)]
      : ['-c', String(command)];
    const child = spawn(SHELL, shellArgs, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const killer = setTimeout(() => { try { child.kill(IS_WINDOWS ? 'SIGTERM' : 'SIGKILL'); } catch {} }, t);
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-1024 * 1024); });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024); });
    child.on('error', (e) => { clearTimeout(killer); resolve('【错误】启动 ' + SHELL_NAME + ' 失败: ' + e.message); });
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      let out = '';
      if (stdout.trim()) out += '【输出】\n' + stdout.trim() + '\n';
      if (stderr.trim()) out += '【错误】\n' + stderr.trim() + '\n';
      if (!out) out = '(无输出)';
      if (signal) out += '\n[命令被终止: ' + signal + ']';
      else if (code !== 0 && code !== null) out += '\n[退出码 ' + code + ']';
      resolve(out);
    });
  });
}

function findDsh() {
  try {
    const cmd = IS_WINDOWS ? 'where dsh' : 'which dsh 2>/dev/null';
    const p = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0].trim();
    return p || null;
  } catch { return null; }
}

async function runDsh(task, cwd, timeoutSec) {
  const dshPath = findDsh();
  if (!dshPath) {
    return '本机未安装 DeepSeek Harness (dsh)。请先安装：\n  npm install -g @deepseek-ai/dsh\n安装后重启桥接即可使用 run_dsh 工具。';
  }
  return new Promise((resolve) => {
    const t = Number.isFinite(timeoutSec) ? Math.min(timeoutSec, 600) * 1000 : 180000;
    const cwdSafe = cwd || (IS_WINDOWS ? process.env.USERPROFILE : process.env.HOME);
    let stdout = '', stderr = '';
    let child;
    try {
      child = spawn(dshPath, ['--profile', 'headless', String(task || '')], {
        cwd: cwdSafe,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: IS_WINDOWS  // Windows 上 dsh 可能是 .cmd，需要 shell
      });
    } catch (e) { return resolve('启动 dsh 失败: ' + e.message); }
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, t);
    child.stdout.on('data', (d) => { stdout += d.toString(); if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-1024 * 1024); });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024); });
    child.on('error', (e) => { clearTimeout(killer); resolve('dsh 运行错误: ' + e.message); });
    child.on('close', (code) => {
      clearTimeout(killer);
      const parts = [];
      if (stdout.trim()) parts.push(stdout.trim());
      if (stderr.trim()) parts.push('--- stderr ---\n' + stderr.trim());
      parts.push(`[dsh 退出码 ${code}]`);
      resolve(parts.join('\n\n'));
    });
  });
}

function passwordGen(length = 16, opts = {}) {
  const nums = '0123456789';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const syms = '!@#$%^&*()-_=+[]{};:,.<>?';
  let chars = lower;
  if (opts.numbers !== false) chars += nums;
  if (opts.uppercase !== false) chars += upper;
  if (opts.symbols !== false) chars += syms;
  const len = Math.min(Math.max(length, 4), 64);
  const arr = new Uint32Array(len);
  crypto.randomFillSync(arr);
  return Array.from(arr, (v) => chars[v % chars.length]).join('');
}

function qrcodeGen(text, size = 256) {
  const url = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size + '&data=' + encodeURIComponent(text);
  return `二维码已生成:\n  内容: ${text}\n  图片 URL: ${url}\n（在浏览器打开即可查看/下载）`;
}

function unitConvert(value, from, to) {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const v = Number(value);
  if (isNaN(v)) return '数值无效';
  const len = { m: 1, km: 1000, cm: 0.01, mm: 0.001, ft: 0.3048, inch: 0.0254, mile: 1609.344, yd: 0.9144 };
  const wt = { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, t: 1000 };
  if (len[f] && len[t]) return `${v}${from} = ${(v * len[f] / len[t]).toFixed(6)}${to}`;
  if (wt[f] && wt[t]) return `${v}${from} = ${(v * wt[f] / wt[t]).toFixed(6)}${to}`;
  if ((f === 'c' || f === 'f' || f === 'k') && (t === 'c' || t === 'f' || t === 'k')) {
    let c;
    if (f === 'c') c = v;
    else if (f === 'f') c = (v - 32) * 5 / 9;
    else c = v - 273.15;
    let r;
    if (t === 'c') r = c;
    else if (t === 'f') r = c * 9 / 5 + 32;
    else r = c + 273.15;
    return `${v}°${from.toUpperCase()} = ${r.toFixed(2)}°${to.toUpperCase()}`;
  }
  return `不支持的单位换算: ${from} -> ${to}。支持长度(m/km/cm/mm/ft/inch/mile/yd)、重量(kg/g/mg/lb/oz/t)、温度(C/F/K)`;
}

const TOOLS = [
  {
    name: 'get_system_status',
    description: '查看本机系统状态：主机名、操作系统、命令行类型、CPU型号与核数、内存占用、磁盘空间、运行时间。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_current_time',
    description: '获取本机当前日期、时间、星期和时区。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_note',
    description: '往本地记事本添加一条备忘，下次调用 list_notes 可读取。',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: '备忘内容' } },
      required: ['content']
    }
  },
  {
    name: 'list_notes',
    description: '列出本地记事本里的全部备忘。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'clear_notes',
    description: '清空本地记事本。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'run_command',
    description: '在本机执行命令行。Windows 自动用 PowerShell，Linux/macOS 自动用 Bash，返回标准输出和错误输出。适合执行系统命令、查进程、调用系统工具等。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令（Windows用PowerShell语法，Linux用bash语法），例如 ls -la 或 Get-Process' },
        timeout: { type: 'number', description: '超时秒数，默认 30，最大 120' }
      },
      required: ['command']
    }
  },
  {
    name: 'run_dsh',
    description: '向本机的 DeepSeek Harness (dsh) 下达一个任务，由 dsh 这个 AI Agent 在本机自主完成（读文件、跑命令、改代码等），完成后返回结果。需本机已安装 dsh。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '给 dsh 的任务指令' },
        cwd: { type: 'string', description: '工作目录，默认用户主目录' },
        timeout: { type: 'number', description: '超时秒数，默认 180，最大 600' }
      },
      required: ['task']
    }
  },
  {
    name: 'password_gen',
    description: '生成随机密码，可指定长度和字符类型。',
    inputSchema: {
      type: 'object',
      properties: {
        length: { type: 'number', description: '密码长度，默认 16，最大 64' },
        numbers: { type: 'boolean', description: '包含数字，默认 true' },
        symbols: { type: 'boolean', description: '包含特殊符号，默认 true' },
        uppercase: { type: 'boolean', description: '包含大写字母，默认 true' },
        count: { type: 'number', description: '生成数量，默认 1，最大 10' }
      }
    }
  },
  {
    name: 'qrcode_gen',
    description: '生成二维码图片，返回图片 URL，可直接在浏览器打开或下载。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '二维码内容（文本/URL）' },
        size: { type: 'number', description: '图片尺寸像素，默认 256' }
      },
      required: ['text']
    }
  },
  {
    name: 'unit_convert',
    description: '单位换算，支持长度(米/千米/英尺/英里)、重量(千克/克/磅)、温度(摄氏度/华氏度/开尔文)。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: '数值' },
        from: { type: 'string', description: '源单位：m/km/ft/mile/kg/g/lb/C/F/K' },
        to: { type: 'string', description: '目标单位' }
      },
      required: ['value', 'from', 'to']
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'get_system_status': return systemStatus();
    case 'get_current_time': return nowInfo();
    case 'add_note': {
      const notes = loadNotes();
      const item = { id: notes.length + 1, time: new Date().toISOString(), content: String(args.content || '') };
      notes.push(item); saveNotes(notes);
      return `已保存第 ${item.id} 条备忘: ${item.content}`;
    }
    case 'list_notes': {
      const notes = loadNotes();
      if (!notes.length) return '记事本为空。';
      return '备忘列表（共 ' + notes.length + ' 条）:\n' +
        notes.map(n => `  [${n.id}] ${n.time.replace('T', ' ').slice(0, 16)}  ${n.content}`).join('\n');
    }
    case 'clear_notes': saveNotes([]); return '记事本已清空。';
    case 'run_command': return await runCommand(String(args.command || ''), args.timeout);
    case 'run_dsh': return await runDsh(args.task, args.cwd, args.timeout);
    case 'password_gen': {
      const n = Math.min(Math.max(args.count || 1, 1), 10);
      return Array.from({ length: n }, () => passwordGen(args.length, args)).join('\n');
    }
    case 'qrcode_gen': return qrcodeGen(String(args.text || ''), Number(args.size) || 256);
    case 'unit_convert': return unitConvert(args.value, String(args.from || ''), String(args.to || ''));
    default: throw new Error('未知工具: ' + name);
  }
}

// ---------- MCP stdio 协议 ----------
const READY = '2024-11-05';
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleLine(line);
  }
});
async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'system-tools', version: '2.0.0' } } });
  } else if (method === 'notifications/initialized') {
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    try {
      const text = await callTool(params.name, params.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '工具调用失败: ' + e.message }], isError: true } });
    }
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}
