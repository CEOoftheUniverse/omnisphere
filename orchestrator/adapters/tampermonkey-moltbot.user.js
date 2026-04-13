// ==UserScript==
// @name         Orchestrator MoltBot Adapter
// @namespace    https://omnisphere.local
// @version      1.0.0
// @description  Bridges Claude Desktop/Code orchestrator to MoltBot Cloud UI via WebSocket relay
// @author       Omnisphere
// @match        *://ceooftheuniverse.github.io/moltbot-saas/*
// @match        *://localhost:3000/*
// @match        *://127.0.0.1:3000/*
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const RELAY_WS = "ws://127.0.0.1:18800";
  const RELAY_HTTP = "http://127.0.0.1:18801";
  const AGENT_ID = "chrome-moltbot";
  const RECONNECT_MS = 5000;
  const HEARTBEAT_MS = 30000;

  let ws = null;
  let heartbeatTimer = null;

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------
  const badge = document.createElement("div");
  badge.id = "orchestrator-badge";
  badge.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 99999;
    background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 8px; padding: 8px 14px; font-family: monospace;
    font-size: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.4);
    display: flex; align-items: center; gap: 8px;
  `;
  badge.innerHTML = `<span id="orch-dot" style="width:8px;height:8px;border-radius:50%;background:#f38ba8;display:inline-block"></span> Orchestrator: connecting...`;
  document.body.appendChild(badge);

  function setStatus(text, color) {
    document.getElementById("orch-dot").style.background = color;
    badge.querySelector("span:last-child")?.remove();
    const s = document.createElement("span");
    s.textContent = `Orchestrator: ${text}`;
    badge.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection
  // ---------------------------------------------------------------------------
  function connect() {
    try {
      ws = new WebSocket(`${RELAY_WS}?id=${AGENT_ID}`);
    } catch {
      setStatus("relay offline", "#f38ba8");
      setTimeout(connect, RECONNECT_MS);
      return;
    }

    ws.onopen = () => {
      setStatus("connected", "#a6e3a1");
      // Identify ourselves
      ws.send(JSON.stringify({ type: "heartbeat", status: "ready", agent: AGENT_ID }));
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "heartbeat", status: "alive" }));
        }
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      setStatus("disconnected", "#f38ba8");
      setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // ---------------------------------------------------------------------------
  // Handle incoming tasks from orchestrator
  // ---------------------------------------------------------------------------
  function handleMessage(msg) {
    if (msg.type === "new_task" && msg.payload) {
      handleTask(msg.payload);
    }
    if (msg.type === "task") {
      handleTask(msg);
    }
    if (msg.type === "pending_tasks" && msg.tasks) {
      msg.tasks.forEach(handleTask);
    }
  }

  function handleTask(task) {
    const message = task.message || task.payload?.message;
    if (!message) return;

    console.log(`[orchestrator] Received task: ${message}`);
    showNotification("Task received", message);

    // Auto-execute based on task type
    if (message.startsWith("deploy:")) {
      const plan = message.replace("deploy:", "").trim();
      executeDeploy(plan, task.id);
    } else if (message.startsWith("status")) {
      executeStatusCheck(task.id);
    } else {
      // Log to page and send ack
      logToPage(message);
      sendResult(task.id, { action: "logged", message });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function executeDeploy(plan, taskId) {
    const validPlans = ["base", "swarm", "enterprise"];
    if (!validPlans.includes(plan)) {
      sendResult(taskId, { error: `Invalid plan: ${plan}. Use: ${validPlans.join(", ")}` });
      return;
    }

    // Click the deploy button on the page
    const buttons = document.querySelectorAll(".deploy-btn, button");
    for (const btn of buttons) {
      if (btn.textContent.toLowerCase().includes(plan)) {
        btn.click();
        sendResult(taskId, { action: "deploy_clicked", plan });
        return;
      }
    }

    // Fallback: call API directly
    fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    })
      .then((r) => r.json())
      .then((data) => sendResult(taskId, { action: "deployed", data }))
      .catch((e) => sendResult(taskId, { error: e.message }));
  }

  function executeStatusCheck(taskId) {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => sendResult(taskId, { action: "status", data }))
      .catch((e) => sendResult(taskId, { error: e.message }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function sendResult(taskId, data) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "result", taskId, data }));
    }
    // Also claim via HTTP as backup
    GM_xmlhttpRequest({
      method: "POST",
      url: `${RELAY_HTTP}/results`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ taskId, from: AGENT_ID, data }),
    });
  }

  function showNotification(title, text) {
    try {
      GM_notification({ title, text, timeout: 5000 });
    } catch {}
  }

  function logToPage(message) {
    const container = document.getElementById("instances-container");
    if (!container) return;
    const div = document.createElement("div");
    div.style.cssText = "background:#1e1e2e;color:#cdd6f4;padding:8px 12px;margin:4px 0;border-radius:6px;font-family:monospace;font-size:12px;border-left:3px solid #89b4fa";
    div.textContent = `[orchestrator ${new Date().toLocaleTimeString()}] ${message}`;
    container.prepend(div);
  }

  // ---------------------------------------------------------------------------
  // Badge click: show quick menu
  // ---------------------------------------------------------------------------
  badge.addEventListener("click", () => {
    const action = prompt(
      "Orchestrator command:\n1. Check status\n2. Deploy base\n3. Deploy swarm\n4. Reconnect\n\nEnter number or free text:",
      "1"
    );
    if (!action) return;
    switch (action.trim()) {
      case "1": executeStatusCheck("manual"); break;
      case "2": executeDeploy("base", "manual"); break;
      case "3": executeDeploy("swarm", "manual"); break;
      case "4": ws?.close(); connect(); break;
      default:
        // Send as free-form message to orchestrator
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "result", data: { userMessage: action } }));
        }
    }
  });

  // Start
  connect();
})();
