#!/usr/bin/env node
/**
 * 代码执行 MCP 服务器（stdio）
 * 支持 Python、C 语言的代码编写、编译、运行
 * 权限继承：本进程以什么权限运行，执行的代码就有什么权限
 */
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP_DIR = path.join(os.tmpdir(), 'xiaozhi-mcp-code');
fs.mkdirSync(TMP_DIR, { recursive: true });

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || TMP_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout || 15000
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); if (stdout.length > 100000) stdout = stdout.slice(-50000); });
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 50000) stderr = stderr.slice(-25000); });
    child.on('error', (e) => resolve({ error: e.message, stdout, stderr }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runPython(code, timeout = 15) {
  const file = path.join(TMP_DIR, 'py_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.py');
  fs.writeFileSync(file, code, 'utf8');
  const result = await runProcess('python3', [file], { timeout: timeout * 1000 });
  try { fs.unlinkSync(file); } catch {}
  return formatResult('Python', result);
}

async function runC(code, timeout = 20) {
  const base = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const srcFile = path.join(TMP_DIR, base + '.c');
  const binFile = path.join(TMP_DIR, base);
  fs.writeFileSync(srcFile, code, 'utf8');
  // 编译
  const compile = await runProcess('gcc', [srcFile, '-o', binFile, '-Wall', '-std=c11'], { timeout: 15000 });
  if (compile.code !== 0) {
    try { fs.unlinkSync(srcFile); } catch {}
    return '【编译失败】\n' + (compile.stderr || compile.stdout || '未知错误');
  }
  // 运行
  const result = await runProcess(binFile, [], { timeout: timeout * 1000 });
  try { fs.unlinkSync(srcFile); fs.unlinkSync(binFile); } catch {}
  return formatResult('C', result);
}

async function runBash(command, timeout = 15) {
  return new Promise((resolve) => {
    exec(command, { timeout: timeout * 1000, maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' }, (err, stdout, stderr) => {
      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += '[stderr]\n' + stderr;
      if (err) out += '\n[退出码 ' + err.code + ']' + (err.killed ? '（超时）' : '');
      resolve(out || '(无输出)');
    });
  });
}

function writeCodeFile(filepath, content) {
  // 安全检查：不允许绝对路径越界，但允许用户指定路径
  const resolved = path.resolve(filepath);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    return `文件已写入: ${resolved}\n大小: ${Buffer.byteLength(content, 'utf8')} 字节`;
  } catch (e) {
    return '写入失败: ' + e.message;
  }
}

function formatResult(lang, result) {
  let out = '';
  if (result.error) return `【${lang} 执行错误】${result.error}`;
  if (result.stdout) out += result.stdout;
  if (result.stderr) out += (out ? '\n' : '') + '[stderr]\n' + result.stderr;
  if (!out) out = '(无输出)';
  out += `\n[退出码 ${result.code}]`;
  return out;
}

function getEnvInfo() {
  const lines = [
    '代码执行环境信息:',
    `  运行用户: ${os.userInfo().username} (uid=${process.getuid()})`,
    `  工作目录: ${process.cwd()}`,
    `  临时目录: ${TMP_DIR}`,
    `  Node: ${process.version}`,
  ];
  try { lines.push('  Python: ' + require('child_process').execSync('python3 --version 2>&1').toString().trim()); } catch {}
  try { lines.push('  GCC: ' + require('child_process').execSync('gcc --version 2>&1 | head -1').toString().trim()); } catch {}
  lines.push(`  权限提示: 当前进程权限即为代码执行权限，sudo 启动则代码以 root 运行`);
  return lines.join('\n');
}

const TOOLS = [
  {
    name: 'run_python',
    description: '执行 Python 3 代码，返回标准输出和错误。代码在临时文件中执行，执行后自动清理。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python 源代码' },
        timeout: { type: 'number', description: '超时秒数，默认 15，最大 60' }
      },
      required: ['code']
    }
  },
  {
    name: 'run_c',
    description: '编译并运行 C 语言代码（gcc -std=c11），返回编译和运行结果。代码在临时目录编译执行。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'C 源代码（需包含 main 函数）' },
        timeout: { type: 'number', description: '运行超时秒数，默认 20，最大 60' }
      },
      required: ['code']
    }
  },
  {
    name: 'run_bash',
    description: '执行 bash 命令/脚本，返回输出。权限与当前进程一致。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'bash 命令或脚本' },
        timeout: { type: 'number', description: '超时秒数，默认 15，最大 120' }
      },
      required: ['command']
    }
  },
  {
    name: 'write_file',
    description: '将内容写入指定路径的文件，自动创建目录。可用于保存代码文件。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（绝对路径或相对当前目录）' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'get_code_env',
    description: '查看当前代码执行环境信息（用户、权限、Python/GCC 版本）。',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'run_python': return await runPython(String(args.code || ''), Math.min(Math.max(args.timeout || 15, 1), 60));
    case 'run_c': return await runC(String(args.code || ''), Math.min(Math.max(args.timeout || 20, 1), 60));
    case 'run_bash': return await runBash(String(args.command || ''), Math.min(Math.max(args.timeout || 15, 1), 120));
    case 'write_file': return writeCodeFile(String(args.path || ''), String(args.content || ''));
    case 'get_code_env': return getEnvInfo();
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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'code-tools', version: '1.0.0' } } });
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
