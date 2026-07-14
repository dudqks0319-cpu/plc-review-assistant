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

where codex >nul 2>nul
if errorlevel 1 (
  echo Codex CLI was not found. The app will still work with deterministic parsing.
  echo Install or update Codex CLI to enable Codex app-server normalization.
)

echo Starting PLC Review Assistant on http://localhost:4173
echo Press Ctrl+C to stop the server.
call npm run start:codex

pause
