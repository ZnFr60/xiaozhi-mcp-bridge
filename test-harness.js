#!/usr/bin/env node
/**
 * MCP 工具测试平台 / Test Harness
 * 模拟小智 AI 作为 MCP 客户端，自动连接每个工具服务器并调用工具，输出测试报告
 *
 * 用法：
 *   node test-harness.js              # 测试所有服务器
 *   node test-harness.js system       # 只测试指定服务器
 *   node test-harness.js --json       # JSON格式输出
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = __dirname;

// 要测试的 MCP 服务器列表
const SERVERS = [
  { id: 'system', script: 'system-tools.js', label: '系统工具', tests: [
    { tool: 'get_system_status', args: {} },
    { tool: 'get_current_time', args: {} },
    { tool: 'run_command', args: { command: 'echo test_ok' } },
    { tool: 'password_gen', args: { length: 16 } },
    { tool: 'unit_convert', args: { value: 100, from: 'kg', to: 'g' } },
  ]},
  { id: 'web', script: 'web-tools.js', label: '网页工具', tests: [
    { tool: 'search_status', args: {} },
    { tool: 'search_web', args: { query: 'test', count: 3 } },
  ]},
  { id: 'weather', script: 'weather-server.js', label: '天气工具', tests: [
    { tool: 'get_weather', args: {} },
  ]},
  { id: 'dev', script: 'dev-tools.js', label: '开发者工具', tests: [
    { tool: 'json_format', args: { input: '{"a":1}' } },
    { tool: 'base64_encode', args: { text: 'hello' } },
    { tool: 'uuid_gen', args: { count: 2 } },
    { tool: 'hash_calc', args: { algorithm: 'md5', text: 'test' } },
  ]},
  { id: 'code', script: 'code-tools.js', label: '代码执行', tests: [
    { tool: 'get_code_env', args: {} },
    { tool: 'run_python', args: { code: 'print("py_ok")' } },
    { tool: 'run_bash', args: { command: 'echo bash_ok' } },
  ]},
  { id: 'message', script: 'message-tools.js', label: '消息交换机', tests: [
    { tool: 'send_message', args: { action: 'send', from: 'testA', to: 'testB', content: 'test message' } },
    { tool: 'read_messages', args: { action: 'read', user: 'testB' } },
    { tool: 'send_message', args: { action: 'list_users' } },
  ]},
];

const JSON_MODE = process.argv.includes('--json');
const FILTER = process.argv.slice(2).find(a => !a.startsWith('--') && !a.endsWith('.js') && a !== path.basename(__filename));

function log(msg) { if (!JSON_MODE) console.log(msg); }

/**
 * 启动一个 MCP 服务器并执行完整测试流程
 */
function testServer(serverDef) {
  return new Promise((resolve) => {
    const scriptPath = path.join(PROJECT_DIR, serverDef.script);
    if (!fs.existsSync(scriptPath)) {
      resolve({ id: serverDef.id, label: serverDef.label, error: '文件不存在: ' + serverDef.script, tests: [] });
      return;
    }

    const child = spawn(process.execPath, [scriptPath], {
      cwd: PROJECT_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buf = '';
    let stderrBuf = '';
    let msgId = 0;
    const pending = new Map();
    let initialized = false;
    let toolsList = [];
    const results = [];
    const startTime = Date.now();

    function sendMsg(method, params) {
      const id = ++msgId;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((res) => pending.set(id, res));
    }

    function nextId() { return ++msgId; }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            const resolver = pending.get(msg.id);
            pending.delete(msg.id);
            resolver(msg);
          }
        } catch {}
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderrBuf += d; });

    child.on('error', (e) => {
      resolve({ id: serverDef.id, label: serverDef.label, error: '启动失败: ' + e.message, tests: results });
    });

    (async () => {
      try {
        // 1. initialize
        const initResp = await sendMsg('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-harness', version: '1.0' } });
        if (initResp.error) throw new Error('initialize失败: ' + initResp.error.message);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

        // 2. tools/list
        const listResp = await sendMsg('tools/list', {});
        toolsList = (listResp.result && listResp.result.tools) || [];

        // 3. 逐个调用测试
        for (const t of serverDef.tests) {
          const t0 = Date.now();
          try {
            const resp = await sendMsg('tools/call', { name: t.tool, arguments: t.args });
            const duration = Date.now() - t0;
            const isError = resp.result && resp.result.isError;
            const content = resp.result && resp.result.content && resp.result.content[0] && resp.result.content[0].text;
            results.push({
              tool: t.tool,
              args: t.args,
              ok: !isError && !resp.error,
              duration,
              output: (content || '').slice(0, 200),
              error: resp.error ? resp.error.message : (isError ? content : null)
            });
          } catch (e) {
            results.push({ tool: t.tool, args: t.args, ok: false, duration: Date.now() - t0, error: e.message });
          }
        }
      } catch (e) {
        results.push({ tool: '(流程)', ok: false, duration: 0, error: e.message });
      } finally {
        child.kill();
        const totalDuration = Date.now() - startTime;
        const passed = results.filter(r => r.ok).length;
        resolve({
          id: serverDef.id,
          label: serverDef.label,
          toolCount: toolsList.length,
          testsRun: results.length,
          passed,
          failed: results.length - passed,
          duration: totalDuration,
          tests: results,
          stderr: stderrBuf.slice(0, 500)
        });
      }
    })();

    // 超时保护
    setTimeout(() => {
      try { child.kill(); } catch {}
      if (results.length < serverDef.tests.length) {
        resolve({ id: serverDef.id, label: serverDef.label, error: '测试超时(30s)', tests: results });
      }
    }, 30000);
  });
}

async function main() {
  const targets = FILTER ? SERVERS.filter(s => s.id === FILTER || s.script === FILTER) : SERVERS;
  if (!targets.length) { console.error('未找到匹配的服务器:', FILTER); process.exit(1); }

  log('╔══════════════════════════════════════════════╗');
  log('║     MCP 工具测试平台 / Test Harness          ║');
  log('╚══════════════════════════════════════════════╝');
  log(`测试服务器: ${targets.length} 个\n`);

  const allResults = [];
  let totalPass = 0, totalFail = 0;

  for (const srv of targets) {
    // 消息交换机需要 >=2 个接入点才启用工具，测试前临时创建
    let endpointsBackup = null;
    if (srv.id === 'message') {
      const epFile = path.join(PROJECT_DIR, 'endpoints.json');
      endpointsBackup = fs.existsSync(epFile) ? fs.readFileSync(epFile, 'utf8') : null;
      fs.writeFileSync(epFile, JSON.stringify([
        { id: 'ep_test1', name: '测试端A', wss: 'wss://test1.example/mcp' },
        { id: 'ep_test2', name: '测试端B', wss: 'wss://test2.example/mcp' }
      ]), 'utf8');
    }

    log(`▶ 测试 [${srv.label}] (${srv.script})...`);
    const result = await testServer(srv);
    allResults.push(result);

    // 恢复 endpoints.json
    if (srv.id === 'message' && endpointsBackup !== null) {
      fs.writeFileSync(path.join(PROJECT_DIR, 'endpoints.json'), endpointsBackup, 'utf8');
    } else if (srv.id === 'message') {
      fs.unlinkSync(path.join(PROJECT_DIR, 'endpoints.json'));
    }

    if (result.error) {
      log(`  ❌ ${result.error}\n`);
      totalFail++;
      continue;
    }

    log(`  工具数: ${result.toolCount} | 测试: ${result.testsRun} | 通过: ${result.passed} | 失败: ${result.failed} | 耗时: ${result.duration}ms`);
    for (const t of result.tests) {
      const icon = t.ok ? '✅' : '❌';
      log(`  ${icon} ${t.tool} (${t.duration}ms)${t.error ? ' - ' + t.error.slice(0, 80) : ''}`);
    }
    if (result.stderr) log(`  [stderr] ${result.stderr.slice(0, 100)}`);
    log('');
    totalPass += result.passed;
    totalFail += result.failed;
  }

  log('═══════════════════════════════════════════════');
  log(`总计: 通过 ${totalPass} / 失败 ${totalFail}`);
  log(totalFail === 0 ? '🎉 全部测试通过！' : '⚠️  存在失败项，请检查上方详情');
  log('═══════════════════════════════════════════════');

  if (JSON_MODE) {
    console.log(JSON.stringify({ totalPass, totalFail, servers: allResults }, null, 2));
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
