import type { WSClientEvent, WSServerEvent } from "../types/shared.js";
import { WS_HEARTBEAT_INTERVAL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../types/shared.js";
import { getGatewayUrl } from "./serverUrl.js";
import { getStoredToken } from "./api.js";

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
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.shouldReconnect = true;
    let url = getGatewayUrl();
    // Attach token as query param for cross-origin auth (WebSocket can't send custom headers)
    const token = getStoredToken();
    if (token) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}token=${encodeURIComponent(token)}`;
    }
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = WS_RECONNECT_BASE_DELAY;
      this.startHeartbeat();
      for (const handler of this.connectHandlers) handler();
    };

    this.ws.onmessage = (e) => {
      try {
        const event: WSServerEvent = JSON.parse(e.data);
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  send(event: WSClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
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
