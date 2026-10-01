#!/usr/bin/env node
/**
 * xiaozhi-mcp-bridge CLI 入口
 * 同时启动 Web 管理面板和桥接守护进程
 */
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const PORT = process.env.PORT || 37246;

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
console.log('按 Ctrl+C 停止所有服务');
console.log('');

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n正在停止...');
  server.kill();
  process.exit(0);
});
