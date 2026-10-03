@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ============================================================
REM  小智 AI MCP 桥接 - Windows 一键部署脚本
REM  Xiaozhi AI MCP Bridge - Windows One-Click Deploy
REM ============================================================

set "PROJECT_NAME=xiaozhi-mcp-bridge"
set "INSTALL_DIR=%USERPROFILE%\%PROJECT_NAME%"
set "REPO_URL=https://github.com/ZnFr60/xiaozhi-mcp-bridge.git"
set "PORT=37246"

echo.
echo ╔══════════════════════════════════════════════╗
echo ║   小智 AI MCP 桥接 - Windows 一键部署        ║
echo ║   Xiaozhi AI MCP Bridge - Windows Deploy    ║
echo ╚══════════════════════════════════════════════╝
echo.

REM ---------- 1. 检查 Node.js ----------
echo [INFO] 检查 Node.js 环境...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERR]  未检测到 Node.js，请先安装 Node.js ^>= 18
    echo        下载地址: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK]    Node.js !NODE_VER!

REM ---------- 2. 克隆或更新项目 ----------
if exist "%INSTALL_DIR%" (
    echo [WARN]  目录已存在: %INSTALL_DIR%
    set /p UPDATE="是否更新到最新版本? [Y/n]: "
    if /i not "!UPDATE!"=="n" (
        echo [INFO] 拉取最新代码...
        cd /d "%INSTALL_DIR%"
        git pull --ff-only >nul 2>&1
        if errorlevel 1 (
            echo [WARN]  git pull 失败，继续使用现有版本
        ) else (
            echo [OK]    代码已更新
        )
    ) else (
        echo [INFO] 跳过更新
        cd /d "%INSTALL_DIR%"
    )
) else (
    echo [INFO] 克隆项目到 %INSTALL_DIR% ...
    where git >nul 2>&1
    if errorlevel 1 (
        echo [ERR]  未检测到 git，请先安装 Git
        echo        下载地址: https://git-scm.com/download/win
        pause
        exit /b 1
    )
    git clone --depth 1 "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [ERR]  克隆失败
        pause
        exit /b 1
    )
    echo [OK]    克隆完成
    cd /d "%INSTALL_DIR%"
)

REM ---------- 3. 安装依赖 ----------
echo [INFO] 安装 npm 依赖...
call npm install --production
if errorlevel 1 (
    echo [ERR]  依赖安装失败
    pause
    exit /b 1
)
echo [OK]    依赖安装完成

REM ---------- 4. 配置 ----------
if not exist config.js (
    echo [INFO] 创建配置文件...
    copy config.example.js config.js >nul
    echo [OK]    已创建 config.js
) else (
    echo [WARN]  config.js 已存在，跳过
)

echo.
echo ┌──────────────────────────────────────────────┐
echo │  接下来需要配置小智 WSS Token                  │
echo │  获取方式: 小智 AI 后台 → MCP 接入点           │
echo └──────────────────────────────────────────────┘
echo.
set /p WSS_TOKEN="请输入小智 WSS Token (直接回车跳过): "

if defined WSS_TOKEN (
    REM 使用 node -e 安全写入（避免 PowerShell 特殊字符和占位符问题）
    node -e "const fs=require('fs');const t=process.argv[1];let c=fs.readFileSync('config.js','utf8');c=c.replace(/xiaozhiWss:\s*'[^']*'/,'xiaozhiWss: \''+t.replace(/'/g,\"\\\\'\")+\"'\");fs.writeFileSync('config.js',c,'utf8');" "%WSS_TOKEN%"
    if !errorlevel! equ 0 (
        echo [OK]    Token 已写入 config.js
    ) else (
        echo [ERR]   Token 写入失败，请手动编辑 config.js
    )
) else (
    echo [WARN]  跳过 Token 配置，请稍后手动编辑 config.js
)

REM ---------- 5. 启动 ----------
echo.
set /p START_NOW="是否立即启动服务? [Y/n]: "
if /i not "!START_NOW!"=="n" (
    echo [INFO] 启动服务（静默模式，无窗口）...
    start "" /B wscript.exe //nologo //b start-windows-silent.vbs
    timeout /t 3 /nobreak >nul
    echo.
    echo [OK]    服务已启动!
    echo.
    echo   Web 管理面板: http://localhost:%PORT%
    echo   日志文件:     %INSTALL_DIR%\server.log
) else (
    echo [INFO] 跳过启动
    echo.
    echo   手动启动: cd /d %INSTALL_DIR% ^&^& start-windows.bat
    echo   静默启动: cd /d %INSTALL_DIR% ^&^& start-windows-silent.vbs
    echo   Web 面板: http://localhost:%PORT%
)

echo.
echo [OK]    部署完成!
echo.
echo   项目目录: %INSTALL_DIR%
echo   配置文件: %INSTALL_DIR%\config.js
echo   自检命令: cd /d %INSTALL_DIR% ^&^& node test-harness.js
echo.
pause
