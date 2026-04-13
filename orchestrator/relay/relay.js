#!/usr/bin/env node
/**
 * Orchestrator Relay
 *
 * Standalone WebSocket + HTTP bridge that runs as a persistent service.
 * The MCP server embeds its own WS server for direct connections,
 * but this relay provides:
 *   1. HTTP REST API for polling-based adapters
 *   2. Persistent task queue (survives MCP restarts)
 *   3. Redis pub/sub fan-out
 *   4. Health dashboard endpoint
 */

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { createServer } from "http";

const PORT    = parseInt(process.env.RELAY_PORT    || "18801");
const WS_PORT = parseInt(process.env.RELAY_WS_PORT || "18800");
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const taskQueue = [];       // pending tasks
const results   = [];       // completed results
const agents    = new Map(); // agentId -> { ws?, lastSeen, status }
const MAX_QUEUE = 500;

// ---------------------------------------------------------------------------
// Redis (optional)
// ---------------------------------------------------------------------------
let redisPub = null;
let redisSub = null;

try {
  redisPub = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, retryStrategy: (times) => times > 3 ? null : 1000 });
  redisSub = redisPub.duplicate();
  redisSub.subscribe("orchestrator:tasks", "orchestrator:inbox");
  redisSub.on("message", (channel, msg) => {
    if (channel === "orchestrator:tasks") {
      try {
        const task = JSON.parse(msg);
        taskQueue.push({ ...task, queuedAt: new Date().toISOString() });
        if (taskQueue.length > MAX_QUEUE) taskQueue.shift();
        broadcastWs({ type: "new_task", payload: task });
      } catch {}
    }
  });
  redisPub.on("error", () => { redisPub = null; });
} catch {
  console.log("[relay] Redis not available — running in standalone mode");
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });

wss.on("connection", (ws, req) => {
  const agentId = req.headers["x-agent-id"] || new URL(`ws://x${req.url}`).searchParams.get("id") || `anon-${Date.now()}`;
  agents.set(agentId, { ws, lastSeen: Date.now(), status: "connected" });
  console.log(`[ws] +${agentId} (total: ${agents.size})`);

  // Send pending tasks for this agent
  const pending = taskQueue.filter(t => !t.claimed && (!t.target || t.target === agentId || t.target === "all"));
  if (pending.length) ws.send(JSON.stringify({ type: "pending_tasks", tasks: pending }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      agents.get(agentId).lastSeen = Date.now();

      if (msg.type === "result") {
        results.push({ from: agentId, ...msg, completedAt: new Date().toISOString() });
        if (results.length > MAX_QUEUE) results.shift();
        if (redisPub) redisPub.publish("orchestrator:inbox", JSON.stringify({ from: agentId, ...msg }));
      }
      if (msg.type === "heartbeat") {
        agents.get(agentId).status = msg.status || "alive";
      }
      if (msg.type === "claim") {
        const task = taskQueue.find(t => t.id === msg.taskId);
        if (task) task.claimed = agentId;
      }
    } catch {}
  });

  ws.on("close", () => {
    const a = agents.get(agentId);
    if (a) a.status = "disconnected";
    console.log(`[ws] -${agentId}`);
  });
});

function broadcastWs(msg) {
  const raw = JSON.stringify(msg);
  for (const [, { ws }] of agents) {
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(raw); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Health / dashboard
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agents: Object.fromEntries([...agents].map(([id, a]) => [id, { status: a.status, lastSeen: new Date(a.lastSeen).toISOString() }])),
    queue: taskQueue.length,
    results: results.length,
    redis: !!redisPub,
  });
});

// Submit a task (from Tampermonkey or any HTTP client)
app.post("/tasks", (req, res) => {
  const { target, message, agent_id } = req.body;
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    target: target || "all",
    message,
    agent_id,
    createdAt: new Date().toISOString(),
    claimed: null,
  };
  taskQueue.push(task);
  if (taskQueue.length > MAX_QUEUE) taskQueue.shift();
  broadcastWs({ type: "new_task", payload: task });
  if (redisPub) redisPub.publish("orchestrator:tasks", JSON.stringify(task));
  res.json({ ok: true, task });
});

// Poll tasks (for agents that can't do WebSocket)
app.get("/tasks", (req, res) => {
  const agentId = req.query.agent;
  const pending = taskQueue.filter(t =>
    !t.claimed && (!t.target || t.target === agentId || t.target === "all")
  );
  res.json({ tasks: pending });
});

// Submit result
app.post("/results", (req, res) => {
  const { taskId, from, data } = req.body;
  const result = { taskId, from, data, completedAt: new Date().toISOString() };
  results.push(result);
  if (results.length > MAX_QUEUE) results.shift();
  // Mark task claimed/done
  const task = taskQueue.find(t => t.id === taskId);
  if (task) task.claimed = from || "http";
  if (redisPub) redisPub.publish("orchestrator:inbox", JSON.stringify(result));
  res.json({ ok: true });
});

// Read results
app.get("/results", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ results: results.slice(-limit) });
});

// List agents
app.get("/agents", (_req, res) => {
  const list = [...agents].map(([id, a]) => ({
    id,
    status: a.status,
    lastSeen: new Date(a.lastSeen).toISOString(),
    connected: a.ws?.readyState === WebSocket.OPEN,
  }));
  res.json({ agents: list });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n[orchestrator-relay]`);
  console.log(`  HTTP API: http://0.0.0.0:${PORT}`);
  console.log(`  WebSocket: ws://0.0.0.0:${WS_PORT}`);
  console.log(`  Redis: ${redisPub ? "connected" : "standalone"}\n`);
});
