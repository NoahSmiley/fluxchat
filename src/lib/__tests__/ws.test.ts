import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing ws module
vi.mock("../serverUrl.js", () => ({
  getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
}));

vi.mock("../api.js", () => ({
  getStoredToken: vi.fn(() => null),
}));

vi.mock("../debug.js", () => ({
  dbg: vi.fn(),
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: 1000, reason: "", wasClean: true });
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  simulateMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason, wasClean: code === 1000 });
  }

  simulateError() {
    if (this.onerror) this.onerror({});
  }
}

// Store created WebSocket instances
let wsInstances: MockWebSocket[] = [];

vi.stubGlobal("WebSocket", class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    wsInstances.push(this);
  }
});

// Also set static properties on the global
(globalThis as any).WebSocket.CONNECTING = 0;
(globalThis as any).WebSocket.OPEN = 1;
(globalThis as any).WebSocket.CLOSING = 2;
(globalThis as any).WebSocket.CLOSED = 3;

// Now import the gateway (after mocks are set up)
// Need to use dynamic import to ensure mocks are in place
let gateway: any;

describe("FluxWebSocket (gateway)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    wsInstances = [];
    // Re-import fresh module for each test
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock("../serverUrl.js", () => ({
      getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
    }));
    vi.doMock("../api.js", () => ({
      getStoredToken: vi.fn(() => null),
    }));
    vi.doMock("../debug.js", () => ({
      dbg: vi.fn(),
    }));

    const mod = await import("../ws.js");
    gateway = mod.gateway;
  });

  afterEach(() => {
    gateway.disconnect();
    vi.useRealTimers();
  });

  it("connect creates WebSocket with correct URL", () => {
    gateway.connect();

    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toBe("ws://localhost:3001/gateway");
  });

  it("send dispatches JSON when connected", () => {
    gateway.connect();
    wsInstances[0].simulateOpen();

    gateway.send({ type: "ping" });

    expect(wsInstances[0].sent).toHaveLength(1);
    expect(JSON.parse(wsInstances[0].sent[0])).toEqual({ type: "ping" });
  });

  it("send drops messages when not connected", () => {
    // Don't connect — no WebSocket created
    gateway.send({ type: "ping" });

    expect(wsInstances).toHaveLength(0);
  });

  it("onmessage dispatches to registered handlers", () => {
    const handler = vi.fn();
    gateway.on(handler);
    gateway.connect();
    wsInstances[0].simulateOpen();

    wsInstances[0].simulateMessage({ type: "presence", userId: "u1", status: "online" });

    expect(handler).toHaveBeenCalledWith({ type: "presence", userId: "u1", status: "online" });
  });

  it("disconnect stops reconnection", () => {
    gateway.connect();
    wsInstances[0].simulateOpen();

    gateway.disconnect();

    // Should not attempt to reconnect
    vi.advanceTimersByTime(60_000);
    expect(wsInstances).toHaveLength(1); // Only the original
  });

  it("on() returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = gateway.on(handler);
    gateway.connect();
    wsInstances[0].simulateOpen();

    // Handler receives message
    wsInstances[0].simulateMessage({ type: "ping" });
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsub();

    // Handler no longer receives messages
    wsInstances[0].simulateMessage({ type: "ping" });
    expect(handler).toHaveBeenCalledTimes(1); // Still 1
  });

  it("onConnect fires handler on connection", () => {
    const handler = vi.fn();
    gateway.onConnect(handler);
    gateway.connect();

    expect(handler).not.toHaveBeenCalled();

    wsInstances[0].simulateOpen();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
