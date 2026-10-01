#!/usr/bin/env node
/**
 * 网页工具 MCP 服务器 v3.0（stdio）
 * 多引擎免费聚合搜索：必应 + 360搜索，自动合并去重
 * 完全免费无限制，双引擎轮询分散请求降低被封概率
 * fetch_page: 抓取网页正文
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
];
function randUA() { return UA_LIST[Math.floor(Math.random() * UA_LIST.length)]; }

function fetchUrl(urlStr, timeoutMs = 15000, headers = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('无效 URL: ' + urlStr)); }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      headers: { 'User-Agent': randUA(), 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
      timeout: timeoutMs
    };
    const req = lib.get(u, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, u).href, timeoutMs, headers));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 3 * 1024 * 1024) { req.destroy(); resolve(data); } });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
  });
}

function stripHtml(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  const entities = { '&nbsp;': ' ', '&ensp;': ' ', '&emsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#0183;': '·', '&middot;': '·', '&#39;': "'", '&apos;': "'", '&hellip;': '…' };
  for (const [k, v] of Object.entries(entities)) t = t.split(k).join(v);
  t = t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ---------- 广告过滤 ----------
const AD_DOMAINS = ['bing.com', 'microsoft.com', 'go.microsoft', 'ads.', 'advertising', 'doubleclick', 'googleadservices', 'so.com/link', '360.cn'];
const AD_PATTERNS = [/广告/i, /推广/i, /sponsored/i, /\bad\b/i];
function isAd(url, title, snippet) {
  const combined = (url + ' ' + title + ' ' + snippet).toLowerCase();
  for (const d of AD_DOMAINS) if (combined.includes(d) && !combined.includes('python.org') && !combined.includes('github.com')) return true;
  for (const p of AD_PATTERNS) if (p.test(combined)) return true;
  return false;
}

// ---------- 必应搜索 ----------
async function searchBing(query, count) {
  const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + (count * 2);
  const html = await fetchUrl(url);
  const linkRe = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/g;
  const snipRe = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
  const links = [];
  let m;
  while ((m = linkRe.exec(html))) {
    const title = stripHtml(m[2]).slice(0, 200);
    if (title && m[1] && !m[1].startsWith('/') && !m[1].includes('bing.com/ck/a')) links.push({ title, url: m[1] });
  }
  const snippets = [];
  while ((m = snipRe.exec(html))) snippets.push(stripHtml(m[1]).slice(0, 300));
  let results = links.map((l, i) => ({ ...l, snippet: snippets[i] || '', source: '必应' }));
  results = results.filter(r => !isAd(r.url, r.title, r.snippet));
  return results.slice(0, count);
}

// ---------- 360搜索 ----------
async function search360(query, count) {
  const url = 'https://www.so.com/s?q=' + encodeURIComponent(query) + '&pn=1';
  const html = await fetchUrl(url);
  // 360标题: <h3 class="res-title..."><a href="跳转" data-mdurl="真实URL">标题</a></h3>
  const titleRe = /<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*"[^>]*data-mdurl="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/g;
  // 摘要: <p class="res-desc...">...</p>
  const snipRe = /<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
  const links = [];
  let m;
  while ((m = titleRe.exec(html))) {
    const title = stripHtml(m[2]).slice(0, 200);
    const realUrl = m[1] || '';
    if (title && realUrl && !realUrl.startsWith('/')) links.push({ title, url: realUrl });
  }
  const snippets = [];
  while ((m = snipRe.exec(html))) snippets.push(stripHtml(m[1]).slice(0, 300));
  let results = links.map((l, i) => ({ ...l, snippet: snippets[i] || '', source: '360' }));
  results = results.filter(r => !isAd(r.url, r.title, r.snippet));
  return results.slice(0, count);
}

// ---------- 多引擎聚合搜索 ----------
async function searchWeb(query, count = 8, engine = 'auto') {
  count = Math.min(Math.max(count, 1), 20);
  const perEngine = Math.ceil(count * 0.7);

  if (engine === 'bing') {
    const r = await searchBing(query, count);
    return formatResults(r, '必应');
  }
  if (engine === '360') {
    const r = await search360(query, count);
    return formatResults(r, '360搜索');
  }

  // auto: 双引擎并行抓取，合并去重
  const [bingRes, so360Res] = await Promise.allSettled([
    searchBing(query, perEngine),
    search360(query, perEngine)
  ]);

  let all = [];
  const errors = [];
  if (bingRes.status === 'fulfilled') all = all.concat(bingRes.value);
  else errors.push('必应: ' + bingRes.reason.message);
  if (so360Res.status === 'fulfilled') all = all.concat(so360Res.value);
  else errors.push('360: ' + so360Res.reason.message);

  if (!all.length) return '所有搜索引擎均失败:\n' + errors.join('\n');

  // 按URL去重，必应优先
  const seen = new Set();
  const unique = [];
  for (const r of all) {
    const key = r.url.replace(/\/$/, '').toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(r); }
  }

  const sources = [...new Set(unique.map(r => r.source))].join('+');
  return formatResults(unique.slice(0, count), sources + ' 聚合');
}

function formatResults(results, sourceLabel) {
  if (!results.length) return '搜索未返回有效结果';
  return '【搜索引擎: ' + sourceLabel + '】\n\n' +
    results.map((r, i) => `[${i + 1}] ${r.title}${r.source ? '（' + r.source + '）' : ''}\n    ${r.url}\n    ${r.snippet}`).join('\n\n');
}

async function fetchPage(url, maxLen = 8000) {
  const html = await fetchUrl(url, 20000);
  const text = stripHtml(html);
  return text.length > maxLen ? text.slice(0, maxLen) + '\n...（已截断，全文 ' + text.length + ' 字）' : text;
}

function getSearchStatus() {
  return [
    '搜索工具状态 (v3.0 多引擎聚合):',
    '  必应搜索: 可用（主引擎，已去广告）',
    '  360搜索: 可用（备用引擎，已去广告）',
    '  工作模式: 双引擎并行抓取 → 合并去重 → 必应优先',
    '  特点: 完全免费无限制，UA轮换，分散请求降低被封概率',
    '  百度/搜狗: 反爬严格，无法直接抓取'
  ].join('\n');
}

const TOOLS = [
  {
    name: 'search_web',
    description: '多引擎聚合网页搜索（必应+360），自动合并去重，完全免费无限制。支持自然语言查询。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，支持自然语言' },
        count: { type: 'number', description: '返回结果数，默认 8，最大 20' },
        engine: { type: 'string', description: '指定引擎：auto（默认，双引擎聚合）、bing、360', enum: ['auto', 'bing', '360'] }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_page',
    description: '抓取指定 URL 的网页正文（去除 HTML 标签），返回纯文本。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
        max_length: { type: 'number', description: '最大返回字符数，默认 8000' }
      },
      required: ['url']
    }
  },
  {
    name: 'search_status',
    description: '查看当前搜索工具配置状态。',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'search_web': return await searchWeb(String(args.query || ''), Math.min(Math.max(args.count || 8, 1), 20), args.engine || 'auto');
    case 'fetch_page': return await fetchPage(String(args.url || ''), Math.min(Math.max(args.max_length || 8000, 500), 30000));
    case 'search_status': return getSearchStatus();
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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'web-tools', version: '3.0.0' } } });
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
