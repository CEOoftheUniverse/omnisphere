#!/usr/bin/env node
/**
 * Antigravity (VS Code) Watcher Adapter
 *
 * Connects to the orchestrator relay via WebSocket and:
 *   1. Watches ~/.antigravity-tasks/ for task files (file-based dispatch)
 *   2. Receives tasks via WebSocket from the relay
 *   3. Executes tasks by writing to VS Code terminal or Cline's task queue
 *   4. Reports results back to the orchestrator
 *
 * Run as a background service alongside VS Code.
 */

import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

const RELAY_WS = process.env.RELAY_WS || "ws://127.0.0.1:18800";
const AGENT_ID = "antigravity";
const TASK_DIR = path.join(process.env.USERPROFILE || "C:\\Users\\Administrator", ".antigravity-tasks");
const POLL_MS  = 3000;
const RECONNECT_MS = 5000;
const HEARTBEAT_MS = 30000;

// Ensure task directory exists
fs.mkdirSync(TASK_DIR, { recursive: true });

let ws = null;
let heartbeatTimer = null;

// ---------------------------------------------------------------------------
// WebSocket connection to relay
// ---------------------------------------------------------------------------
function connect() {
  try {
    ws = new WebSocket(`${RELAY_WS}?id=${AGENT_ID}`);
  } catch {
    console.log("[watcher] Relay offline, retrying...");
    setTimeout(connect, RECONNECT_MS);
    return;
  }

  ws.on("open", () => {
    console.log("[watcher] Connected to relay");
    ws.send(JSON.stringify({ type: "heartbeat", status: "ready", agent: AGENT_ID }));
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat", status: "alive" }));
      }
    }, HEARTBEAT_MS);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "task" || msg.type === "new_task") {
        handleTask(msg.payload || msg);
      }
      if (msg.type === "pending_tasks" && msg.tasks) {
        msg.tasks.forEach(handleTask);
      }
    } catch {}
  });

  ws.on("close", () => {
    clearInterval(heartbeatTimer);
    console.log("[watcher] Disconnected, reconnecting...");
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on("error", () => ws.close());
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------
function handleTask(task) {
  const message = task.message || "";
  console.log(`[watcher] Task: ${message.substring(0, 80)}...`);

  // Strategy 1: Write to Cline task file for Cline/Roo Code to pick up
  const clineTaskDir = path.join(process.env.USERPROFILE || "C:\\Users\\Administrator", ".cline", "tasks");
  fs.mkdirSync(clineTaskDir, { recursive: true });
  const clineTaskFile = path.join(clineTaskDir, `orch-${Date.now()}.md`);
  fs.writeFileSync(clineTaskFile, `# Orchestrator Task\n\n${message}\n\n---\nSource: orchestrator\nTaskId: ${task.id || "unknown"}\nTimestamp: ${new Date().toISOString()}\n`);

  // Strategy 2: Execute as shell command if it looks like one
  if (message.startsWith("!") || message.startsWith("exec:")) {
    const cmd = message.replace(/^(!|exec:)\s*/, "");
    exec(cmd, { cwd: process.env.USERPROFILE, timeout: 60000 }, (err, stdout, stderr) => {
      sendResult(task.id, {
        action: "exec",
        exitCode: err?.code || 0,
        stdout: stdout?.substring(0, 2000),
        stderr: stderr?.substring(0, 500),
      });
    });
    return;
  }

  // Strategy 3: Write task file for manual pickup
  const taskFile = path.join(TASK_DIR, `task-${task.id || Date.now()}.json`);
  fs.writeFileSync(taskFile, JSON.stringify({
    ...task,
    status: "received",
    receivedAt: new Date().toISOString(),
  }, null, 2));

  sendResult(task.id, { action: "queued", file: taskFile, clineFile: clineTaskFile });
}

function sendResult(taskId, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "result", taskId, data }));
  }
}

// ---------------------------------------------------------------------------
// File watcher — poll for task files dropped by MCP server or other agents
// ---------------------------------------------------------------------------
function pollTaskFiles() {
  try {
    const files = fs.readdirSync(TASK_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const fp = path.join(TASK_DIR, file);
      try {
        const task = JSON.parse(fs.readFileSync(fp, "utf8"));
        if (task.status === "pending") {
          task.status = "processing";
          fs.writeFileSync(fp, JSON.stringify(task, null, 2));
          handleTask(task);
        }
      } catch {}
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
console.log(`[antigravity-watcher] Starting...`);
console.log(`  Task dir: ${TASK_DIR}`);
console.log(`  Relay: ${RELAY_WS}`);

connect();
setInterval(pollTaskFiles, POLL_MS);
