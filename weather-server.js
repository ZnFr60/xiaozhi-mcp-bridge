#!/usr/bin/env node
/**
 * 天气工具 MCP 服务器（stdio）
 * 使用 Open-Meteo 免费 API，无需 key
 * 绵阳坐标固定为 (31.468, 104.679) 避免地理编码歧义
 */
const https = require('https');

const PINNED = { name: '绵阳', lat: 31.468, lon: 104.679 };

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'xiaozhi-mcp/1.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      res.on('error', reject);
    }).on('timeout', function () { this.destroy(); reject(new Error('请求超时')); })
      .on('error', reject);
  });
}

function wmoCode(code) {
  const map = {
    0: '晴', 1: '大部晴', 2: '局部多云', 3: '阴',
    45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
    80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
    95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹'
  };
  return map[code] || ('天气代码 ' + code);
}

async function getWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${PINNED.lat}&longitude=${PINNED.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FShanghai&forecast_days=5`;
  const d = await fetchJson(url);
  const c = d.current;
  const lines = [
    `📍 ${PINNED.name} 当前天气`,
    `🌡️ 温度: ${c.temperature_2m}°C（体感 ${c.apparent_temperature}°C）`,
    `💧 湿度: ${c.relative_humidity_2m}%`,
    `🌤️ 天气: ${wmoCode(c.weather_code)}`,
    `💨 风速: ${c.wind_speed_10m} km/h（风向 ${c.wind_direction_10m}°）`,
    `🕐 更新时间: ${c.time.replace('T', ' ')}`,
    '',
    '📅 未来 5 天:'
  ];
  for (let i = 0; i < d.daily.time.length; i++) {
    lines.push(`  ${d.daily.time[i]}  ${wmoCode(d.daily.weather_code[i])}  ${d.daily.temperature_2m_min[i]}~${d.daily.temperature_2m_max[i]}°C  降水 ${d.daily.precipitation_sum[i]}mm`);
  }
  return lines.join('\n');
}

const TOOLS = [
  {
    name: 'get_weather',
    description: '查询绵阳当前天气及未来5天预报（温度、湿度、天气状况、风速、降水）。数据来自 Open-Meteo，实时免费。',
    inputSchema: { type: 'object', properties: {} }
  }
];

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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: READY, capabilities: { tools: {} }, serverInfo: { name: 'weather-server', version: '1.0.0' } } });
  } else if (method === 'notifications/initialized') {
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    try {
      const text = await getWeather();
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '天气查询失败: ' + e.message }], isError: true } });
    }
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}
