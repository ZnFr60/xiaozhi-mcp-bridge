#!/usr/bin/env node
/**
 * 共享：从 mcp.template.json 动态生成 mcp.json
 * 被 guardian.js / server.js / bin/cli.js 调用
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function generateMcpConfig(appDir) {
  const template = path.join(appDir, 'mcp.template.json');
  const target = path.join(appDir, 'mcp.json');
  if (!fs.existsSync(template)) {
    throw new Error('mcp.template.json 不存在于: ' + template);
  }

  // 读取配置（filesystemRoot）
  let filesystemRoot = os.homedir();
  try {
    const cfg = require(path.join(appDir, 'config.js'));
    if (cfg.filesystemRoot) filesystemRoot = cfg.filesystemRoot;
  } catch {}
  if (process.env.MCP_FILESYSTEM_ROOT) filesystemRoot = process.env.MCP_FILESYSTEM_ROOT;

  const filesystemServer = path.join(
    appDir, 'node_modules', '@modelcontextprotocol',
    'server-filesystem', 'dist', 'index.js'
  );

  let tpl = fs.readFileSync(template, 'utf8');
  tpl = tpl.replace(/\{\{APP_DIR\}\}/g, appDir);
  tpl = tpl.replace(/\{\{FILESYSTEM_SERVER\}\}/g, filesystemServer);
  tpl = tpl.replace(/\{\{FILESYSTEM_ROOT\}\}/g, filesystemRoot);
  fs.writeFileSync(target, tpl, 'utf8');
  return target;
}

module.exports = { generateMcpConfig };
