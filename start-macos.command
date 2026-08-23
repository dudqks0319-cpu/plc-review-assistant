#!/bin/zsh
set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
cd "$SCRIPT_DIRECTORY"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required."
  echo "Download: https://nodejs.org/"
  read -r "?Press Return to close."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(\".\")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required. Current major version: $NODE_MAJOR"
  read -r "?Press Return to close."
  exit 1
fi

export HOST="127.0.0.1"
echo "Starting PLC Review Assistant on http://127.0.0.1:4173"
echo "Press Control+C to stop the server."

if [[ "${PLC_USE_CODEX:-0}" == "1" ]] && command -v codex >/dev/null 2>&1; then
  echo "Starting with optional local Codex requirement normalization."
  npm run start:codex
else
  echo "Starting deterministic offline mode."
  echo "Set PLC_USE_CODEX=1 before launch to enable optional Codex normalization."
  npm start
fi
