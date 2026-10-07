#!/usr/bin/env node
/**
 * 小智 MCP 管理面板后端
 * - 管理多个小智 WSS 接入点
 * - 为每个接入点启动/停止 mcp_exe 桥接
 * - 测试连接性
 * - 测试本地工具调用
 * - 实时日志
 */
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
const ENDPOINTS_FILE = path.join(APP_DIR, 'endpoints.json');
const RUNTIME_STATE_FILE = path.join(APP_DIR, 'runtime-state.json');
const MCP_CONFIG = path.join(APP_DIR, 'mcp.json');
const MCP_EXE = require('./lib/mcp-config.js').resolveDep(APP_DIR, 'mcp_exe', 'bin/cli.js');
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const PORT = process.env.PORT || 37246;

// 启动时从模板动态生成 mcp.json（确保路径正确）
try { require('./lib/mcp-config.js').generateMcpConfig(APP_DIR); } catch (e) { console.error('[WARN] 生成 mcp.json 失败:', e.message); }

// ---------- 数据持久化 ----------
function loadEndpoints() {
  try { return JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8')); }
  catch { return []; }
}
function saveEndpoints(eps) {
  fs.writeFileSync(ENDPOINTS_FILE, JSON.stringify(eps, null, 2), 'utf8');
}

// ---------- 进程管理 ----------
const bridges = {}; // endpointId -> { child, logs, startedAt, stopping }

/**
 * 与 guardian-multi.js 的协作边界。
 *
 * guardian-multi.js 为每个接入点维持一条长连接，并写出 runtime-state.json。
 * 若面板也对同一 token 去 spawn，就会产生重复连接，因此这里先查该状态再决定是否放行。
 * （1.0.8 已用 guardian-status.json 做了单接入点守护的探测，此处补充多接入点场景。）
 */
function guardianState() {
  try { return JSON.parse(fs.readFileSync(RUNTIME_STATE_FILE, 'utf8')); } catch { return null; }
}
function guardianManages(id) {
  const st = guardianState();
  return !!(st && Array.isArray(st.endpoints) && st.endpoints.some(e => e && e.id === id));
}

function startBridge(ep) {
  if (bridges[ep.id]) return { ok: false, error: bridges[ep.id].stopping ? '正在停止，请稍候' : '已在运行' };
  if (guardianManages(ep.id)) {
    return { ok: false, error: '该接入点正由 guardian-multi 守护进程管理，请勿在面板重复启动（会建立重复连接）。如需变更请用 config-cli.js。' };
  }
  const child = spawn(process.execPath, [MCP_EXE, '--ws', ep.wss, '--mcp-config', MCP_CONFIG], {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const entry = { child, logs: [], startedAt: Date.now() };
  bridges[ep.id] = entry;
  const append = (stream) => (data) => {
    const text = data.toString();
    entry.logs.push({ t: Date.now(), stream, text });
    if (entry.logs.length > 2000) entry.logs.shift();
  };
  child.stdout.on('data', append('stdout'));
  child.stderr.on('data', append('stderr'));
  child.on('exit', (code) => {
    entry.logs.push({ t: Date.now(), stream: 'system', text: `进程退出，code=${code}` });
    delete bridges[ep.id];
  });
  return { ok: true, pid: child.pid };
}

function stopBridge(epId) {
  if (guardianManages(epId)) {
    return { ok: false, error: '该接入点由 guardian-multi 守护进程管理；如需下线请用 config-cli.js remove，守护进程会自动停止它。' };
  }
  const entry = bridges[epId];
  if (!entry) return { ok: false, error: '未运行' };
  if (entry.stopping) return { ok: false, error: '正在停止' };
  // 标记"停止中"并保留表项，等 child 的 exit 回调再移除。
  // 旧实现先 delete 再 kill：紧接着到达的 start 请求会起出第二个同 token 进程。
  entry.stopping = true;
  try { entry.child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { entry.child.kill('SIGKILL'); } catch {} }, 2000);
  return { ok: true };
}

function testConnection(wss) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCP_EXE, '--ws', wss, '--mcp-config', MCP_CONFIG], {
      cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let connected = false;
    let authError = null;
    const SUCCESS_PATTERNS = [
      /成功连接/i, /connected/i, /initialize/i,
      /tools\/list/i, /notification/i, /MCP/i
    ];
    const AUTH_PATTERNS = [/401/i, /403/i, /unauthorized/i, /forbidden/i, /token.*(invalid|expired)/i];

    const onData = (d) => {
      output += d.toString();
      // 检测认证错误
      for (const p of AUTH_PATTERNS) {
        if (p.test(output)) { authError = output.match(p)[0]; break; }
      }
      // 检测连接成功（多个模式命中任一即可）
      for (const p of SUCCESS_PATTERNS) {
        if (p.test(output)) { connected = true; break; }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      // 进程提前退出也作为判断依据
      if (code !== 0 && !connected) {
        // 不立即判定失败，等超时统一返回
      }
    });
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      let message;
      if (connected) message = '连接成功';
      else if (authError) message = `认证失败 (${authError})：token 无效或已过期`;
      else message = '连接失败或超时（8秒内未检测到握手）';
      resolve({
        connected,
        authError: authError || null,
        output: output.slice(-3000),
        message
      });
    }, 8000);
  });
}

// ---------- MCP 客户端（测试本地工具） ----------
function callLocalTool(serverScript, toolName, args = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(APP_DIR, serverScript)], {
      cwd: APP_DIR, stdio: ['pipe', 'pipe', 'pipe']
    });
    let buf = '';
    let step = 0; // 0=wait init, 1=wait tools/list, 2=wait tools/call
    let tools = [];
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ error: '超时', tools });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 0 && msg.result) {
          step = 1;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
        } else if (msg.id === 1 && msg.result) {
          tools = msg.result.tools || [];
          if (toolName) {
            step = 2;
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }) + '\n');
          } else {
            clearTimeout(timer);
            try { child.kill('SIGKILL'); } catch {}
            resolve({ tools });
          }
        } else if (msg.id === 2) {
          clearTimeout(timer);
          const result = msg.result ? msg.result.content.map(c => c.text).join('\n') : JSON.stringify(msg.error);
          try { child.kill('SIGKILL'); } catch {}
          resolve({ tools, result });
        }
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-panel', version: '1.0' } }
    }) + '\n');
  });
}

// 本地可用工具服务器清单
const LOCAL_SERVERS = [
  { id: 'system', script: 'system-tools.js', label: '系统工具' },
  { id: 'web', script: 'web-tools.js', label: '网页工具' },
  { id: 'weather', script: 'weather-server.js', label: '天气工具' },
  { id: 'dev', script: 'dev-tools.js', label: '开发者工具' },
  { id: 'code', script: 'code-tools.js', label: '代码执行' },
  { id: 'message', script: 'message-tools.js', label: '消息交换机' }
];

// ---------- Express ----------
const app = express();

/**
 * 访问控制。
 *
 * 本面板可以调用 code-tools.js（任意代码执行），而服务往往以 root 运行 ——
 * 因此任何能访问该端口的人等于拿到 root shell。原实现监听 0.0.0.0 且没有任何
 * 鉴权中间件，等于把 root 后门开在网络上。
 *
 * 默认只放行：本机回环 + Tailscale CGNAT 段 100.64.0.0/10。
 * 需要额外网段时设置 PANEL_ALLOW_CIDRS（逗号分隔前缀，如 "192.168.1.,10.0.0."）。
 * 需要口令时设置 PANEL_TOKEN，则要求 Authorization: Bearer <token> 或 ?token=<token>。
 */
const PANEL_TOKEN = String(process.env.PANEL_TOKEN || '');
const PANEL_ALLOW_CIDRS = String(process.env.PANEL_ALLOW_CIDRS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function ipAllowed(ip) {
  const raw = String(ip || '').replace(/^::ffff:/, '');
  if (raw === '127.0.0.1' || raw === '::1') return true;
  if (raw.startsWith('127.')) return true;
  // Tailscale CGNAT: 100.64.0.0/10  =>  100.64.x.x .. 100.127.x.x
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(raw);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return PANEL_ALLOW_CIDRS.some(p => raw.startsWith(p));
}

app.use((req, res, next) => {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  if (!ipAllowed(ip)) {
    console.warn(`[panel] 拒绝访问 ${ip} ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: 'forbidden', hint: '仅允许本机与 Tailscale 网段；如需放行请设置 PANEL_ALLOW_CIDRS' });
  }
  if (PANEL_TOKEN) {
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const q = String(req.query.token || '');
    if (bearer !== PANEL_TOKEN && q !== PANEL_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// 接入点列表
app.get('/api/endpoints', (req, res) => {
  const eps = loadEndpoints();
  const gst = guardianState();
  const geps = (gst && Array.isArray(gst.endpoints)) ? gst.endpoints : [];
  const withStatus = eps.map(ep => {
    const g = geps.find(e => e && e.id === ep.id) || null;
    const local = bridges[ep.id] || null;
    return {
      ...ep,
      // 面板自身 spawn 的，或由 guardian-multi 维护的，都算在跑
      running: !!(local || (g && g.connected)),
      managedByGuardian: !!g,
      connected: g ? !!g.connected : !!local,
      pid: (local && local.child && local.child.pid) || (g ? g.pid : null),
      uptime: local ? Math.floor((Date.now() - local.startedAt) / 1000) : 0
    };
  });
  res.json(withStatus);
});

// 添加接入点
app.post('/api/endpoints', (req, res) => {
  const { name, wss } = req.body;
  if (!name || !wss) return res.status(400).json({ error: 'name 和 wss 必填' });
  const eps = loadEndpoints();
  const ep = { id: 'ep_' + Date.now().toString(36), name, wss, createdAt: Date.now() };
  eps.push(ep);
  saveEndpoints(eps);
  res.json(ep);
});

// 删除接入点
app.delete('/api/endpoints/:id', (req, res) => {
  stopBridge(req.params.id);
  const eps = loadEndpoints().filter(e => e.id !== req.params.id);
  saveEndpoints(eps);
  res.json({ ok: true });
});

// 启动桥接
app.post('/api/endpoints/:id/start', (req, res) => {
  const ep = loadEndpoints().find(e => e.id === req.params.id);
  if (!ep) return res.status(404).json({ error: '接入点不存在' });
  // 探测 guardian 是否已在运行（避免双连接）
  const guardian = getGuardianStatus();
  if (guardian && guardian.running && guardian.state === 'connected') {
    return res.json({
      ok: false,
      warning: '守护进程已连接此 token，再次启动可能造成双连接。如需面板管理，请先停止守护进程（运行 stop.sh）。',
      guardian
    });
  }
  res.json(startBridge(ep));
});

// 停止桥接
app.post('/api/endpoints/:id/stop', (req, res) => {
  res.json(stopBridge(req.params.id));
});

// 测试连接
app.post('/api/endpoints/:id/test', async (req, res) => {
  const ep = loadEndpoints().find(e => e.id === req.params.id);
  if (!ep) return res.status(404).json({ error: '接入点不存在' });
  const result = await testConnection(ep.wss);
  res.json(result);
});

// 获取日志
app.get('/api/endpoints/:id/logs', (req, res) => {
  const entry = bridges[req.params.id];
  if (!entry) return res.json({ logs: [], running: false });
  res.json({ logs: entry.logs.slice(-300), running: true });
});

// 本地工具服务器清单
app.get('/api/local-servers', (req, res) => {
  res.json(LOCAL_SERVERS);
});

// 列出某本地服务器的工具
app.get('/api/local-servers/:serverId/tools', async (req, res) => {
  const srv = LOCAL_SERVERS.find(s => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: '服务器不存在' });
  const result = await callLocalTool(srv.script, null);
  res.json(result);
});

// 调用本地工具
app.post('/api/local-servers/:serverId/call', async (req, res) => {
  const srv = LOCAL_SERVERS.find(s => s.id === req.params.serverId);
  if (!srv) return res.status(404).json({ error: '服务器不存在' });
  const { tool, args } = req.body;
  const result = await callLocalTool(srv.script, tool, args || {});
  res.json(result);
});

// 读取守护进程状态文件
function getGuardianStatus() {
  try {
    const f = path.join(APP_DIR, 'guardian-status.json');
    if (fs.existsSync(f)) {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      // 检查进程是否真的在运行
      const pidFile = path.join(APP_DIR, 'guardian.pid');
      let running = false;
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        if (pid && !isNaN(pid)) {
          try { process.kill(pid, 0); running = true; } catch { running = false; }
        }
      }
      return { ...s, running };
    }
  } catch {}
  return null;
}

// 全局状态
app.get('/api/status', (req, res) => {
  const guardian = getGuardianStatus();
  res.json({
    uptime: process.uptime(),
    bridges: Object.keys(bridges).length,
    endpoints: loadEndpoints().length,
    port: PORT,
    guardian: guardian || { state: 'not_running', running: false }
  });
});

app.listen(PORT, () => {
  console.log(`小智 MCP 管理面板已启动: http://localhost:${PORT}`);
  console.log(`工作目录: ${APP_DIR}`);
});
