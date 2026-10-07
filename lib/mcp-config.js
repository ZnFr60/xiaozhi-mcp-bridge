#!/usr/bin/env node
/**
 * 共享：从 mcp.template.json 动态生成 mcp 配置
 * 被 guardian.js / guardian-multi.js / server.js / bin/cli.js 调用
 *
 * 扩展：支持为【单个接入点】生成独立配置，并把该接入点的身份通过 env
 * 传给 message-tools.js。
 *
 * 为什么需要：消息收发的 from/to/user 原本完全由 AI 自填，没有和接入点绑定，
 * 双方名字对不上就永远收不到（实测收件方用 user="用户" 去读，消息却写在
 * "小智2" 的邮箱里）。身份是配置事实，应当由启动方显式注入，而不是让模型猜。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 解析依赖文件的实际路径。
 *
 * 为什么需要：本包有两种用法，依赖位置不同 ——
 *   1) 作为独立应用：git clone 后 npm install，依赖位于 <APP_DIR>/node_modules
 *   2) 作为依赖安装：npm i xiaozhi-mcp-bridge，npm 会把依赖提升到上层 node_modules
 * 原先写死 path.join(APP_DIR, 'node_modules', ...)，在用法 2 下必然 MODULE_NOT_FOUND。
 *
 * 实现说明：这里手动向上遍历 node_modules，而不是用 require.resolve(pkg/package.json)。
 * 因为部分包（如 mcp_exe）在 package.json 里声明了 exports 映射，未导出 ./package.json，
 * require.resolve 会被拒绝 —— 实测 mcp_exe 正是这种情况。
 *
 * @param {string} appDir 应用根目录
 * @param {string} pkg    包名（可含 scope，如 @modelcontextprotocol/server-filesystem）
 * @param {string} sub    包内相对路径（如 dist/index.js）
 * @returns {string} 解析到的路径；都找不到时返回本地约定路径（保留原始报错信息）
 */
function resolveDep(appDir, pkg, sub) {
  const parts = pkg.split('/');
  const tried = [];
  let dir = appDir;
  for (let i = 0; i < 8; i++) {
    tried.push(path.join(dir, 'node_modules', ...parts, sub));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of tried) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return tried[0];
}

/**
 * @param {string} appDir  桥接根目录
 * @param {object} [opts]
 * @param {string} [opts.outFile='mcp.json']        输出文件名（相对 appDir）
 * @param {object} [opts.messageEnv]                注入给 message 服务器的环境变量
 * @returns {string} 生成的文件绝对路径
 */
function generateMcpConfig(appDir, opts = {}) {
  const template = path.join(appDir, 'mcp.template.json');
  const target = path.join(appDir, opts.outFile || 'mcp.json');
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

  const filesystemServer = resolveDep(
    appDir, '@modelcontextprotocol/server-filesystem', 'dist/index.js'
  );

  let tpl = fs.readFileSync(template, 'utf8');
  tpl = tpl.replace(/\{\{APP_DIR\}\}/g, appDir);
  tpl = tpl.replace(/\{\{FILESYSTEM_SERVER\}\}/g, filesystemServer);
  tpl = tpl.replace(/\{\{FILESYSTEM_ROOT\}\}/g, filesystemRoot);

  // 未指定 env 时保持原行为（原样写出模板字符串）
  if (!opts.messageEnv || !Object.keys(opts.messageEnv).length) {
    fs.writeFileSync(target, tpl, 'utf8');
    return target;
  }

  // 注入 message 服务器的 env
  let parsed;
  try {
    parsed = JSON.parse(tpl);
  } catch (e) {
    throw new Error('mcp.template.json 不是合法 JSON，无法注入 env: ' + e.message);
  }
  const msg = parsed.mcpServers && parsed.mcpServers.message;
  if (!msg) throw new Error('mcp.template.json 中没有 message 服务器');
  msg.env = Object.assign({}, msg.env, opts.messageEnv);
  fs.writeFileSync(target, JSON.stringify(parsed, null, 2), 'utf8');
  return target;
}

module.exports = { generateMcpConfig, resolveDep };
