@echo off
chcp 65001 >nul
title Video Dedup System

echo ========================================
echo   Video Dedup System - Quick Start
echo ========================================
echo.

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"

cd /d "%BACKEND%"

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

python --version

:: Create venv if not exists
if not exist ".venv\Scripts\activate.bat" (
    echo [1/4] Creating virtual environment...
    python -m venv .venv
)
echo [1/4] Activating virtual environment...
call .venv\Scripts\activate.bat

:: Install dependencies
echo [2/4] Installing dependencies...
pip install -q -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARN] pip install with requirements.txt failed, trying loose install...
    pip install -q fastapi uvicorn[standard] sqlalchemy pymysql pydantic pydantic-settings redis python-multipart pypinyin apscheduler
)

:: Check .env
echo [3/4] Checking .env configuration...
if not exist ".env" (
    copy .env.example .env >nul
    echo [WARN] .env created from template. Please edit it first.
    start notepad .env
    pause
    exit /b 1
)

:: Start server
echo [4/4] Starting server...
start "VideoDedup-Server" cmd /c "uvicorn app.main:app --host 0.0.0.0 --port 18080 --reload"

echo.
echo ========================================
echo   Server started successfully!
echo.
echo   API Docs:  http://127.0.0.1:18080/docs
echo   Health:    http://127.0.0.1:18080/health
echo.
echo   Close this window to stop.
echo ========================================

start http://127.0.0.1:18080/docs

pause
