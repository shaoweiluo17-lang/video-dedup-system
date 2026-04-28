@echo off
chcp 65001 >nul
title 视频去重下载系统
echo ========================================
echo   视频去重下载系统 — 台式机启动
echo ========================================
echo.

REM 进入项目目录
cd /d "%~dp0.."

REM 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

REM 创建/激活 venv
if not exist "backend\.venv\" (
    echo [1/4] 创建虚拟环境...
    python -m venv backend\.venv
)
echo [1/4] 激活虚拟环境...
call backend\.venv\Scripts\activate.bat

echo [2/4] 安装依赖...
pip install -q -r backend\requirements.txt

echo [3/4] 初始化数据库...
if not exist "backend\.env" (
    copy backend\.env.example backend\.env
    echo [WARN] 已创建 .env，请编辑密码后重跑
    notepad backend\.env
    pause
    exit /b 1
)

echo [4/4] 启动服务...
cd backend
start /B uvicorn app.main:app --host 0.0.0.0 --port 18080

echo.
echo ========================================
echo   🚀 后端已启动！
echo.
echo   API 文档: http://127.0.0.1:18080/docs
echo   健康检查: http://127.0.0.1:18080/health
echo.
echo   关闭此窗口停止服务
echo ========================================

REM 自动打开浏览器
start http://127.0.0.1:18080/docs

pause
