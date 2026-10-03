#!/usr/bin/env node
/**
 * 双端消息交互测试 - 模拟两个小智 AI 端（A 和 B）的完整对话流程
 *
 * 测试场景：
 * 1. A → B 发消息
 * 2. B 读取新消息（验证防重复读）
 * 3. B → A 回复消息
 * 4. A 读取新消息
 * 5. A 发消息后撤回
 * 6. B 读取（看到撤回标记）
 * 7. 验证已读位置
 * 8. 验证收件箱/发件箱
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_DIR = __dirname;
const MSG_TOOLS = path.join(APP_DIR, 'message-tools.js');

let passed = 0;
let failed = 0;

function test(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} ${detail ? '- ' + detail : ''}`);
    failed++;
  }
}

// MCP stdio 客户端
function callTool(script, toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: APP_DIR, stdio: ['pipe', 'pipe', 'pipe']
    });
    let buf = '';
    let msgId = 0;
    const pending = new Map();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        } catch {}
      }
    });

    function send(method, params) {
      const id = ++msgId;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((res) => pending.set(id, res));
    }

    (async () => {
      try {
        await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dual-test', version: '1.0' } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const resp = await send('tools/call', { name: toolName, arguments: args });
        child.kill();
        const text = resp.result && resp.result.content && resp.result.content[0] && resp.result.content[0].text;
        resolve(text || '');
      } catch (e) {
        child.kill();
        reject(e);
      }
    })();

    setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 10000);
  });
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     双端消息交互测试 / Dual-Endpoint Messaging    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // 清理
  const msgDir = path.join(APP_DIR, 'messages');
  if (fs.existsSync(msgDir)) fs.rmSync(msgDir, { recursive: true });

  // ========== 场景1: A → B 发消息 ==========
  console.log('【场景1】小智端A → 小智端B 发消息');
  const r1 = await callTool(MSG_TOOLS, 'send_message', {
    action: 'send', from: '小智端A', to: '小智端B',
    content: '你好B，我是A，收到请回复。'
  });
  test('A发送消息成功', r1.includes('消息已发送'), r1);
  const msg1Id = (r1.match(/消息ID: (\S+)/) || [])[1];
  test('返回消息ID', !!msg1Id, msg1Id);
  const msg1Ts = (r1.match(/时间戳: (\d+)/) || [])[1];
  test('返回时间戳', !!msg1Ts && msg1Ts.length >= 14, msg1Ts);
  console.log('');

  // ========== 场景2: B 读取新消息 ==========
  console.log('【场景2】小智端B 读取新消息');
  const r2 = await callTool(MSG_TOOLS, 'read_messages', { action: 'read', user: '小智端B' });
  test('B读到1条新消息', r2.includes('共 1 条新消息'), r2.slice(0, 100));
  test('消息内容正确', r2.includes('你好B，我是A'), '');
  test('发送者是A', r2.includes('发送者: 小智端A'), '');
  test('已更新已读位置', r2.includes('已更新已读位置'), '');
  console.log('');

  // ========== 场景3: B 再读（应无新消息 - 防重复） ==========
  console.log('【场景3】小智端B 再次读取（验证防重复读）');
  const r3 = await callTool(MSG_TOOLS, 'read_messages', { action: 'read', user: '小智端B' });
  test('B再次读无新消息', r3.includes('没有新消息'), r3);
  console.log('');

  // ========== 场景4: B → A 回复 ==========
  console.log('【场景4】小智端B → 小智端A 回复消息');
  const r4 = await callTool(MSG_TOOLS, 'send_message', {
    action: 'send', from: '小智端B', to: '小智端A',
    content: '收到A！我是B，消息互通正常。'
  });
  test('B回复成功', r4.includes('消息已发送'), '');
  console.log('');

  // ========== 场景5: A 读取新消息 ==========
  console.log('【场景5】小智端A 读取新消息');
  const r5 = await callTool(MSG_TOOLS, 'read_messages', { action: 'read', user: '小智端A' });
  test('A读到B的回复', r5.includes('共 1 条新消息'), '');
  test('回复内容正确', r5.includes('收到A！我是B'), '');
  test('发送者是B', r5.includes('发送者: 小智端B'), '');
  console.log('');

  // ========== 场景6: A 发消息后撤回 ==========
  console.log('【场景6】小智端A 发消息后撤回');
  const r6 = await callTool(MSG_TOOLS, 'send_message', {
    action: 'send', from: '小智端A', to: '小智端B',
    content: '这条消息马上撤回。'
  });
  const msg3Id = (r6.match(/消息ID: (\S+)/) || [])[1];
  test('A发送待撤回消息', r6.includes('消息已发送'), '');

  const r7 = await callTool(MSG_TOOLS, 'send_message', {
    action: 'recall', user: '小智端A', msg_id: msg3Id
  });
  test('撤回成功', r7.includes('消息已撤回'), r7);
  test('撤回方式是标记不删除', r7.includes('recalled=true'), '');
  console.log('');

  // ========== 场景7: B 读取（看到撤回标记） ==========
  console.log('【场景7】小智端B 读取（验证撤回标记）');
  const r8 = await callTool(MSG_TOOLS, 'read_messages', { action: 'read', user: '小智端B' });
  test('B读到撤回的消息', r8.includes('共 1 条新消息'), '');
  test('显示已撤回标记', r8.includes('此消息已被撤回'), '');
  test('撤回消息内容仍可见', r8.includes('这条消息马上撤回'), '');
  console.log('');

  // ========== 场景8: 查看已读位置 ==========
  console.log('【场景8】查看已读位置');
  const r9 = await callTool(MSG_TOOLS, 'read_messages', { action: 'get_position', user: '小智端B' });
  test('B的已读位置包含A', r9.includes('小智端A') || r9.includes('A'), r9);
  const r10 = await callTool(MSG_TOOLS, 'read_messages', { action: 'get_position', user: '小智端A' });
  test('A的已读位置包含B', r10.includes('小智端B') || r10.includes('B'), r10);
  console.log('');

  // ========== 场景9: 查看收件箱/发件箱 ==========
  console.log('【场景9】查看收件箱/发件箱');
  const r11 = await callTool(MSG_TOOLS, 'read_messages', { action: 'list_inbox', user: '小智端B' });
  test('B收件箱有2条消息', r11.includes('共 2 条'), r11.slice(0, 80));
  test('B收件箱显示撤回标记', r11.includes('已撤回'), '');

  const r12 = await callTool(MSG_TOOLS, 'read_messages', { action: 'list_outbox', user: '小智端A' });
  test('A发件箱有2条消息', r12.includes('共 2 条'), '');
  test('A发件箱显示撤回标记', r12.includes('已撤回'), '');
  console.log('');

  // ========== 场景10: 列出用户 ==========
  console.log('【场景10】列出所有用户端');
  const r13 = await callTool(MSG_TOOLS, 'send_message', { action: 'list_users' });
  test('列出用户包含A和B', r13.includes('小智端A') && r13.includes('小智端B'), r13);
  console.log('');

  // ========== 场景11: 重置已读位置后重读 ==========
  console.log('【场景11】重置B的已读位置，验证能重新读到所有消息');
  await callTool(MSG_TOOLS, 'read_messages', { action: 'reset_position', user: '小智端B' });
  const r14 = await callTool(MSG_TOOLS, 'read_messages', { action: 'read', user: '小智端B' });
  test('重置后B能读到2条消息', r14.includes('共 2 条新消息'), r14.slice(0, 80));
  console.log('');

  // ========== 总结 ==========
  console.log('═══════════════════════════════════════════════════');
  console.log(`  测试结果: 通过 ${passed} / 失败 ${failed}`);
  console.log(failed === 0 ? '  🎉 双端消息交互全部通过！' : '  ⚠️  存在失败项');
  console.log('═══════════════════════════════════════════════════');

  // 清理
  if (fs.existsSync(msgDir)) fs.rmSync(msgDir, { recursive: true });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
