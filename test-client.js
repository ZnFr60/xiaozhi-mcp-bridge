#!/usr/bin/env node
/**
 * 本地 MCP stdio 测试客户端
 * 用法: node test-client.js <server-script> [tool-name] [args-json]
 * 示例: node test-client.js system-tools.js get_system_status
 *       node test-client.js weather-server.js get_weather
 *       node test-client.js web-tools.js search_web '{"query":"今天天气"}'
 */
const { spawn } = require('child_process');
const path = require('path');

const script = process.argv[2];
const tool = process.argv[3] || null;
const args = process.argv[4] ? JSON.parse(process.argv[4]) : {};

if (!script) {
  console.error('用法: node test-client.js <server-script> [tool-name] [args-json]');
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(__dirname, script)], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let id = 0;
let buf = '';
let initialized = false;

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

child.stdout.on('data', (data) => {
  buf += data.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.id === 0 && msg.result) {
      initialized = true;
      console.log('=== initialize OK ===');
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      if (tool) {
        send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      } else {
        send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      }
    } else if (msg.id === 1 && msg.result) {
      console.log('=== tools/list ===');
      for (const t of msg.result.tools) {
        console.log(`  - ${t.name}: ${t.description.slice(0, 60)}`);
      }
      if (tool) {
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
      } else {
        child.kill();
        process.exit(0);
      }
    } else if (msg.id === 2) {
      console.log(`=== ${tool} result ===`);
      if (msg.result && msg.result.content) {
        for (const c of msg.result.content) {
          console.log(c.text);
        }
      } else if (msg.error) {
        console.log('ERROR:', JSON.stringify(msg.error));
      }
      child.kill();
      process.exit(0);
    }
  }
});

child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d));

send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } } });

setTimeout(() => { console.error('超时'); child.kill(); process.exit(1); }, 30000);
