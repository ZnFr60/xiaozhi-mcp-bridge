#!/usr/bin/env node
/**
 * 开发者工具 MCP 服务器（stdio）
 * JSON/Base64/URL/时间戳/UUID/Hash/正则/DNS/HTTP/端口
 */
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

// ---------- 工具函数 ----------
function jsonFormat(input) {
  try {
    const obj = JSON.parse(input);
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return 'JSON 解析失败: ' + e.message;
  }
}

function base64Encode(str) { return Buffer.from(str, 'utf8').toString('base64'); }
function base64Decode(str) {
  try { return Buffer.from(str, 'base64').toString('utf8'); }
  catch (e) { return '解码失败: ' + e.message; }
}

function hashCalc(algo, str) {
  try { return crypto.createHash(algo).update(str, 'utf8').digest('hex'); }
  catch (e) { return '不支持的算法: ' + algo + '（支持 md5/sha1/sha256/sha512）'; }
}

function uuidGen() { return crypto.randomUUID(); }

function timestampConvert(input) {
  // 纯数字 => 时间戳转日期；否则日期转时间戳
  if (/^\d+$/.test(input)) {
    const ts = Number(input);
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    return `时间戳 ${ts} (秒) => ${d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) return '无法解析日期: ' + input;
  return `${input} => 时间戳 ${Math.floor(d.getTime() / 1000)} (秒) / ${d.getTime()} (毫秒)`;
}

function regexTest(pattern, text) {
  try {
    const re = new RegExp(pattern);
    const matches = [];
    let m;
    const globalRe = new RegExp(pattern, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = globalRe.exec(text)) && matches.length < 20) {
      matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
    }
    if (!matches.length) return '无匹配';
    return `共匹配 ${matches.length} 处:\n` + matches.map((x, i) =>
      `  [${i + 1}] "${x.match}" @位置${x.index}${x.groups.length ? ' 分组: ' + JSON.stringify(x.groups) : ''}`
    ).join('\n');
  } catch (e) {
    return '正则错误: ' + e.message;
  }
}

function dnsLookup(domain) {
  return new Promise((resolve) => {
    dns.resolve4(domain, (err4, addrs4) => {
      dns.resolve6(domain, (err6, addrs6) => {
        dns.resolveCname(domain, (errC, cname) => {
          const parts = [];
          parts.push(`域名: ${domain}`);
          parts.push(`A 记录: ${err4 ? '无(' + err4.code + ')' : addrs4.join(', ')}`);
          parts.push(`AAAA 记录: ${err6 ? '无' : addrs6.join(', ')}`);
          if (!errC && cname.length) parts.push(`CNAME: ${cname.join(', ')}`);
          resolve(parts.join('\n'));
        });
      });
    });
  });
}

function httpRequest(url, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve('URL 无效: ' + e.message); }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method, headers: { 'User-Agent': 'xiaozhi-mcp/1.0', ...headers } };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; if (data.length > 50000) { req.destroy(); } });
      res.on('end', () => {
        resolve(`HTTP ${res.statusCode}\n` + Object.entries(res.headers).map(([k, v]) => `  ${k}: ${v}`).slice(0, 10).join('\n') + '\n\n' + (data.length > 4000 ? data.slice(0, 4000) + '\n...(截断)' : data));
      });
    });
    req.on('error', (e) => resolve('请求失败: ' + e.message));
    req.setTimeout(15000, () => { req.destroy(); resolve('请求超时'); });
    if (body) req.write(body);
    req.end();
  });
}

function portCheck(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => { sock.destroy(); resolve(`✅ ${host}:${port} 端口开放`); });
    sock.on('timeout', () => { sock.destroy(); resolve(`⏳ ${host}:${port} 连接超时（可能关闭或被防火墙拦截）`); });
    sock.on('error', (e) => { resolve(`❌ ${host}:${port} 连接失败: ${e.message}`); });
    sock.connect(port, host);
  });
}

// ---------- MCP 工具定义 ----------
const TOOLS = [
  { name: 'json_format', description: '格式化或校验 JSON 字符串，返回美化后的 JSON。', inputSchema: { type: 'object', properties: { input: { type: 'string', description: 'JSON 字符串' } }, required: ['input'] } },
  { name: 'base64_encode', description: '将文本编码为 Base64。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要编码的文本' } }, required: ['text'] } },
  { name: 'base64_decode', description: '将 Base64 字符串解码为文本。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Base64 字符串' } }, required: ['text'] } },
  { name: 'url_encode', description: 'URL 编码（encodeURIComponent）。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要编码的文本' } }, required: ['text'] } },
  { name: 'url_decode', description: 'URL 解码（decodeURIComponent）。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要解码的文本' } }, required: ['text'] } },
  { name: 'timestamp_convert', description: '时间戳与日期互转。输入纯数字视为时间戳（自动判断秒/毫秒），输入日期字符串转为时间戳。', inputSchema: { type: 'object', properties: { input: { type: 'string', description: '时间戳或日期字符串' } }, required: ['input'] } },
  { name: 'uuid_gen', description: '生成一个 UUID v4。', inputSchema: { type: 'object', properties: { count: { type: 'number', description: '生成数量，默认 1，最大 20' } } } },
  { name: 'hash_calc', description: '计算字符串的哈希值，支持 md5/sha1/sha256/sha512。', inputSchema: { type: 'object', properties: { algorithm: { type: 'string', description: '哈希算法，默认 sha256' }, text: { type: 'string', description: '要计算的文本' } }, required: ['text'] } },
  { name: 'regex_test', description: '测试正则表达式，返回所有匹配结果及分组。', inputSchema: { type: 'object', properties: { pattern: { type: 'string', description: '正则表达式' }, text: { type: 'string', description: '要测试的文本' } }, required: ['pattern', 'text'] } },
  { name: 'dns_lookup', description: '查询域名的 DNS 记录（A/AAAA/CNAME）。', inputSchema: { type: 'object', properties: { domain: { type: 'string', description: '域名，如 example.com' } }, required: ['domain'] } },
  { name: 'http_request', description: '发送 HTTP/HTTPS 请求，返回状态码、响应头和响应体。', inputSchema: { type: 'object', properties: { url: { type: 'string', description: '请求 URL' }, method: { type: 'string', description: '请求方法，默认 GET' }, headers: { type: 'object', description: '自定义请求头' }, body: { type: 'string', description: '请求体（POST/PUT 时使用）' } }, required: ['url'] } },
  { name: 'port_check', description: '检测目标主机的端口是否开放。', inputSchema: { type: 'object', properties: { host: { type: 'string', description: '主机名或 IP' }, port: { type: 'number', description: '端口号' }, timeout: { type: 'number', description: '超时毫秒，默认 3000' } }, required: ['host', 'port'] } }
];

async function callTool(name, args) {
  switch (name) {
    case 'json_format': return jsonFormat(String(args.input || ''));
    case 'base64_encode': return base64Encode(String(args.text || ''));
    case 'base64_decode': return base64Decode(String(args.text || ''));
    case 'url_encode': return encodeURIComponent(String(args.text || ''));
    case 'url_decode': try { return decodeURIComponent(String(args.text || '')); } catch (e) { return '解码失败: ' + e.message; }
    case 'timestamp_convert': return timestampConvert(String(args.input || ''));
    case 'uuid_gen': { const n = Math.min(Math.max(args.count || 1, 1), 20); return Array.from({ length: n }, () => uuidGen()).join('\n'); }
    case 'hash_calc': return hashCalc(String(args.algorithm || 'sha256'), String(args.text || ''));
    case 'regex_test': return regexTest(String(args.pattern || ''), String(args.text || ''));
    case 'dns_lookup': return await dnsLookup(String(args.domain || ''));
    case 'http_request': return await httpRequest(String(args.url || ''), String(args.method || 'GET'), args.headers || {}, args.body || null);
    case 'port_check': return await portCheck(String(args.host || ''), Number(args.port) || 0, Number(args.timeout) || 3000);
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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'dev-tools', version: '1.0.0' } } });
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
