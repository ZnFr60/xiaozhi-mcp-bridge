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

const MSG_ROOT = path.join(__dirname, 'messages');
const INBOX = path.join(MSG_ROOT, 'inbox');
const OUTBOX = path.join(MSG_ROOT, 'outbox');
const READ_DIR = path.join(MSG_ROOT, 'read');
const ENDPOINTS_FILE = path.join(__dirname, 'endpoints.json');

[MSG_ROOT, INBOX, OUTBOX, READ_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/**
 * 检测已配置的小智接入点数量
 * 只有 >=2 个接入点时才启用消息收发工具
 */
function countEndpoints() {
  try {
    if (!fs.existsSync(ENDPOINTS_FILE)) return 0;
    const eps = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    return Array.isArray(eps) ? eps.length : 0;
  } catch { return 0; }
}

const MIN_ENDPOINTS = 2;
function messageToolsEnabled() { return countEndpoints() >= MIN_ENDPOINTS; }

// ---------- 工具函数 ----------
function genTimestamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
function genMsgId() { return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function sanitize(name) { return String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50); }
function writeJsonAtomic(fp, data) { fs.writeFileSync(fp + '.tmp', JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(fp + '.tmp', fp); }
function readJson(fp, def) { try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : def; } catch { return def; } }
function inboxF(u) { return path.join(INBOX, sanitize(u) + '.json'); }
function outboxF(u) { return path.join(OUTBOX, sanitize(u) + '.json'); }
function readF(u) { return path.join(READ_DIR, sanitize(u) + '.json'); }
function loadBox(fp) { const b = readJson(fp, { messages: [] }); if (!Array.isArray(b.messages)) b.messages = []; return b; }
function saveBox(fp, b) { b.messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp)); writeJsonAtomic(fp, b); }
function loadPos(u) { return readJson(readF(u), { inbox: {} }); }
function savePos(u, d) { writeJsonAtomic(readF(u), d); }

// ---------- 发工具：send_message ----------
function doSend(from, to, content) {
  const msg = { msgId: genMsgId(), timestamp: genTimestamp(), from: String(from), to: String(to), content: String(content), recalled: false };
  const ib = loadBox(inboxF(to)); ib.messages.push(msg); saveBox(inboxF(to), ib);
  const ob = loadBox(outboxF(from)); ob.messages.push(msg); saveBox(outboxF(from), ob);
  return `消息已发送\n  消息ID: ${msg.msgId}\n  时间戳: ${msg.timestamp}\n  从: ${from} → 到: ${to}\n  长度: ${content.length} 字`;
}

function doRecall(user, msgId) {
  const ob = loadBox(outboxF(user));
  const msg = ob.messages.find(m => m.msgId === msgId);
  if (!msg) return `撤回失败：在 ${user} 的发件箱中未找到 ${msgId}（只能撤回自己发的消息）。`;
  if (msg.recalled) return '该消息已被撤回过。';
  msg.recalled = true; saveBox(outboxF(user), ob);
  const ib = loadBox(inboxF(msg.to));
  const im = ib.messages.find(m => m.msgId === msgId);
  if (im) { im.recalled = true; saveBox(inboxF(msg.to), ib); }
  return `消息已撤回\n  消息ID: ${msgId}\n  时间戳: ${msg.timestamp}\n  方式: recalled=true（消息保留，未删除）`;
}

function doListUsers() {
  const s = new Set();
  [INBOX, OUTBOX, READ_DIR].forEach(d => { if (fs.existsSync(d)) fs.readdirSync(d).forEach(f => { if (f.endsWith('.json')) s.add(f.replace('.json', '')); }); });
  return s.size ? `已注册用户（${s.size}个）:\n  ${[...s].sort().join(', ')}` : '暂无用户记录。';
}

// ---------- 收工具：read_messages ----------
function doRead(user, fromFilter) {
  const pos = loadPos(user);
  const ib = loadBox(inboxF(user));
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
  savePos(user, pos);
  return out + '已更新已读位置。';
}

function doListInbox(user) {
  const pos = loadPos(user);
  const msgs = loadBox(inboxF(user)).messages;
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
  const msgs = loadBox(outboxF(user)).messages;
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
  const pos = loadPos(user);
  if (!Object.keys(pos.inbox).length) return '暂无已读记录。';
  return `${user} 的已读位置:\n\n` + Object.entries(pos.inbox).map(([s, t]) => `  来自 ${s}: ${t}`).join('\n');
}

function doResetPos(user, from) {
  const pos = loadPos(user);
  if (from) { delete pos.inbox[sanitize(from)]; savePos(user, pos); return `已重置 ${user} 对 ${from} 的已读位置。`; }
  pos.inbox = {}; savePos(user, pos); return `已重置 ${user} 的全部已读位置。`;
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
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else {
      send({ jsonrpc: '2.0', id, result: { tools: [] } });
    }
  } else if (method === 'tools/call') {
    if (!messageToolsEnabled()) {
      const cnt = countEndpoints();
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `消息功能未启用：当前只有 ${cnt} 个小智接入点，需要至少 ${MIN_ENDPOINTS} 个才能使用消息收发。请在 Web 管理面板添加更多接入点。` }], isError: true } });
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
