#!/usr/bin/env node
/**
 * 小智 MCP 桥接 - 命令行配置工具
 * Usage:
 *   node config-cli.js add <name> <wss>      添加接入点
 *   node config-cli.js list                   列出所有接入点
 *   node config-cli.js remove <id>            删除接入点
 *   node config-cli.js token <wss>            设置默认接入点 token（写入 config.js）
 *   node config-cli.js status                 查看配置状态
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
const ENDPOINTS_FILE = path.join(APP_DIR, 'endpoints.json');
const CONFIG_FILE = path.join(APP_DIR, 'config.js');
const CONFIG_EXAMPLE = path.join(APP_DIR, 'config.example.js');

// ---------- 颜色 ----------
const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m'
};
const info = (m) => console.log(`${C.cyan}[INFO]${C.reset} ${m}`);
const ok = (m) => console.log(`${C.green}[OK]${C.reset}   ${m}`);
const warn = (m) => console.log(`${C.yellow}[WARN]${C.reset} ${m}`);
const err = (m) => console.log(`${C.red}[ERR]${C.reset}  ${m}`);

// ---------- endpoints.json ----------
function loadEndpoints() {
  try {
    if (!fs.existsSync(ENDPOINTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function saveEndpoints(eps) {
  fs.writeFileSync(ENDPOINTS_FILE, JSON.stringify(eps, null, 2), 'utf8');
}

// ---------- config.js ----------
function readToken() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const cfg = require(CONFIG_FILE);
    return cfg.xiaozhiWss || null;
  } catch { return null; }
}
function writeToken(wss) {
  if (!fs.existsSync(CONFIG_FILE)) {
    if (fs.existsSync(CONFIG_EXAMPLE)) {
      fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_FILE);
    } else {
      fs.writeFileSync(CONFIG_FILE, `module.exports = {\n  xiaozhiWss: '',\n};\n`, 'utf8');
    }
  }
  // 用正则替换 xiaozhiWss 的值
  let content = fs.readFileSync(CONFIG_FILE, 'utf8');
  const escaped = wss.replace(/'/g, "\\'");
  if (/xiaozhiWss\s*:/.test(content)) {
    content = content.replace(/(xiaozhiWss\s*:\s*)'[^']*'/, `$1'${escaped}'`);
  } else {
    content = content.replace(/module\.exports\s*=\s*\{/, `module.exports = {\n  xiaozhiWss: '${escaped}',`);
  }
  fs.writeFileSync(CONFIG_FILE, content, 'utf8');
}

// ---------- 命令 ----------
function cmdAdd(name, wss) {
  if (!name || !wss) {
    err('用法: node config-cli.js add <名称> <WSS地址>');
    process.exit(1);
  }
  const eps = loadEndpoints();
  if (eps.some(e => e.name === name)) {
    err(`接入点名称 "${name}" 已存在`);
    process.exit(1);
  }
  const ep = {
    id: 'ep_' + Date.now().toString(36),
    name: String(name),
    wss: String(wss),
    createdAt: Date.now()
  };
  eps.push(ep);
  saveEndpoints(eps);
  ok(`已添加接入点: ${name}`);
  console.log(`  ID:   ${ep.id}`);
  console.log(`  WSS:  ${ep.wss.slice(0, 50)}...`);
  console.log(`  总数: ${eps.length} 个`);
  if (eps.length >= 2) {
    ok('接入点 >= 2，消息交换机工具已自动启用');
  } else {
    warn('接入点 < 2，消息交换机工具暂不启用（需至少2个接入点）');
  }
}

function cmdList() {
  const eps = loadEndpoints();
  if (!eps.length) {
    warn('暂无接入点。使用 node config-cli.js add <名称> <WSS> 添加');
    return;
  }
  console.log(`\n${C.bold}接入点列表（共 ${eps.length} 个）${C.reset}`);
  console.log('─'.repeat(70));
  for (const e of eps) {
    const date = new Date(e.createdAt).toLocaleString('zh-CN');
    console.log(`  ${C.cyan}${e.id}${C.reset}  ${C.bold}${e.name}${C.reset}`);
    console.log(`    WSS: ${e.wss.slice(0, 60)}${e.wss.length > 60 ? '...' : ''}`);
    console.log(`    创建: ${date}`);
    console.log('');
  }
  if (eps.length >= 2) {
    ok('消息交换机已启用（>=2 接入点）');
  } else {
    warn('消息交换机未启用（需 >=2 接入点）');
  }
}

function cmdRemove(id) {
  if (!id) {
    err('用法: node config-cli.js remove <接入点ID>');
    process.exit(1);
  }
  const eps = loadEndpoints();
  const idx = eps.findIndex(e => e.id === id);
  if (idx < 0) {
    err(`未找到接入点: ${id}`);
    console.log('可用接入点:');
    eps.forEach(e => console.log(`  ${e.id}  ${e.name}`));
    process.exit(1);
  }
  const removed = eps.splice(idx, 1)[0];
  saveEndpoints(eps);
  ok(`已删除接入点: ${removed.name} (${id})`);
  console.log(`  剩余: ${eps.length} 个`);
}

function cmdToken(wss) {
  if (!wss) {
    const current = readToken();
    if (current) {
      console.log(`\n${C.bold}当前默认接入点:${C.reset}`);
      console.log(`  ${current.slice(0, 80)}${current.length > 80 ? '...' : ''}`);
    } else {
      warn('未设置默认接入点。使用 node config-cli.js token <WSS地址> 设置');
    }
    return;
  }
  writeToken(wss);
  ok('默认接入点已写入 config.js');
  console.log(`  ${wss.slice(0, 60)}${wss.length > 60 ? '...' : ''}`);
  warn('config.js 已加入 .gitignore，不会提交到公开仓库');
}

function cmdStatus() {
  const eps = loadEndpoints();
  const token = readToken();
  console.log(`\n${C.bold}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║       小智 MCP 桥接 - 配置状态            ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════╝${C.reset}\n`);

  console.log(`${C.cyan}默认接入点 (config.js):${C.reset}`);
  if (token) {
    console.log(`  ✅ 已配置: ${token.slice(0, 50)}...`);
  } else {
    console.log(`  ❌ 未配置`);
  }

  console.log(`\n${C.cyan}多接入点 (endpoints.json):${C.reset}`);
  console.log(`  数量: ${eps.length}`);
  eps.forEach(e => console.log(`    • ${e.name} (${e.id})`));

  console.log(`\n${C.cyan}消息交换机:${C.reset}`);
  if (eps.length >= 2) {
    console.log(`  ✅ 已启用（${eps.length} 个接入点 >= 2）`);
  } else {
    console.log(`  ⚠️  未启用（当前 ${eps.length} 个，需 >= 2）`);
  }

  console.log(`\n${C.cyan}配置文件:${C.reset}`);
  console.log(`  config.js      ${fs.existsSync(CONFIG_FILE) ? '✅' : '❌'}  (默认接入点，已gitignore)`);
  console.log(`  endpoints.json ${fs.existsSync(ENDPOINTS_FILE) ? '✅' : '❌'}  (多接入点列表，已gitignore)`);
  console.log(`  mcp.json       ✅  (工具服务器配置)`);
  console.log('');
}

function cmdHelp() {
  console.log(`
${C.bold}小智 MCP 桥接 - 命令行配置工具${C.reset}

${C.cyan}用法:${C.reset}
  node config-cli.js <命令> [参数]

${C.cyan}命令:${C.reset}
  add <名称> <WSS>     添加一个小智接入点
  list                 列出所有接入点
  remove <ID>          删除指定接入点
  token [WSS]          查看/设置默认接入点（写入 config.js）
  status               查看配置状态
  help                 显示此帮助

${C.cyan}示例:${C.reset}
  node config-cli.js add "我的小智" "wss://api.xiaozhi.me/mcp/?token=xxx"
  node config-cli.js list
  node config-cli.js remove ep_abc123
  node config-cli.js token "wss://api.xiaozhi.me/mcp/?token=xxx"
  node config-cli.js status
`);
}

// ---------- main ----------
const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'add':    cmdAdd(args[1], args[2]); break;
  case 'list':   cmdList(); break;
  case 'remove': cmdRemove(args[1]); break;
  case 'rm':     cmdRemove(args[1]); break;
  case 'token':  cmdToken(args[1]); break;
  case 'status': cmdStatus(); break;
  case 'help':
  case '--help':
  case '-h':
  case undefined: cmdHelp(); break;
  default:
    err(`未知命令: ${cmd}`);
    cmdHelp();
    process.exit(1);
}
