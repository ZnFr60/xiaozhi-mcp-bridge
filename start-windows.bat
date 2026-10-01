@echo off
chcp 65001 >nul 2>&1
title 小智 MCP 桥接 - 启动器
cd /d "%~dp0"

:: ============================================
::  小智 MCP 桥接 Windows 启动脚本
::  权限绑定：本脚本以什么权限运行，所有子进程（node/mcp_exe）就继承什么权限
::  普通运行 → 普通用户权限
::  管理员运行 → 管理员权限（可访问全机目录、修改系统文件）
:: ============================================

:: 检测是否已管理员权限
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [权限] 已以管理员身份运行，所有子进程将继承管理员权限
    goto :run
)

:: 未提权，自动请求 UAC 提权
echo [权限] 当前为普通用户权限，正在请求管理员提权...
echo [提示] 弹出 UAC 窗口请点击"是"
powershell -Command "Start-Process '%~f0' -Verb RunAs"
exit /b

:run
echo.
echo ========================================
echo   小智 MCP 桥接启动中...
echo   工作目录: %cd%
echo   权限: 管理员
echo ========================================
echo.

:: 停止旧进程
echo [1/3] 停止旧进程...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

:: 启动 UI 管理面板
echo [2/3] 启动 UI 管理面板 (端口 37246)...
start "xiaozhi-mcp-ui" /min node server.js
timeout /t 2 /nobreak >nul

:: 启动桥接守护进程
echo [3/3] 启动桥接守护进程...
start "xiaozhi-mcp-bridge" /min node guardian.js

echo.
echo ========================================
echo   启动完成！
echo   UI 面板: http://localhost:37246
echo   日志: mcp.log
echo.
echo   权限说明: 所有 MCP 服务进程均以管理员身份运行
echo   关闭窗口不会停止服务（后台运行）
echo ========================================
echo.
pause
