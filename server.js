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
const http = require('http');

const APP_DIR = __dirname;
const ENDPOINTS_FILE = path.join(APP_DIR, 'endpoints.json');
const MCP_CONFIG = path.join(APP_DIR, 'mcp.json');
const MCP_EXE = path.join(APP_DIR, 'node_modules', 'mcp_exe', 'bin', 'cli.js');
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
const bridges = {}; // endpointId -> { child, logs, startedAt }

function startBridge(ep) {
  if (bridges[ep.id]) return { ok: false, error: '已在运行' };
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
  const entry = bridges[epId];
  if (!entry) return { ok: false, error: '未运行' };
  try { entry.child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { entry.child.kill('SIGKILL'); } catch {} }, 2000);
  delete bridges[epId];
  return { ok: true };
}

function testConnection(wss) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCP_EXE, '--ws', wss, '--mcp-config', MCP_CONFIG], {
      cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let connected = false;
    const onData = (d) => {
      output += d.toString();
      if (output.includes('成功连接到WebSocket') || output.includes('WebSocket') && output.includes('initialize')) {
        connected = true;
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({
        connected,
        output: output.slice(-3000),
        message: connected ? '连接成功' : '连接失败或超时（8秒内未检测到握手）'
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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// 接入点列表
app.get('/api/endpoints', (req, res) => {
  const eps = loadEndpoints();
  const withStatus = eps.map(ep => ({
    ...ep,
    running: !!bridges[ep.id],
    pid: bridges[ep.id]?.child?.pid || null,
    uptime: bridges[ep.id] ? Math.floor((Date.now() - bridges[ep.id].startedAt) / 1000) : 0
  }));
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

// 全局状态
app.get('/api/status', (req, res) => {
  res.json({
    uptime: process.uptime(),
    bridges: Object.keys(bridges).length,
    endpoints: loadEndpoints().length,
    port: PORT
  });
});

app.listen(PORT, () => {
  console.log(`小智 MCP 管理面板已启动: http://localhost:${PORT}`);
  console.log(`工作目录: ${APP_DIR}`);
});
