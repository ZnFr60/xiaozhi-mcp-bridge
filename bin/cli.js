#!/usr/bin/env node
/**
 * xiaozhi-mcp-bridge CLI 入口
 *
 * 用法:
 *   xiaozhi-mcp                    启动 Web 面板 + 桥接守护进程
 *   xiaozhi-mcp config [args...]  调用配置工具（add/list/remove/token/status）
 *   xiaozhi-mcp server             仅启动 Web 面板
 *   xiaozhi-mcp bridge             仅启动桥接守护进程
 *   xiaozhi-mcp test               运行工具自检
 */
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const PORT = process.env.PORT || 37246;
const args = process.argv.slice(2);
const cmd = args[0];

// ---------- config 子命令：路由到 config-cli.js ----------
if (cmd === 'config') {
  const child = spawn(process.execPath, [path.join(PROJECT_DIR, 'config-cli.js'), ...args.slice(1)], {
    cwd: PROJECT_DIR,
    stdio: 'inherit'
  });
  child.on('exit', (code) => process.exit(code || 0));
  return;
}

// ---------- test 子命令：运行自检 ----------
if (cmd === 'test') {
  const child = spawn(process.execPath, [path.join(PROJECT_DIR, 'test-harness.js'), ...args.slice(1)], {
    cwd: PROJECT_DIR,
    stdio: 'inherit'
  });
  child.on('exit', (code) => process.exit(code || 0));
  return;
}

// ---------- 启动时生成 mcp.json ----------
try {
  require(path.join(PROJECT_DIR, 'lib', 'mcp-config.js')).generateMcpConfig(PROJECT_DIR);
} catch (e) {
  console.error('[WARN] 生成 mcp.json 失败:', e.message);
}

// ---------- server 子命令：仅 Web 面板 ----------
if (cmd === 'server') {
  const server = spawn(process.execPath, [path.join(PROJECT_DIR, 'server.js')], {
    cwd: PROJECT_DIR, env: { ...process.env, PORT }, stdio: 'inherit'
  });
  process.on('SIGINT', () => { server.kill(); process.exit(0); });
  return;
}

// ---------- bridge 子命令：仅守护进程 ----------
if (cmd === 'bridge') {
  const guardian = spawn(process.execPath, [path.join(PROJECT_DIR, 'guardian.js')], {
    cwd: PROJECT_DIR, env: { ...process.env }, stdio: 'inherit'
  });
  process.on('SIGINT', () => { guardian.kill(); process.exit(0); });
  return;
}

// ---------- 默认：同时启动 Web 面板 + 桥接 ----------
console.log('========================================');
console.log('  小智 AI MCP 桥接 / Xiaozhi MCP Bridge');
console.log('========================================');
console.log('');

// 检查 config.js
try {
  require(path.join(PROJECT_DIR, 'config.js'));
  console.log('[OK] 配置文件 config.js 已加载');
} catch {
  console.log('[WARN] 未找到 config.js，请复制 config.example.js 为 config.js 并填入小智 token');
  console.log('       或运行: xiaozhi-mcp config token "wss://..."');
  console.log('       桥接守护进程将无法启动，但 Web 面板仍可使用');
}

// 启动 Web 管理面板
console.log('[1/2] 启动 Web 管理面板...');
const server = spawn(process.execPath, [path.join(PROJECT_DIR, 'server.js')], {
  cwd: PROJECT_DIR,
  env: { ...process.env, PORT },
  stdio: 'inherit'
});

// 延迟启动桥接（等面板先起来）
setTimeout(() => {
  try {
    require(path.join(PROJECT_DIR, 'config.js'));
    console.log('[2/2] 启动桥接守护进程...');
    const guardian = spawn(process.execPath, [path.join(PROJECT_DIR, 'guardian.js')], {
      cwd: PROJECT_DIR,
      env: { ...process.env },
      stdio: 'inherit'
    });
    guardian.on('exit', (code) => {
      console.log(`[guardian] 进程退出，code=${code}`);
    });
  } catch {
    console.log('[2/2] 跳过桥接（未配置 config.js）');
  }
}, 2000);

console.log('');
console.log(`Web 管理面板: http://localhost:${PORT}`);
console.log('配置工具: xiaozhi-mcp config status');
console.log('按 Ctrl+C 停止所有服务');
console.log('');

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n正在停止...');
  server.kill();
  process.exit(0);
});
