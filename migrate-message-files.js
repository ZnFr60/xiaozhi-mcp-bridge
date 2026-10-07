#!/usr/bin/env node
/**
 * 消息文件名迁移：旧 sanitize（非 ASCII 全压成 '_'）-> 新 sanitize（SHA-1 前缀）
 *
 * 背景：旧方案下 "智能体甲"/"智能体乙"/"助手甲"/"助手乙" 会共用同一个文件名，
 * 迁移时无法从文件名反推原始用户名，因此以【消息内容里的 from/to】
 * 加上 endpoints.json 的 name 作为权威来源建立映射。
 *
 * 幂等：可重复执行；已迁移过的不会重复动作。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = process.argv[2] || '/home/user/xiaozhi-mcp-bridge';
const MSG_ROOT = path.join(APP, 'messages');

function legacyKey(name) { return String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50); }
function newKey(name) {
  const s = String(name == null ? '' : name).trim().slice(0, 50);
  if (!s) return 'u_empty';
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return 'u_' + crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16);
}
function readJson(fp, def) { try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : def; } catch { return def; } }
function writeJson(fp, d) {
  const t = `${fp}.${process.pid}.migrate.tmp`;
  fs.writeFileSync(t, JSON.stringify(d, null, 2), 'utf8');
  fs.renameSync(t, fp);
}

if (!fs.existsSync(MSG_ROOT)) {
  console.log('没有 messages/ 目录，无需迁移。');
  process.exit(0);
}

// ---------- 1. 收集所有出现过的显示名 ----------
const names = new Set();
const eps = readJson(path.join(APP, 'endpoints.json'), []);
if (Array.isArray(eps)) eps.forEach(e => e && e.name && names.add(String(e.name)));

for (const d of ['inbox', 'outbox']) {
  const dir = path.join(MSG_ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const box = readJson(path.join(dir, f), { messages: [] });
    (box.messages || []).forEach(m => {
      if (m && m.from) names.add(String(m.from));
      if (m && m.to) names.add(String(m.to));
    });
  }
}
console.log(`发现 ${names.size} 个候选用户名: ${[...names].join(', ')}`);

// ---------- 2. 建立 legacy -> new 映射 ----------
const map = new Map();
for (const n of names) {
  const lk = legacyKey(n), nk = newKey(n);
  if (lk !== nk) map.set(lk, nk);
}
if (!map.size) {
  console.log('所有用户名都是 ASCII 安全名，无需改名。');
}

// ---------- 3. 重命名 / 合并 inbox、outbox、read 下的文件 ----------
let renamed = 0, merged = 0;
for (const d of ['inbox', 'outbox', 'read']) {
  const dir = path.join(MSG_ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const [lk, nk] of map) {
    const src = path.join(dir, lk + '.json');
    const dst = path.join(dir, nk + '.json');
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) {
      const a = readJson(dst, d === 'read' ? { inbox: {} } : { messages: [] });
      const b = readJson(src, d === 'read' ? { inbox: {} } : { messages: [] });
      if (d === 'read') {
        a.inbox = a.inbox || {};
        for (const [k, t] of Object.entries(b.inbox || {})) {
          if (!a.inbox[k] || t > a.inbox[k]) a.inbox[k] = t;
        }
      } else {
        a.messages = a.messages || [];
        const seen = new Set(a.messages.map(m => m && m.msgId));
        for (const m of (b.messages || [])) if (m && !seen.has(m.msgId)) a.messages.push(m);
        a.messages.sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp)));
      }
      writeJson(dst, a);
      fs.unlinkSync(src);
      merged++;
      console.log(`  合并 ${d}/${lk}.json -> ${nk}.json`);
    } else {
      fs.renameSync(src, dst);
      renamed++;
      console.log(`  重命名 ${d}/${lk}.json -> ${nk}.json`);
    }
  }
}

// ---------- 4. 重映射已读位置里的 from 键 ----------
for (const f of fs.readdirSync(path.join(MSG_ROOT, 'read'))) {
  if (!f.endsWith('.json')) continue;
  const fp = path.join(MSG_ROOT, 'read', f);
  const pos = readJson(fp, null);
  if (!pos || !pos.inbox) continue;
  let changed = false;
  const np = {};
  for (const [k, t] of Object.entries(pos.inbox)) {
    const nk = map.get(k) || k;
    if (nk !== k) changed = true;
    np[nk] = (!np[nk] || t > np[nk]) ? t : np[nk];
  }
  if (changed) {
    pos.inbox = np;
    writeJson(fp, pos);
    console.log(`  重映射已读键 ${f}`);
  }
}

// ---------- 5. 写 users.json（新 key -> 显示名）----------
const usersFile = path.join(MSG_ROOT, 'users.json');
const users = readJson(usersFile, {});
for (const n of names) {
  const nk = newKey(n);
  if (nk !== n) users[nk] = n;
}
writeJson(usersFile, users);

console.log(`\n迁移完成：重命名 ${renamed} 个，合并 ${merged} 个，users.json 共 ${Object.keys(users).length} 条映射。`);
