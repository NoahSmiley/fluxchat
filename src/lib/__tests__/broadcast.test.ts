import { describe, it, expect, vi, beforeEach } from "vitest";

let mockChannels: any[] = [];

class MockBroadcastChannel {
  name: string;
  onmessage: ((e: any) => void) | null = null;
  constructor(name: string) {
    this.name = name;
    mockChannels.push(this);
  }
  postMessage = vi.fn();
  close = vi.fn();
}

vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

// Mock window.location for popout detection tests
const originalLocation = window.location;

import {
  broadcastState,
  onStateUpdate,
  sendCommand,
  onCommand,
  getPopoutType,
  isPopout,
} from "../broadcast.js";

describe("broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannels = [];
    // Restore default location
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search: "", protocol: "https:", host: "localhost" },
      writable: true,
      configurable: true,
    });
  });

  it("broadcastState creates channel and posts message", () => {
    const message = {
      type: "chat-state" as const,
      messages: [],
      activeChannelId: "ch1",
      channelName: "general",
    };

    broadcastState(message);

    expect(mockChannels.length).toBe(1);
    expect(mockChannels[0].name).toBe("flux-state");
    expect(mockChannels[0].postMessage).toHaveBeenCalledWith(message);
    expect(mockChannels[0].close).toHaveBeenCalled();
  });

  it("broadcastState handles missing BroadcastChannel gracefully", () => {
    const saved = globalThis.BroadcastChannel;
    // Override to throw
    vi.stubGlobal("BroadcastChannel", class {
      constructor() { throw new Error("Not supported"); }
    });

    // Should not throw
    expect(() => {
      broadcastState({
        type: "chat-state",
        messages: [],
        activeChannelId: null,
        channelName: null,
      });
    }).not.toThrow();

    // Restore
    vi.stubGlobal("BroadcastChannel", saved);
  });

  it("onStateUpdate receives messages and returns cleanup", () => {
    const callback = vi.fn();

    const cleanup = onStateUpdate(callback);

    expect(mockChannels.length).toBe(1);
    expect(mockChannels[0].name).toBe("flux-state");

    // Simulate a message
    const messageData = {
      type: "chat-state",
      messages: [],
      activeChannelId: "ch1",
      channelName: "general",
    };
    mockChannels[0].onmessage!({ data: messageData });
    expect(callback).toHaveBeenCalledWith(messageData);

    // Cleanup closes the channel
    cleanup();
    expect(mockChannels[0].close).toHaveBeenCalled();
  });

  it("sendCommand creates command channel and posts", () => {
    const command = { type: "send-message" as const, content: "hello" };

    sendCommand(command);

    expect(mockChannels.length).toBe(1);
    expect(mockChannels[0].name).toBe("flux-commands");
    expect(mockChannels[0].postMessage).toHaveBeenCalledWith(command);
    expect(mockChannels[0].close).toHaveBeenCalled();
  });

  it("onCommand receives commands", () => {
    const callback = vi.fn();

    const cleanup = onCommand(callback);

    expect(mockChannels.length).toBe(1);
    expect(mockChannels[0].name).toBe("flux-commands");

    const commandData = { type: "request-state" };
    mockChannels[0].onmessage!({ data: commandData });
    expect(callback).toHaveBeenCalledWith(commandData);

    cleanup();
    expect(mockChannels[0].close).toHaveBeenCalled();
  });

  it("getPopoutType returns 'chat' for ?popout=chat", () => {
    Object.defineProperty(window, "location", {
      value: { search: "?popout=chat", protocol: "https:", host: "localhost" },
      writable: true,
      configurable: true,
    });

    expect(getPopoutType()).toBe("chat");
  });

  it("getPopoutType returns null for no popout param", () => {
    Object.defineProperty(window, "location", {
      value: { search: "", protocol: "https:", host: "localhost" },
      writable: true,
      configurable: true,
    });

    expect(getPopoutType()).toBeNull();
  });

  it("isPopout returns true when popout param exists", () => {
    Object.defineProperty(window, "location", {
      value: { search: "?popout=screenshare", protocol: "https:", host: "localhost" },
      writable: true,
      configurable: true,
    });

    expect(isPopout()).toBe(true);
  });
});
