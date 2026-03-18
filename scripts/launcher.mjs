#!/usr/bin/env node
/**
 * Flux Dev Launcher — starts LiveKit, Backend, and Tauri dev servers
 * with a web dashboard for logs, analytics, and controls.
 *
 * Usage: node scripts/launcher.mjs
 * Dashboard: http://localhost:9000
 */

import { spawn } from "child_process";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { networkInterfaces } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Service definitions ──

const SERVICES = [
  {
    id: "livekit",
    name: "LiveKit",
    cmd: path.join(ROOT, "livekit-server", "livekit-server.exe"),
    args: ["--config", path.join(ROOT, "livekit-server", "livekit.yaml")],
    cwd: ROOT,
    port: 7880,
    color: "#a855f7",
  },
  {
    id: "backend",
    name: "Backend (Rust)",
    cmd: "cargo",
    args: ["run", "-p", "flux-server"],
    cwd: ROOT,
    port: 3001,
    color: "#f59e0b",
    shell: true,
  },
  {
    id: "tauri",
    name: "Tauri Dev",
    cmd: "npx",
    args: ["tauri", "dev"],
    cwd: ROOT,
    port: 1420,
    color: "#22c55e",
    shell: true,
  },
];

// ── State ──

const state = new Map();
const LOG_LIMIT = 2000; // max lines per service

for (const svc of SERVICES) {
  state.set(svc.id, {
    ...svc,
    status: "stopped",    // stopped | starting | running | crashed
    pid: null,
    proc: null,
    logs: [],
    startedAt: null,
    restarts: 0,
    exitCode: null,
  });
}

// ── WebSocket broadcast ──

const wsClients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function addLog(id, stream, text) {
  const entry = state.get(id);
  if (!entry) return;
  const lines = text.split("\n").filter((l) => l.length > 0);
  for (const line of lines) {
    const log = { ts: Date.now(), stream, text: line };
    entry.logs.push(log);
    if (entry.logs.length > LOG_LIMIT) entry.logs.shift();
    broadcast({ type: "log", id, ...log });
  }
}

function broadcastStatus(id) {
  const e = state.get(id);
  broadcast({
    type: "status",
    id,
    status: e.status,
    pid: e.pid,
    startedAt: e.startedAt,
    restarts: e.restarts,
    exitCode: e.exitCode,
  });
}

// ── Process management ──

function startService(id) {
  const entry = state.get(id);
  if (!entry || entry.status === "running" || entry.status === "starting") return;

  entry.status = "starting";
  entry.exitCode = null;
  broadcastStatus(id);

  const isWin = process.platform === "win32";
  const proc = spawn(entry.cmd, entry.args, {
    cwd: entry.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: entry.shell || false,
    env: { ...process.env, FORCE_COLOR: "0" },
    ...(isWin ? { windowsHide: true } : {}),
  });

  entry.proc = proc;
  entry.pid = proc.pid;
  entry.startedAt = Date.now();
  entry.status = "running";
  broadcastStatus(id);

  addLog(id, "system", `Process started (PID ${proc.pid})`);

  proc.stdout.on("data", (buf) => addLog(id, "stdout", buf.toString()));
  proc.stderr.on("data", (buf) => addLog(id, "stderr", buf.toString()));

  proc.on("error", (err) => {
    entry.status = "crashed";
    entry.exitCode = -1;
    addLog(id, "system", `Error: ${err.message}`);
    broadcastStatus(id);
  });

  proc.on("close", (code) => {
    entry.status = code === 0 ? "stopped" : "crashed";
    entry.exitCode = code;
    entry.proc = null;
    entry.pid = null;
    addLog(id, "system", `Process exited with code ${code}`);
    broadcastStatus(id);
  });
}

function stopService(id) {
  const entry = state.get(id);
  if (!entry || !entry.proc) return;
  addLog(id, "system", "Stopping...");
  entry.status = "stopped";

  const isWin = process.platform === "win32";
  if (isWin) {
    // On Windows, kill the process tree
    spawn("taskkill", ["/pid", String(entry.proc.pid), "/f", "/t"], { stdio: "ignore" });
  } else {
    entry.proc.kill("SIGTERM");
  }
  broadcastStatus(id);
}

function restartService(id) {
  const entry = state.get(id);
  if (!entry) return;
  entry.restarts++;
  stopService(id);
  setTimeout(() => startService(id), 1500);
}

// ── Port health check ──

async function checkPort(port) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal }).catch(() => {});
    clearTimeout(timeout);
    // If we got here without aborting, port is responding
    return true;
  } catch {
    return false;
  }
}

async function getHealthData() {
  const results = {};
  for (const svc of SERVICES) {
    const entry = state.get(svc.id);
    results[svc.id] = {
      status: entry.status,
      pid: entry.pid,
      startedAt: entry.startedAt,
      restarts: entry.restarts,
      exitCode: entry.exitCode,
      port: svc.port,
      portAlive: entry.status === "running" ? await checkPort(svc.port) : false,
    };
  }
  return results;
}

// Health broadcast every 5s
setInterval(async () => {
  const health = await getHealthData();
  broadcast({ type: "health", data: health });
}, 5000);

// ── HTTP server + WebSocket ──

const DASHBOARD_PORT = 9000;

const server = createServer(async (req, res) => {
  if (req.url === "/api/health") {
    const health = await getHealthData();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }

  if (req.url === "/api/start" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body);
      startService(id);
      res.writeHead(200);
      res.end("ok");
    });
    return;
  }

  if (req.url === "/api/stop" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body);
      stopService(id);
      res.writeHead(200);
      res.end("ok");
    });
    return;
  }

  if (req.url === "/api/restart" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id } = JSON.parse(body);
      restartService(id);
      res.writeHead(200);
      res.end("ok");
    });
    return;
  }

  if (req.url === "/api/start-all" && req.method === "POST") {
    for (const svc of SERVICES) startService(svc.id);
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.url === "/api/stop-all" && req.method === "POST") {
    for (const svc of SERVICES) stopService(svc.id);
    res.writeHead(200);
    res.end("ok");
    return;
  }

  // Serve dashboard
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(DASHBOARD_HTML);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  wsClients.add(ws);

  // Send current state
  for (const [id, entry] of state) {
    ws.send(JSON.stringify({
      type: "status",
      id,
      status: entry.status,
      pid: entry.pid,
      startedAt: entry.startedAt,
      restarts: entry.restarts,
      exitCode: entry.exitCode,
    }));
    // Send recent logs
    for (const log of entry.logs.slice(-200)) {
      ws.send(JSON.stringify({ type: "log", id, ...log }));
    }
  }

  ws.on("close", () => wsClients.delete(ws));
});

server.listen(DASHBOARD_PORT, () => {
  console.log(`\n  ⚡ Flux Launcher Dashboard`);
  console.log(`  ─────────────────────────`);
  console.log(`  Dashboard:  http://localhost:${DASHBOARD_PORT}`);
  console.log(`  Services:   ${SERVICES.map((s) => s.name).join(", ")}`);
  console.log(`\n  Starting all services...\n`);

  // Auto-start all services
  for (const svc of SERVICES) {
    startService(svc.id);
  }
});

// Graceful shutdown
function shutdown() {
  console.log("\n  Shutting down all services...");
  for (const svc of SERVICES) stopService(svc.id);
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Dashboard HTML ──

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Flux Launcher</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #0c0c10;
    --bg-card: #14141c;
    --bg-raised: #1a1a26;
    --border: #2a2a3a;
    --text: #e0e0ec;
    --text-dim: #6a6a80;
    --purple: #a855f7;
    --amber: #f59e0b;
    --green: #22c55e;
    --red: #ef4444;
    --blue: #3b82f6;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 28px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .logo {
    font-size: 20px;
    font-weight: 900;
    background: linear-gradient(135deg, var(--purple), var(--blue));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -0.02em;
  }

  .logo-sub {
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 500;
    background: var(--bg-raised);
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 8px 18px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn:hover { border-color: var(--purple); color: #fff; }

  .btn-start { border-color: rgba(34, 197, 94, 0.3); color: var(--green); }
  .btn-start:hover { background: rgba(34, 197, 94, 0.1); border-color: var(--green); }

  .btn-stop { border-color: rgba(239, 68, 68, 0.3); color: var(--red); }
  .btn-stop:hover { background: rgba(239, 68, 68, 0.1); border-color: var(--red); }

  .btn-restart { border-color: rgba(245, 158, 11, 0.3); color: var(--amber); }
  .btn-restart:hover { background: rgba(245, 158, 11, 0.1); border-color: var(--amber); }

  /* ── Main layout ── */
  .main {
    display: flex;
    height: calc(100vh - 57px);
  }

  /* ── Service cards sidebar ── */
  .sidebar {
    width: 320px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sidebar-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    padding: 0 4px 8px;
  }

  .svc-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.15s;
    position: relative;
    overflow: hidden;
  }

  .svc-card:hover { border-color: rgba(168, 85, 247, 0.3); }
  .svc-card.active { border-color: var(--purple); background: var(--bg-raised); }

  .svc-card-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .svc-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .svc-dot.running { background: var(--green); box-shadow: 0 0 8px rgba(34, 197, 94, 0.5); }
  .svc-dot.starting { background: var(--amber); box-shadow: 0 0 8px rgba(245, 158, 11, 0.5); animation: pulse 1s infinite; }
  .svc-dot.stopped { background: var(--text-dim); }
  .svc-dot.crashed { background: var(--red); box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }

  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .svc-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    flex: 1;
  }

  .svc-status-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .svc-status-label.running { color: var(--green); background: rgba(34, 197, 94, 0.1); }
  .svc-status-label.starting { color: var(--amber); background: rgba(245, 158, 11, 0.1); }
  .svc-status-label.stopped { color: var(--text-dim); background: rgba(106, 106, 128, 0.1); }
  .svc-status-label.crashed { color: var(--red); background: rgba(239, 68, 68, 0.1); }

  .svc-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .svc-meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .svc-meta-val {
    font-family: "SF Mono", "Fira Code", monospace;
    color: var(--text);
    font-weight: 500;
  }

  .svc-actions {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .svc-btn {
    flex: 1;
    padding: 6px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    transition: all 0.12s;
    color: var(--text-dim);
  }

  .svc-btn:hover { color: var(--text); border-color: var(--purple); }
  .svc-btn.start { color: var(--green); }
  .svc-btn.start:hover { background: rgba(34, 197, 94, 0.08); border-color: var(--green); }
  .svc-btn.stop { color: var(--red); }
  .svc-btn.stop:hover { background: rgba(239, 68, 68, 0.08); border-color: var(--red); }
  .svc-btn.restart { color: var(--amber); }
  .svc-btn.restart:hover { background: rgba(245, 158, 11, 0.08); border-color: var(--amber); }

  /* Port health indicator */
  .port-health {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .port-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
  }

  .port-dot.alive { background: var(--green); }

  /* ── Log panel ── */
  .log-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-card);
  }

  .log-tabs {
    display: flex;
    gap: 2px;
  }

  .log-tab {
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    transition: all 0.12s;
  }

  .log-tab:hover { color: var(--text); }
  .log-tab.active { color: var(--text); background: var(--bg-raised); border-color: var(--border); }

  .log-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .log-actions label {
    font-size: 11px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  .log-clear {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }

  .log-clear:hover { color: var(--text); border-color: var(--purple); }

  .log-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    background: var(--bg);
  }

  .log-line {
    padding: 1px 20px;
    display: flex;
    gap: 10px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-line:hover { background: rgba(168, 85, 247, 0.03); }

  .log-ts {
    color: var(--text-dim);
    flex-shrink: 0;
    font-size: 10px;
    padding-top: 1px;
    user-select: none;
  }

  .log-text { flex: 1; min-width: 0; }
  .log-text.stderr { color: var(--red); opacity: 0.85; }
  .log-text.system { color: var(--purple); font-style: italic; }

  .log-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-dim);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
  }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a3a4a; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <span class="logo">FLUX LAUNCHER</span>
    <span class="logo-sub">Dev Environment</span>
  </div>
  <div class="header-actions">
    <button class="btn btn-start" onclick="api('start-all')">Start All</button>
    <button class="btn btn-stop" onclick="api('stop-all')">Stop All</button>
  </div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="sidebar-title">Services</div>
    <div id="cards"></div>
  </div>
  <div class="log-panel">
    <div class="log-header">
      <div class="log-tabs" id="logTabs"></div>
      <div class="log-actions">
        <label><input type="checkbox" id="autoScroll" checked /> Auto-scroll</label>
        <button class="log-clear" onclick="clearLogs()">Clear</button>
      </div>
    </div>
    <div class="log-container" id="logContainer"></div>
  </div>
</div>

<script>
const SERVICES = ${JSON.stringify(SERVICES.map(({ id, name, port, color }) => ({ id, name, port, color })))};
const state = {};
const logs = {};
let activeTab = "all";
let autoScroll = true;

for (const svc of SERVICES) {
  state[svc.id] = { status: "stopped", pid: null, startedAt: null, restarts: 0, exitCode: null, portAlive: false };
  logs[svc.id] = [];
}

// ── API helper ──
function api(action, id) {
  const body = id ? JSON.stringify({ id }) : "{}";
  fetch("/api/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body });
}

// ── Render service cards ──
function renderCards() {
  const el = document.getElementById("cards");
  el.innerHTML = SERVICES.map(svc => {
    const s = state[svc.id];
    const uptime = s.startedAt && s.status === "running" ? formatUptime(Date.now() - s.startedAt) : "--";
    return \`
    <div class="svc-card \${activeTab === svc.id ? 'active' : ''}" onclick="setTab('\${svc.id}')">
      <div class="svc-card-top">
        <div class="svc-dot \${s.status}"></div>
        <span class="svc-name">\${svc.name}</span>
        <span class="svc-status-label \${s.status}">\${s.status}</span>
      </div>
      <div class="svc-meta">
        <div class="svc-meta-item">Port <span class="port-health"><span class="port-dot \${s.portAlive ? 'alive' : ''}"></span><span class="svc-meta-val">\${svc.port}</span></span></div>
        <div class="svc-meta-item">PID <span class="svc-meta-val">\${s.pid || '--'}</span></div>
        <div class="svc-meta-item">Uptime <span class="svc-meta-val">\${uptime}</span></div>
      </div>
      <div class="svc-actions">
        <button class="svc-btn start" onclick="event.stopPropagation(); api('start', '\${svc.id}')">Start</button>
        <button class="svc-btn stop" onclick="event.stopPropagation(); api('stop', '\${svc.id}')">Stop</button>
        <button class="svc-btn restart" onclick="event.stopPropagation(); api('restart', '\${svc.id}')">Restart</button>
      </div>
    </div>\`;
  }).join("");
}

function renderTabs() {
  const el = document.getElementById("logTabs");
  const tabs = [{ id: "all", name: "All", color: "#a855f7" }, ...SERVICES];
  el.innerHTML = tabs.map(t =>
    \`<button class="log-tab \${activeTab === t.id ? 'active' : ''}" style="\${activeTab === t.id ? 'border-color:'+t.color : ''}" onclick="setTab('\${t.id}')">\${t.name}</button>\`
  ).join("");
}

function setTab(id) {
  activeTab = id;
  renderTabs();
  renderCards();
  renderLogs();
}

// ── Render logs ──
function renderLogs() {
  const el = document.getElementById("logContainer");
  const entries = activeTab === "all"
    ? SERVICES.flatMap(svc => logs[svc.id].map(l => ({ ...l, svc: svc.id, color: svc.color }))).sort((a, b) => a.ts - b.ts)
    : logs[activeTab]?.map(l => ({ ...l, svc: activeTab, color: SERVICES.find(s => s.id === activeTab)?.color })) || [];

  const last500 = entries.slice(-500);

  if (last500.length === 0) {
    el.innerHTML = '<div class="log-empty">No logs yet. Services will output here.</div>';
    return;
  }

  el.innerHTML = last500.map(l => {
    const time = new Date(l.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const prefix = activeTab === "all" ? \`<span style="color:\${l.color};font-weight:600;width:65px;flex-shrink:0;font-size:10px;text-transform:uppercase">\${l.svc}</span>\` : "";
    return \`<div class="log-line">\${prefix}<span class="log-ts">\${time}</span><span class="log-text \${l.stream}">\${escapeHtml(l.text)}</span></div>\`;
  }).join("");

  if (autoScroll) el.scrollTop = el.scrollHeight;
}

function appendLog(id, log) {
  if (!logs[id]) logs[id] = [];
  logs[id].push(log);
  if (logs[id].length > 2000) logs[id].shift();

  if (activeTab === "all" || activeTab === id) {
    const el = document.getElementById("logContainer");
    if (el.querySelector(".log-empty")) el.innerHTML = "";

    const svc = SERVICES.find(s => s.id === id);
    const time = new Date(log.ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const prefix = activeTab === "all" ? \`<span style="color:\${svc.color};font-weight:600;width:65px;flex-shrink:0;font-size:10px;text-transform:uppercase">\${id}</span>\` : "";
    el.insertAdjacentHTML("beforeend", \`<div class="log-line">\${prefix}<span class="log-ts">\${time}</span><span class="log-text \${log.stream}">\${escapeHtml(log.text)}</span></div>\`);

    // Trim DOM
    while (el.children.length > 500) el.removeChild(el.firstChild);

    if (document.getElementById("autoScroll").checked) {
      el.scrollTop = el.scrollHeight;
    }
  }
}

function clearLogs() {
  if (activeTab === "all") {
    for (const svc of SERVICES) logs[svc.id] = [];
  } else {
    logs[activeTab] = [];
  }
  renderLogs();
}

// ── Helpers ──
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── WebSocket ──
function connect() {
  const ws = new WebSocket("ws://" + location.host);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === "status") {
      state[msg.id] = { ...state[msg.id], ...msg };
      renderCards();
    }

    if (msg.type === "log") {
      appendLog(msg.id, { ts: msg.ts, stream: msg.stream, text: msg.text });
    }

    if (msg.type === "health") {
      for (const [id, data] of Object.entries(msg.data)) {
        state[id] = { ...state[id], ...data };
      }
      renderCards();
    }
  };

  ws.onclose = () => setTimeout(connect, 2000);
}

// Uptime ticker
setInterval(renderCards, 1000);

// Init
renderCards();
renderTabs();
renderLogs();
connect();

document.getElementById("autoScroll").addEventListener("change", (e) => {
  autoScroll = e.target.checked;
});
</script>
</body>
</html>`;
