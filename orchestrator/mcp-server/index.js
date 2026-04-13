#!/usr/bin/env node
/**
 * Orchestrator MCP Server
 *
 * Architecture: Clawdbot = brain, Claude Code = hands, Antigravity = eyes
 *
 * Exposes tools to Claude Desktop / Code / Cowork:
 *   - send_task(target, message)       — dispatch a task to clawdbot|moltbot|antigravity
 *   - receive_delegation(task, context) — receive structured tasks from Clawdbot
 *   - list_agents()                    — enumerate reachable agents and their status
 *   - read_inbox()                     — check messages that came back from agents
 *   - broadcast(message)               — fan-out to all agents
 *   - delegation_metrics()             — view task routing effectiveness
 *
 * Transport: stdio (standard MCP transport for Claude Desktop / Code)
 * Backend:   HTTP calls to Clawdbot Gateway & MoltBot API
 *            Redis pub/sub optional (for future multi-machine scaling)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CLAWDBOT_URL   = process.env.CLAWDBOT_URL   || "http://127.0.0.1:18789";
const CLAWDBOT_TOKEN = process.env.CLAWDBOT_TOKEN  || "6d3a49f029f7788215b40ada4bc03e6671b3e892870161b2";
const MOLTBOT_URL    = process.env.MOLTBOT_URL     || "http://127.0.0.1:3000";
const COWORK_API     = process.env.COWORK_API      || "http://127.0.0.1:8080";
const RELAY_WS_PORT  = parseInt(process.env.RELAY_WS_PORT || "18800");

// ---------------------------------------------------------------------------
// Inbox & delegation metrics (no Redis needed for localhost)
// ---------------------------------------------------------------------------
const inbox = [];                    // messages from agents, held for read_inbox
const MAX_INBOX = 200;
const METRICS_DIR = join(process.env.USERPROFILE || "C:\\Users\\Administrator", "omnisphere", "orchestrator", "metrics");
const METRICS_FILE = join(METRICS_DIR, "delegation_metrics.json");

function loadMetrics() {
  try {
    if (existsSync(METRICS_FILE)) return JSON.parse(readFileSync(METRICS_FILE, "utf-8"));
  } catch { /* fresh start */ }
  return { delegations: [], routing_stats: { clawdbot: 0, claude_code: 0, antigravity: 0, moltbot: 0 } };
}

function saveMetrics(metrics) {
  mkdirSync(METRICS_DIR, { recursive: true });
  writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

function logDelegation(from, to, task, result_quality = null) {
  const metrics = loadMetrics();
  metrics.delegations.push({
    from, to, task: task.substring(0, 200),
    timestamp: new Date().toISOString(),
    result_quality,
  });
  if (metrics.delegations.length > 500) metrics.delegations = metrics.delegations.slice(-500);
  metrics.routing_stats[to] = (metrics.routing_stats[to] || 0) + 1;
  saveMetrics(metrics);
}

// ---------------------------------------------------------------------------
// WebSocket relay for Tampermonkey & Antigravity adapters
// ---------------------------------------------------------------------------
const wsClients = new Map();         // id -> ws

let wss;
try {
  wss = new WebSocketServer({ port: RELAY_WS_PORT, host: "127.0.0.1" });
  wss.on("connection", (ws, req) => {
    const id = req.headers["x-agent-id"] || `anon-${Date.now()}`;
    wsClients.set(id, ws);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Agent sending a result back
        if (msg.type === "result" || msg.type === "status") {
          inbox.push({ from: id, ...msg, receivedAt: new Date().toISOString() });
          if (inbox.length > MAX_INBOX) inbox.shift();
        }
      } catch { /* ignore */ }
    });
    ws.on("close", () => wsClients.delete(id));
  });
} catch (e) {
  // Port in use — relay already running
}

function broadcastWs(msg) {
  const raw = JSON.stringify(msg);
  for (const ws of wsClients.values()) {
    try { ws.send(raw); } catch { /* dead socket */ }
  }
}

function sendWs(agentId, msg) {
  const ws = wsClients.get(agentId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function httpPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function httpGet(url, headers = {}) {
  const res = await fetch(url, { headers });
  return res.json();
}

// Post to visible comms log so the user can see conversations in browser
const COMMS_LOG_URL = "http://127.0.0.1:9501/api/messages";
async function logToComms(from, text) {
  try {
    await fetch(COMMS_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, text: text.substring(0, 2000) }),
    });
  } catch { /* comms log not running, that's ok */ }
}

// ---------------------------------------------------------------------------
// Target dispatchers
// ---------------------------------------------------------------------------
async function dispatchClawdbot(message, agentId = "main") {
  // Clawdbot gateway: OpenAI-compatible /v1/chat/completions
  try {
    const result = await httpPost(`${CLAWDBOT_URL}/v1/chat/completions`, {
      model: `openclaw/${agentId}`,
      messages: [{ role: "user", content: message }],
      stream: false,
      max_tokens: 4000,
    }, {
      Authorization: `Bearer ${CLAWDBOT_TOKEN}`,
    });
    logDelegation("claude_code", "clawdbot", message);
    const text = result?.choices?.[0]?.message?.content || JSON.stringify(result);
    // Post both sides to visible comms log
    await logToComms("claude-code", message);
    await logToComms("clawdbot", text.substring(0, 2000));
    return { target: "clawdbot", agentId, status: "dispatched", response: text };
  } catch (e) {
    return { target: "clawdbot", agentId, status: "error", error: e.message };
  }
}

async function dispatchMoltbot(message, action = "deploy") {
  try {
    if (action === "deploy") {
      const result = await httpPost(`${MOLTBOT_URL}/api/deploy`, { plan: message });
      return { target: "moltbot", action, status: "dispatched", result };
    }
    if (action === "status") {
      const result = await httpGet(`${MOLTBOT_URL}/api/status`);
      return { target: "moltbot", action: "status", result };
    }
    // Generic task via cowork API
    const result = await httpPost(`${COWORK_API}/jobs`, {
      task: message,
      tenant_id: "orchestrator",
    });
    return { target: "moltbot", action: "task", status: "dispatched", result };
  } catch (e) {
    return { target: "moltbot", action, status: "error", error: e.message };
  }
}

async function dispatchAntigravity(message) {
  // Try WebSocket first (antigravity-watcher adapter)
  if (sendWs("antigravity", { type: "task", message })) {
    return { target: "antigravity", status: "dispatched_ws" };
  }
  // Fallback: write task file that the watcher picks up
  const fs = await import("fs");
  const path = await import("path");
  const taskDir = path.join(process.env.USERPROFILE || "C:\\Users\\Administrator", ".antigravity-tasks");
  fs.mkdirSync(taskDir, { recursive: true });
  const taskFile = path.join(taskDir, `task-${Date.now()}.json`);
  fs.writeFileSync(taskFile, JSON.stringify({
    id: `task-${Date.now()}`,
    message,
    createdAt: new Date().toISOString(),
    status: "pending",
  }));
  return { target: "antigravity", status: "dispatched_file", file: taskFile };
}

async function dispatchChrome(message) {
  if (sendWs("chrome-moltbot", { type: "task", message })) {
    return { target: "chrome-moltbot", status: "dispatched_ws" };
  }
  return { target: "chrome-moltbot", status: "error", error: "No Tampermonkey adapter connected" };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "orchestrator",
  version: "1.0.0",
});

// Tool: send_task
server.tool(
  "send_task",
  "Dispatch a task to a specific agent (clawdbot, moltbot, antigravity, chrome)",
  {
    target: z.enum(["clawdbot", "moltbot", "antigravity", "chrome"]).describe(
      "Target agent system"
    ),
    message: z.string().describe("The task or message to send"),
    agent_id: z.string().optional().describe(
      "For clawdbot: agent id (main|researcher|dev|ops). For moltbot: action (deploy|status|task)"
    ),
  },
  async ({ target, message, agent_id }) => {
    let result;
    switch (target) {
      case "clawdbot":
        result = await dispatchClawdbot(message, agent_id || "main");
        break;
      case "moltbot":
        result = await dispatchMoltbot(message, agent_id || "task");
        break;
      case "antigravity":
        result = await dispatchAntigravity(message);
        break;
      case "chrome":
        result = await dispatchChrome(message);
        break;
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: list_agents
server.tool(
  "list_agents",
  "List all reachable agents and their connection status",
  {},
  async () => {
    const agents = [];

    // Clawdbot agents
    try {
      const status = await httpGet(`${CLAWDBOT_URL}/api/v1/health`, {
        Authorization: `Bearer ${CLAWDBOT_TOKEN}`,
      });
      agents.push({
        system: "clawdbot",
        url: CLAWDBOT_URL,
        status: "online",
        agents: ["main (Clawd)", "researcher (Friday)", "dev (Jarvis)", "ops (Fury)"],
        detail: status,
      });
    } catch {
      agents.push({ system: "clawdbot", url: CLAWDBOT_URL, status: "offline" });
    }

    // MoltBot
    try {
      const status = await httpGet(`${MOLTBOT_URL}/api/status`);
      agents.push({ system: "moltbot", url: MOLTBOT_URL, status: "online", detail: status });
    } catch {
      agents.push({ system: "moltbot", url: MOLTBOT_URL, status: "offline" });
    }

    // Cowork API
    try {
      await httpGet(`${COWORK_API}/health`);
      agents.push({ system: "cowork-api", url: COWORK_API, status: "online" });
    } catch {
      agents.push({ system: "cowork-api", url: COWORK_API, status: "offline" });
    }

    // WebSocket agents
    for (const [id] of wsClients) {
      agents.push({ system: "ws-adapter", id, status: "connected" });
    }

    // Redis
    agents.push({ system: "redis", status: redisPub ? "connected" : "not connected" });

    // Ollama
    try {
      await httpGet("http://127.0.0.1:11434/api/tags");
      agents.push({ system: "ollama", url: "http://127.0.0.1:11434", status: "online" });
    } catch {
      agents.push({ system: "ollama", status: "offline" });
    }

    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  }
);

// Tool: read_inbox
server.tool(
  "read_inbox",
  "Read messages received from agents (results, status updates)",
  {
    limit: z.number().optional().describe("Max messages to return (default 20)"),
    clear: z.boolean().optional().describe("Clear inbox after reading"),
  },
  async ({ limit, clear }) => {
    const n = limit || 20;
    const messages = inbox.slice(-n);
    if (clear) inbox.length = 0;
    return {
      content: [{
        type: "text",
        text: messages.length
          ? JSON.stringify(messages, null, 2)
          : "Inbox empty. No messages from agents yet.",
      }],
    };
  }
);

// Tool: broadcast
server.tool(
  "broadcast",
  "Send a message to ALL connected agents simultaneously",
  {
    message: z.string().describe("Message to broadcast"),
  },
  async ({ message }) => {
    const results = await Promise.allSettled([
      dispatchClawdbot(message),
      dispatchMoltbot(message, "task"),
      dispatchAntigravity(message),
      dispatchChrome(message),
    ]);
    const summary = results.map((r, i) => ({
      target: ["clawdbot", "moltbot", "antigravity", "chrome"][i],
      status: r.status === "fulfilled" ? r.value.status : "error",
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// Tool: agent_status
server.tool(
  "agent_status",
  "Get detailed status of a specific agent system",
  {
    target: z.enum(["clawdbot", "moltbot", "ollama"]).describe("Which system to query"),
  },
  async ({ target }) => {
    let result;
    try {
      switch (target) {
        case "clawdbot":
          result = await httpGet(`${CLAWDBOT_URL}/api/v1/health`, {
            Authorization: `Bearer ${CLAWDBOT_TOKEN}`,
          });
          break;
        case "moltbot":
          result = await httpGet(`${MOLTBOT_URL}/api/status`);
          break;
        case "ollama":
          result = await httpGet("http://127.0.0.1:11434/api/tags");
          break;
      }
    } catch (e) {
      result = { status: "unreachable", error: e.message };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// Tool: receive_delegation — Clawdbot sends structured tasks here
server.tool(
  "receive_delegation",
  "Receive a structured task delegated from Clawdbot (the central orchestrator). Returns the task for Claude Code to execute.",
  {
    task: z.string().describe("The task description to execute"),
    context: z.string().optional().describe("Additional context: repo path, branch, files, constraints"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Task priority"),
    deadline: z.string().optional().describe("ISO deadline for the task"),
    callback_url: z.string().optional().describe("URL to POST results back to (defaults to Clawdbot gateway)"),
  },
  async ({ task, context, priority, deadline, callback_url }) => {
    const delegation = {
      id: `del-${Date.now()}`,
      task,
      context: context || "",
      priority: priority || "normal",
      deadline: deadline || null,
      callback_url: callback_url || `${CLAWDBOT_URL}/v1/chat/completions`,
      receivedAt: new Date().toISOString(),
      status: "received",
    };

    // Add to inbox so it shows up in read_inbox
    inbox.push({ from: "clawdbot", type: "delegation", ...delegation });
    if (inbox.length > MAX_INBOX) inbox.shift();

    logDelegation("clawdbot", "claude_code", task);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "accepted",
          delegation_id: delegation.id,
          message: `Task received: "${task.substring(0, 100)}...". Claude Code will execute this. Context: ${context || "none provided"}.`,
        }, null, 2),
      }],
    };
  }
);

// Tool: delegation_metrics — view task routing effectiveness
server.tool(
  "delegation_metrics",
  "View delegation metrics: how many tasks routed to each agent, recent delegations",
  {},
  async () => {
    const metrics = loadMetrics();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          routing_stats: metrics.routing_stats,
          recent_delegations: metrics.delegations.slice(-10),
          total: metrics.delegations.length,
        }, null, 2),
      }],
    };
  }
);

// Tool: report_back — send a result back to Clawdbot after completing a delegation
server.tool(
  "report_back",
  "Report task results back to Clawdbot after completing a delegated task",
  {
    delegation_id: z.string().describe("The delegation ID received from receive_delegation"),
    result: z.string().describe("The result or summary of completed work"),
    quality: z.enum(["excellent", "good", "partial", "failed"]).optional().describe("Self-assessed quality"),
  },
  async ({ delegation_id, result, quality }) => {
    try {
      const response = await httpPost(`${CLAWDBOT_URL}/v1/chat/completions`, {
        model: "openclaw/main",
        messages: [{
          role: "user",
          content: `[DELEGATION RESULT] ID: ${delegation_id}\nQuality: ${quality || "good"}\n\nResult:\n${result}`,
        }],
        stream: false,
        max_tokens: 2000,
      }, {
        Authorization: `Bearer ${CLAWDBOT_TOKEN}`,
      });
      logDelegation("claude_code", "clawdbot", `report_back:${delegation_id}`, quality);
      return { content: [{ type: "text", text: `Result reported to Clawdbot. Response: ${response?.choices?.[0]?.message?.content?.substring(0, 500) || "acknowledged"}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Failed to report back: ${e.message}` }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Start (no Redis needed — pure HTTP + WebSocket + file-based)
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
