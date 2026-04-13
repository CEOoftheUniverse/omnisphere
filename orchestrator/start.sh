#!/bin/bash
# Omnisphere Orchestrator Startup
# Architecture: Clawdbot = brain, Claude Code = hands, Antigravity = eyes

ORCH_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Omnisphere Orchestrator ==="
echo "Starting components..."

# 1. Check Clawdbot gateway (should already be running)
if curl -s -o /dev/null -w "" http://127.0.0.1:18789/ 2>/dev/null; then
  echo "[OK] Clawdbot gateway on :18789"
else
  echo "[!!] Clawdbot gateway not running. Start it: cd ~/.clawdbot && gateway.cmd"
fi

# 2. Check MoltBot
if curl -s -o /dev/null -w "" http://127.0.0.1:3000/api/status 2>/dev/null; then
  echo "[OK] MoltBot SaaS on :3000"
else
  echo "[!!] MoltBot not running. Start it: cd ~/moltbot-saas && node server.js"
fi

# 3. Check Ollama
if curl -s -o /dev/null -w "" http://127.0.0.1:11434/api/tags 2>/dev/null; then
  echo "[OK] Ollama on :11434"
else
  echo "[!!] Ollama not running"
fi

# 4. Start Antigravity watcher (if not already running)
if ! pgrep -f "antigravity-watcher.js" >/dev/null 2>&1; then
  echo "Starting Antigravity watcher..."
  cd "$ORCH_DIR/adapters" && node antigravity-watcher.js &>/dev/null &
  echo "[OK] Antigravity watcher started (PID $!)"
else
  echo "[OK] Antigravity watcher already running"
fi

# 5. Ensure task directories exist
mkdir -p ~/.antigravity-tasks
mkdir -p "$ORCH_DIR/metrics"

echo ""
echo "=== Ready ==="
echo "MCP server: Add orchestrator to Claude Desktop config and restart"
echo "Send tasks: Claude Code <-> Clawdbot via HTTP on :18789"
echo "File tasks: Drop JSON into ~/.antigravity-tasks/ for Antigravity"
