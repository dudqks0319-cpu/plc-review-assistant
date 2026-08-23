@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

set "HOST=127.0.0.1"
echo Starting PLC Review Assistant on http://127.0.0.1:4173
echo Press Ctrl+C to stop the server.
if /I "%PLC_USE_CODEX%"=="1" (
  where codex >nul 2>nul
  if errorlevel 1 (
    echo Codex CLI was not found. Starting deterministic offline mode.
    call npm start
  ) else (
    echo Starting with optional local Codex requirement normalization.
    call npm run start:codex
  )
) else (
  echo Starting deterministic offline mode.
  echo Set PLC_USE_CODEX=1 before launch to enable optional Codex normalization.
  call npm start
)

pause
