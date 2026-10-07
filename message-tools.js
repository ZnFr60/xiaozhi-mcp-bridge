#!/usr/bin/env node
/**
 * 消息交换机 MCP 服务器 v3.0（stdio）— 精简版
 * 仅2个工具：send_message（发）+ read_messages（收）
 * 通过 action 参数覆盖：发送/撤回/读取/列收件箱/列发件箱/已读位置/重置/列用户
 *
 * 存储：JSON 文件（轻量）
 *   messages/inbox/{用户}.json   收件箱
 *   messages/outbox/{用户}.json  发件箱
 *   messages/read/{用户}.json    已读位置
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MSG_ROOT = path.join(__dirname, 'messages');
const INBOX = path.join(MSG_ROOT, 'inbox');
const OUTBOX = path.join(MSG_ROOT, 'outbox');
const READ_DIR = path.join(MSG_ROOT, 'read');
const ENDPOINTS_FILE = path.join(__dirname, 'endpoints.json');
const RUNTIME_STATE_FILE = path.join(__dirname, 'runtime-state.json');

[MSG_ROOT, INBOX, OUTBOX, READ_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/**
 * 统计【已连接】的小智接入点数量，只有 >=2 个时才启用消息收发工具。
 *
 * 旧实现直接数 endpoints.json 的条目数，等于把"配置"当"状态"用，有两个后果：
 *   1) 加了两条但一条都没连上时，工具照样暴露，消息只会写进没人读的收件箱；
 *   2) 单接入点模式（config.js + guardian.js）完全不计入，功能形同失效。
 *
 * 现优先读 guardian-multi.js 写出的 runtime-state.json；该文件不存在时
 * （例如没在用多接入点守护）退回配置条目数，保持向后兼容。
 */
function countEndpoints() {
  try {
    if (fs.existsSync(RUNTIME_STATE_FILE)) {
      const st = JSON.parse(fs.readFileSync(RUNTIME_STATE_FILE, 'utf8'));
      if (Array.isArray(st.endpoints)) return st.endpoints.filter(e => e && e.connected).length;
    }
  } catch {}
  try {
    if (!fs.existsSync(ENDPOINTS_FILE)) return 0;
    const eps = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    return Array.isArray(eps) ? eps.length : 0;
  } catch { return 0; }
}

const MIN_ENDPOINTS = 2;
function messageToolsEnabled() { return countEndpoints() >= MIN_ENDPOINTS; }

// ---------- 身份判定 ----------
/**
 * 从 wss 地址里解出 agentId
 */
function agentIdOf(wss) {
  try {
    return JSON.parse(Buffer.from(String(wss).split('token=')[1].split('.')[1], 'base64url')).agentId;
  } catch { return null; }
}

/**
 * 推断"我是哪个接入点"。
 *
 * 为什么必须有这个：from/to/user 原本全都由 AI 自填，没有和接入点绑定。
 * 实测收件方用 user="用户" / user="小杜" 去读，而消息被写进 "小智2" 的邮箱，
 * 于是双方名字对不上，消息永远收不到。身份是配置事实，不能交给模型猜。
 *
 * 途径 1（首选）：环境变量 XZ_ENDPOINT_USERNAME —— 由 guardian-multi.js 为每个
 *          接入点生成独立 mcp 配置时注入，完全显式、不依赖进程拓扑。
 * 途径 2：环境变量 XZ_ENDPOINT_NAME（兼容旧命名）。
 * 途径 3（兜底）：从面板手动启动的桥接不会带 env，此时向上遍历进程树，
 *          找到带 --ws 参数的 mcp_exe 父进程，由其 token 的 agentId 反查配置。
 */
function detectMyName() {
  const fromEnv = process.env.XZ_ENDPOINT_USERNAME || process.env.XZ_ENDPOINT_NAME;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();

  let pid = process.ppid;
  for (let depth = 0; depth < 4 && pid && pid > 1; depth++) {
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' '); } catch { break; }
    const m = /--ws\s+(\S+)/.exec(cmd);
    if (m) {
      const aid = agentIdOf(m[1]);
      if (aid != null) {
        try {
          const eps = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
          const me = (Array.isArray(eps) ? eps : []).find(e => agentIdOf(e.wss) === aid);
          if (me) return String(me.userName || me.name || '').trim();
        } catch {}
      }
      return '';
    }
    // /proc/<pid>/stat: "pid (comm) state ppid ..." —— comm 可能含空格，从最后一个 ')' 后切
    let stat = '';
    try { stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { break; }
    const rp = stat.lastIndexOf(')');
    if (rp < 0) break;
    const fields = stat.slice(rp + 2).split(' ');
    pid = Number(fields[1]);
  }
  return '';
}

const MY_NAME = detectMyName();

// 启动时把识别到的身份记一行，便于排查"消息发不出去/收不到"这类问题。
// 每次进程启动一行，量极小；位置在 messages/identity.log。
try {
  fs.appendFileSync(
    path.join(MSG_ROOT, 'identity.log'),
    `${new Date().toISOString()} pid=${process.pid} ppid=${process.ppid} identity=${MY_NAME || '(未识别)'} env=${process.env.XZ_ENDPOINT_USERNAME || '-'}\n`,
    'utf8'
  );
} catch {}

/** 除我之外的其他接入点的用户名称 */
function peerNames() {
  // 守护进程注入的优先（已排除自己）
  const fromEnv = String(process.env.XZ_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  try {
    const eps = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    return (Array.isArray(eps) ? eps : [])
      .map(e => e && String(e.userName || e.name || '').trim())
      .filter(n => n && n !== MY_NAME);
  } catch { return []; }
}

/** 已确定身份时，忽略调用方传来的名字；否则退回旧行为（兼容直接 stdio 调用） */
function resolveSelf(supplied) {
  return MY_NAME || String(supplied == null ? '' : supplied).trim();
}

/** 把 AI 给的收件人解析成真实接入点名 */
function resolveTarget(supplied) {
  const raw = String(supplied == null ? '' : supplied).trim();
  if (!MY_NAME) return { ok: true, name: raw };          // 无身份信息时不做约束
  const peers = peerNames();
  if (raw && peers.includes(raw)) return { ok: true, name: raw };
  if (peers.length === 1) return { ok: true, name: peers[0] };
  return { ok: false, error: `收件人 "${raw || '(空)'}" 不是已配置的接入点。可发送给：${peers.join('、') || '（暂无其他接入点）'}` };
}

// ---------- 工具函数 ----------
function genTimestamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
function genMsgId() { return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function readJson(fp, def) { try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : def; } catch { return def; } }

/**
 * 把用户标识转换成安全的文件名。
 *
 * 旧实现 String(name).replace(/[^a-zA-Z0-9_\-]/g, '_') 会把所有非 ASCII 字符
 * 统一压成 '_'。实测 "智能体甲"/"智能体乙"/"助手甲"/"助手乙" 全部得到 "___" ——
 * 四个不同用户共用同一份收件箱/发件箱/已读位置，消息串号且静默丢失。
 *
 * 新实现：纯 ASCII 安全名保持原样（可读、便于迁移）；其余取名字的 SHA-1 前缀，
 * 不同名字必定得到不同文件名。
 */
function sanitize(name) {
  const s = String(name == null ? '' : name).trim().slice(0, 50);
  if (!s) return 'u_empty';
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return 'u_' + crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 原子写 JSON。
 *
 * 临时文件名必须唯一：每个接入点会各派生一个 message-tools.js 进程，
 * 若都写固定的 `${fp}.tmp`，并发写同一收件箱时会互相截断并在 rename 上竞态，
 * 导致消息丢失或文件损坏。
 */
function writeJsonAtomic(fp, data) {
  const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, fp);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function inboxF(u) { return path.join(INBOX, sanitize(u) + '.json'); }
function outboxF(u) { return path.join(OUTBOX, sanitize(u) + '.json'); }
function readF(u) { return path.join(READ_DIR, sanitize(u) + '.json'); }
function loadBox(fp) { const b = readJson(fp, { messages: [] }); if (!Array.isArray(b.messages)) b.messages = []; return b; }

// 单个信箱保留的最大消息数；超出后丢弃最旧的，避免 7x24 长期运行写满 eMMC。
const MAX_MESSAGES_PER_BOX = Number(process.env.MSG_MAX_PER_BOX || 500);

function saveBox(fp, box) {
  box.messages.sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp)));
  if (MAX_MESSAGES_PER_BOX > 0 && box.messages.length > MAX_MESSAGES_PER_BOX) {
    box.messages = box.messages.slice(-MAX_MESSAGES_PER_BOX);
  }
  writeJsonAtomic(fp, box);
}

/**
 * 非 ASCII 用户名会被哈希成不可读的文件名，因此额外维护 key -> 显示名 映射，
 * 供 list_users / get_position 还原成人类可读的名字。
 */
const USERS_FILE = path.join(MSG_ROOT, 'users.json');
function loadUsers() { return readJson(USERS_FILE, {}); }
function rememberUser(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return;
  const k = sanitize(s);
  if (k === s) return;            // ASCII 名本身即 key，无需映射
  const u = loadUsers();
  if (u[k] !== s) { u[k] = s; writeJsonAtomic(USERS_FILE, u); }
}
function displayName(k) { const u = loadUsers(); return u[k] || k; }

function loadPos(u) { return readJson(readF(u), { inbox: {} }); }
function savePos(u, d) { writeJsonAtomic(readF(u), d); }

// ---------- 发工具：send_message ----------
function doSend(from, to, content) {
  // 发送者身份由环境决定；收件人按 endpoints.json 解析（名不对且有唯一对端时自动纠正）
  const f = resolveSelf(from);
  if (!f) return '发送失败：无法确定发送者身份。';
  const r = resolveTarget(to);
  if (!r.ok) return '发送失败：' + r.error;
  const t = r.name;
  if (!t) return '发送失败：缺少接收者标识（to）。';
  if (f === t) return `发送失败：发送者与接收者相同（${f}）。`;
  rememberUser(f); rememberUser(t);
  const msg = { msgId: genMsgId(), timestamp: genTimestamp(), from: f, to: t, content: String(content), recalled: false };
  const ib = loadBox(inboxF(t)); ib.messages.push(msg); saveBox(inboxF(t), ib);
  const ob = loadBox(outboxF(f)); ob.messages.push(msg); saveBox(outboxF(f), ob);
  return `消息已发送\n  消息ID: ${msg.msgId}\n  时间戳: ${msg.timestamp}\n  从: ${f} → 到: ${t}\n  长度: ${msg.content.length} 字`;
}

function doRecall(user, msgId) {
  const self = resolveSelf(user);
  if (!self) return '撤回失败：无法确定你的身份。';
  const ob = loadBox(outboxF(self));
  const msg = ob.messages.find(m => m.msgId === msgId);
  if (!msg) return `撤回失败：在 ${self} 的发件箱中未找到 ${msgId}（只能撤回自己发的消息）。`;
  if (msg.recalled) return '该消息已被撤回过。';
  msg.recalled = true; saveBox(outboxF(self), ob);
  const ib = loadBox(inboxF(msg.to));
  const im = ib.messages.find(m => m.msgId === msgId);
  if (im) { im.recalled = true; saveBox(inboxF(msg.to), ib); }
  return `消息已撤回\n  消息ID: ${msgId}\n  时间戳: ${msg.timestamp}\n  方式: recalled=true（消息保留，未删除）`;
}

function doListUsers() {
  const names = new Set();
  // 来源 1：信箱文件名，经 users.json 还原为可读名（覆盖中文名被哈希的情况）
  [INBOX, OUTBOX, READ_DIR].forEach(d => {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach(f => {
      if (f.endsWith('.json')) names.add(displayName(f.replace('.json', '')));
    });
  });
  // 来源 2：消息内容里的 from / to 原始用户名。
  // 兜底覆盖 users.json 缺失的旧数据（v1.0.x 升级上来时没有该映射文件）。
  [INBOX, OUTBOX].forEach(d => {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach(f => {
      if (!f.endsWith('.json')) return;
      try {
        const box = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (Array.isArray(box.messages)) {
          box.messages.forEach(m => {
            if (m && m.from) names.add(String(m.from));
            if (m && m.to) names.add(String(m.to));
          });
        }
      } catch {}
    });
  });
  if (!names.size) return '暂无用户记录。';
  return `已注册用户（${names.size}个）:\n  ${[...names].sort().join(', ')}`;
}

// ---------- 收工具：read_messages ----------
function doRead(user, fromFilter) {
  const self = resolveSelf(user);
  if (!self) return '读取失败：无法确定你的身份。';
  const pos = loadPos(self);
  const ib = loadBox(inboxF(self));
  let msgs = ib.messages;
  if (fromFilter) {
    const sk = sanitize(fromFilter);
    msgs = msgs.filter(m => sanitize(m.from) === sk && m.timestamp > (pos.inbox[sk] || '0'));
  } else {
    msgs = msgs.filter(m => m.timestamp > (pos.inbox[sanitize(m.from)] || '0'));
  }
  if (!msgs.length) return '没有新消息。';
  let out = `共 ${msgs.length} 条新消息:\n\n`;
  const maxTs = {};
  for (const m of msgs) {
    out += `━━━━━━━━━━━━━━━━━━━━\n时间戳: ${m.timestamp}\n发送者: ${m.from}\n消息ID: ${m.msgId}\n`;
    if (m.recalled) out += `⚠️  此消息已被撤回\n`;
    out += `内容:\n${m.content}\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    const sk = sanitize(m.from);
    if (!maxTs[sk] || m.timestamp > maxTs[sk]) maxTs[sk] = m.timestamp;
  }
  for (const [s, t] of Object.entries(maxTs)) pos.inbox[s] = t;
  savePos(self, pos);
  return out + '已更新已读位置。';
}

function doListInbox(user) {
  const self = resolveSelf(user);
  if (!self) return '读取失败：无法确定你的身份。';
  const pos = loadPos(self);
  const msgs = loadBox(inboxF(self)).messages;
  if (!msgs.length) return '收件箱为空。';
  let out = `收件箱（共 ${msgs.length} 条）:\n\n`;
  for (const m of msgs) {
    const unread = m.timestamp > (pos.inbox[sanitize(m.from)] || '0');
    out += `${unread ? '🆕' : '  '} [${m.timestamp}] ${m.from} → 我`;
    if (m.recalled) out += ' ⚠️已撤回';
    out += `\n     ${m.content.slice(0, 50).replace(/\n/g, ' ')}...\n`;
  }
  return out;
}

function doListOutbox(user) {
  const self = resolveSelf(user);
  if (!self) return '读取失败：无法确定你的身份。';
  const msgs = loadBox(outboxF(self)).messages;
  if (!msgs.length) return '发件箱为空。';
  let out = `发件箱（共 ${msgs.length} 条）:\n\n`;
  for (const m of msgs) {
    out += `  [${m.timestamp}] 我 → ${m.to}`;
    if (m.recalled) out += ' ⚠️已撤回';
    out += `\n     ${m.content.slice(0, 50).replace(/\n/g, ' ')}...\n`;
  }
  return out;
}

function doGetPos(user) {
  const self = resolveSelf(user);
  if (!self) return '读取失败：无法确定你的身份。';
  const pos = loadPos(self);
  if (!Object.keys(pos.inbox).length) return '暂无已读记录。';
  return `${self} 的已读位置:\n\n` + Object.entries(pos.inbox).map(([s, t]) => `  来自 ${displayName(s)}: ${t}`).join('\n');
}

function doResetPos(user, from) {
  const self = resolveSelf(user);
  if (!self) return '读取失败：无法确定你的身份。';
  const pos = loadPos(self);
  if (from) { delete pos.inbox[sanitize(from)]; savePos(self, pos); return `已重置 ${self} 对 ${from} 的已读位置。`; }
  pos.inbox = {}; savePos(self, pos); return `已重置 ${self} 的全部已读位置。`;
}

// ---------- MCP 工具定义（仅2个） ----------
const TOOLS = [
  {
    name: 'send_message',
    description: '消息发送工具。action=send(默认)发消息；action=recall撤回自己发的消息；action=list_users列出所有用户端。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型：send(默认) / recall / list_users', enum: ['send', 'recall', 'list_users'] },
        from: { type: 'string', description: '发送者端标识（action=send时必填）' },
        to: { type: 'string', description: '接收者端标识（action=send时必填）' },
        content: { type: 'string', description: '消息内容（action=send时必填）' },
        user: { type: 'string', description: '你的端标识（action=recall时必填）' },
        msg_id: { type: 'string', description: '要撤回的消息ID（action=recall时必填）' }
      }
    }
  },
  {
    name: 'read_messages',
    description: '消息接收工具。action=read(默认)读取新消息并更新已读位置；action=list_inbox列收件箱；action=list_outbox列发件箱；action=get_position查看已读位置；action=reset_position重置已读位置。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型：read(默认) / list_inbox / list_outbox / get_position / reset_position', enum: ['read', 'list_inbox', 'list_outbox', 'get_position', 'reset_position'] },
        user: { type: 'string', description: '你的端标识（必填）' },
        from: { type: 'string', description: '可选，action=read时只看某个发送者的新消息；action=reset_position时只重置对该发送者的已读位置' }
      },
      required: ['user']
    }
  }
];

/**
 * 生成工具定义，并把"我是谁 / 能发给谁"写进描述。
 *
 * 这是让 AI 用对名字的关键：身份和可用的收件人直接出现在它读到的工具描述里，
 * 不必依赖模型自己猜、也不依赖它在上文里记住。
 */
function buildTools() {
  if (!MY_NAME) return TOOLS;
  const peers = peerNames();
  const hint = `【你的身份是「${MY_NAME}」；可发送给：${peers.length ? peers.join('、') : '（暂无其他接入点）'}。`
    + `发消息时 to 填对端名字即可；from / user 可省略，系统会按身份自动填写。】\n`;
  return TOOLS.map(t => ({ ...t, description: hint + t.description }));
}

async function callTool(name, args) {
  const action = args.action || (name === 'send_message' ? 'send' : 'read');
  if (name === 'send_message') {
    if (action === 'recall') return doRecall(String(args.user || ''), String(args.msg_id || ''));
    if (action === 'list_users') return doListUsers();
    return doSend(String(args.from || ''), String(args.to || ''), String(args.content || ''));
  }
  if (name === 'read_messages') {
    if (action === 'list_inbox') return doListInbox(String(args.user || ''));
    if (action === 'list_outbox') return doListOutbox(String(args.user || ''));
    if (action === 'get_position') return doGetPos(String(args.user || ''));
    if (action === 'reset_position') return doResetPos(String(args.user || ''), args.from ? String(args.from) : null);
    return doRead(String(args.user || ''), args.from ? String(args.from) : null);
  }
  throw new Error('未知工具: ' + name);
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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'message-exchange', version: '3.0.0' } } });
  } else if (method === 'notifications/initialized') {
  } else if (method === 'tools/list') {
    // 只有 >=2 个小智接入点时才暴露消息工具
    if (messageToolsEnabled()) {
      send({ jsonrpc: '2.0', id, result: { tools: buildTools() } });
    } else {
      send({ jsonrpc: '2.0', id, result: { tools: [] } });
    }
  } else if (method === 'tools/call') {
    if (!messageToolsEnabled()) {
      const cnt = countEndpoints();
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `消息功能未启用：当前只有 ${cnt} 个【已连接】的小智接入点，需要至少 ${MIN_ENDPOINTS} 个才能使用消息收发。请用 config-cli.js add 添加接入点，并确认对应连接已建立。` }], isError: true } });
    } else {
      try {
        const text = await callTool(params.name, params.arguments || {});
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '工具调用失败: ' + e.message }], isError: true } });
      }
    }
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}
