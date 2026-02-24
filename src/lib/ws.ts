import type { WSClientEvent, WSServerEvent } from "../types/shared.js";
import { WS_HEARTBEAT_INTERVAL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../types/shared.js";
import { getGatewayUrl } from "./serverUrl.js";
import { getStoredToken } from "./api/index.js";
import { dbg } from "./debug.js";

type EventHandler = (event: WSServerEvent) => void;

class FluxWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<EventHandler>();
  private connectHandlers = new Set<() => void>();
  private reconnectDelay = WS_RECONNECT_BASE_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      dbg("ws", `connect skipped — state=${this.ws?.readyState === WebSocket.OPEN ? "OPEN" : "CONNECTING"}`);
      return;
    }

    this.shouldReconnect = true;
    let url = getGatewayUrl();
    const token = getStoredToken();
    if (token) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}token=${encodeURIComponent(token)}`;
    }
    dbg("ws", `connect url=${url.replace(/token=[^&]+/, "token=***")}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // stale socket from StrictMode remount
      dbg("ws", "connected");
      this.reconnectDelay = WS_RECONNECT_BASE_DELAY;
      this.startHeartbeat();
      for (const handler of this.connectHandlers) handler();
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      try {
        const event: WSServerEvent = JSON.parse(e.data);
        dbg("ws", `recv ${event.type}`, event);
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        dbg("ws", "recv malformed message", e.data?.toString?.()?.slice(0, 200));
      }
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return; // stale socket — a newer connect() already replaced us
      dbg("ws", `closed code=${e.code} reason=${e.reason} clean=${e.wasClean}`);
      this.stopHeartbeat();
      if (this.shouldReconnect) {
        dbg("ws", `scheduling reconnect in ${this.reconnectDelay}ms`);
        this.scheduleReconnect();
      }
    };

    ws.onerror = (e) => {
      if (this.ws !== ws) return; // stale socket — don't close the new one
      dbg("ws", "error", e);
      ws.close();
    };
  }

  disconnect() {
    dbg("ws", "disconnect called");
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  send(event: WSClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Log sends except pings
      if (event.type !== "ping") {
        dbg("ws", `send ${event.type}`, event);
      }
      this.ws.send(JSON.stringify(event));
    } else {
      dbg("ws", `send DROPPED (not open) ${event.type}`, { readyState: this.ws?.readyState });
    }
  }

  on(handler: EventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onConnect(handler: () => void) {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      dbg("ws", "reconnecting...");
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, WS_RECONNECT_MAX_DELAY);
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, WS_HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const gateway = new FluxWebSocket();
