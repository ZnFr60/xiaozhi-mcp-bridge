#!/usr/bin/env node
/**
 * 小智 MCP 桥接 - 命令行配置工具
 * Usage:
 *   node config-cli.js add <name> <wss> <userName>   添加接入点（用户名称必填）
 *   node config-cli.js list                   列出所有接入点
 *   node config-cli.js remove <id>            删除接入点
 *   node config-cli.js user <id> <userName>   修改接入点的用户名称
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
function cmdAdd(name, wss, userName) {
  if (!name || !wss) {
    err('用法: node config-cli.js add <名称> <WSS地址> <用户名称>');
    process.exit(1);
  }
  // 用户名称必须显式给出：它是消息收发时双方互认的身份，
  // 不配置就没法可靠地把消息投递到对端信箱（旧版就是因此收不到消息）。
  if (!userName) {
    err('缺少【用户名称】—— 必须为每个接入点指定它在消息收发中使用的身份名。');
    console.log('');
    console.log('  消息的 from / to / user 都以这个名称互认：');
    console.log('  两个接入点的用户名称必须各自唯一，且发送方填的 to 要等于接收方的用户名称。');
    console.log('');
    console.log(`  示例: node config-cli.js add ${JSON.stringify(name)} "<WSS地址>" "小智1"`);
    console.log('  如果这个接入点就是「小智1」那台设备，用户名称就填 "小智1"。');
    process.exit(1);
  }
  const uname = String(userName).trim();
  if (!uname) { err('用户名称不能为空。'); process.exit(1); }

  const eps = loadEndpoints();
  if (eps.some(e => e.name === name)) {
    err(`接入点名称 "${name}" 已存在`);
    process.exit(1);
  }
  if (eps.some(e => String(e.userName || e.name) === uname)) {
    warn(`已存在用户名称为 "${uname}" 的接入点，两者会共用同一个信箱，消息可能混淆。`);
  }
  const ep = {
    id: 'ep_' + Date.now().toString(36),
    name: String(name),
    userName: uname,
    wss: String(wss),
    createdAt: Date.now()
  };
  eps.push(ep);
  saveEndpoints(eps);
  ok(`已添加接入点: ${name}`);
  console.log(`  ID:       ${ep.id}`);
  console.log(`  用户名称: ${ep.userName}`);
  console.log(`  WSS:      ${ep.wss.slice(0, 50)}...`);
  console.log(`  总数:     ${eps.length} 个`);
  if (eps.length >= 2) {
    ok('接入点 >= 2，消息交换机工具已自动启用');
  } else {
    warn('接入点 < 2，消息交换机工具暂不启用（需至少2个接入点）');
  }
}

function cmdList() {
  const eps = loadEndpoints();
  if (!eps.length) {
    warn('暂无接入点。使用 node config-cli.js add <名称> <WSS地址> <用户名称> 添加');
    return;
  }
  console.log(`\n${C.bold}接入点列表（共 ${eps.length} 个）${C.reset}`);
  console.log('─'.repeat(70));
  let missing = 0;
  for (const e of eps) {
    const date = new Date(e.createdAt).toLocaleString('zh-CN');
    const un = e.userName ? e.userName : `${C.red}(未配置，将退回名称)${C.reset}`;
    if (!e.userName) missing++;
    console.log(`  ${C.cyan}${e.id}${C.reset}  ${C.bold}${e.name}${C.reset}`);
    console.log(`    用户名称: ${un}`);
    console.log(`    WSS: ${e.wss.slice(0, 60)}${e.wss.length > 60 ? '...' : ''}`);
    console.log(`    创建: ${date}`);
    console.log('');
  }
  if (missing) {
    warn(`有 ${missing} 个接入点未配置用户名称，请用 config-cli.js user <ID> <用户名称> 补齐。`);
  }
  if (eps.length >= 2) {
    ok('消息交换机已启用（>=2 接入点）');
  } else {
    warn('消息交换机未启用（需 >=2 接入点）');
  }
}

function cmdUser(id, userName) {
  if (!id || !userName) {
    err('用法: node config-cli.js user <接入点ID> <用户名称>');
    process.exit(1);
  }
  const eps = loadEndpoints();
  const ep = eps.find(e => e.id === id);
  if (!ep) {
    err(`未找到接入点: ${id}`);
    eps.forEach(e => console.log(`  ${e.id}  ${e.name}`));
    process.exit(1);
  }
  const uname = String(userName).trim();
  if (!uname) { err('用户名称不能为空。'); process.exit(1); }
  if (eps.some(e => e.id !== id && String(e.userName || e.name) === uname)) {
    warn(`已存在用户名称为 "${uname}" 的接入点，两者会共用同一个信箱。`);
  }
  const old = ep.userName || '(未配置)';
  ep.userName = uname;
  saveEndpoints(eps);
  ok(`已更新用户名称: ${ep.name} (${id})`);
  console.log(`  ${old} -> ${uname}`);
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
  eps.forEach(e => console.log(`    • ${e.name} (${e.id})  用户名称: ${e.userName || '（未配置）'}`));

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
  add <名称> <WSS地址> <用户名称>   添加一个小智接入点（用户名称必填）
  list                             列出所有接入点
  remove <ID>                      删除指定接入点
  user <ID> <用户名称>             修改某个接入点的用户名称
  token [WSS]                      查看/设置默认接入点（写入 config.js）
  status                           查看配置状态
  help                             显示此帮助

${C.cyan}关于「用户名称」:${C.reset}
  消息收发时双方以这个名字互认。发送方填的 to 必须等于接收方的用户名称，
  否则消息会投递到另一个信箱，对方永远收不到。
  每个接入点的用户名称应各自唯一。

${C.cyan}示例:${C.reset}
  node config-cli.js add "小智1" "wss://api.xiaozhi.me/mcp/?token=xxx" "小智1"
  node config-cli.js add "小智2" "wss://api.xiaozhi.me/mcp/?token=yyy" "小智2"
  node config-cli.js list
  node config-cli.js user ep_abc123 "新名字"
  node config-cli.js remove ep_abc123
  node config-cli.js token "wss://api.xiaozhi.me/mcp/?token=xxx"
  node config-cli.js status
`);
}

// ---------- main ----------
const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'add':    cmdAdd(args[1], args[2], args[3]); break;
  case 'list':   cmdList(); break;
  case 'remove': cmdRemove(args[1]); break;
  case 'rm':     cmdRemove(args[1]); break;
  case 'user':   cmdUser(args[1], args[2]); break;
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
