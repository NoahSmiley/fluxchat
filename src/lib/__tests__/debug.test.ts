import { describe, it, expect, vi, beforeEach } from "vitest";

describe("debug", () => {
  let dbg: typeof import("@/lib/debug.js").dbg;
  let dumpLogs: typeof import("@/lib/debug.js").dumpLogs;
  let getLogs: typeof import("@/lib/debug.js").getLogs;
  let setDebugEnabled: typeof import("@/lib/debug.js").setDebugEnabled;
  let getDebugEnabled: typeof import("@/lib/debug.js").getDebugEnabled;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    const mod = await import("@/lib/debug.js");
    dbg = mod.dbg;
    dumpLogs = mod.dumpLogs;
    getLogs = mod.getLogs;
    setDebugEnabled = mod.setDebugEnabled;
    getDebugEnabled = mod.getDebugEnabled;
  });

  it("dbg pushes entry to buffer", () => {
    dbg("test-scope", "test message");

    const logs = getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].scope).toBe("test-scope");
    expect(logs[0].msg).toBe("test message");
  });

  it("buffer respects MAX_LOG_ENTRIES of 2000", () => {
    for (let i = 0; i < 2001; i++) {
      dbg("scope", `msg-${i}`);
    }

    const logs = getLogs();
    expect(logs.length).toBe(2000);
    // The first entry should have been evicted
    expect(logs[0].msg).toBe("msg-1");
    expect(logs[logs.length - 1].msg).toBe("msg-2000");
  });

  it("dbg calls console.log when debug is enabled", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setDebugEnabled(true);
    // Clear the console.log calls from setDebugEnabled itself
    consoleSpy.mockClear();

    dbg("ws", "connected");

    expect(consoleSpy).toHaveBeenCalled();
    const args = consoleSpy.mock.calls[0];
    expect(args[0]).toContain("[ws]");
    expect(args[0]).toContain("connected");
    consoleSpy.mockRestore();
  });

  it("dbg does NOT call console.log when debug is disabled", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    dbg("ws", "connected");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("setDebugEnabled(true) persists to localStorage", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    setDebugEnabled(true);
    expect(localStorage.getItem("flux-debug")).toBe("true");
    vi.restoreAllMocks();
  });

  it("getDebugEnabled returns localStorage value", () => {
    expect(getDebugEnabled()).toBe(false);

    localStorage.setItem("flux-debug", "true");
    expect(getDebugEnabled()).toBe(true);

    localStorage.setItem("flux-debug", "false");
    expect(getDebugEnabled()).toBe(false);
  });

  it("dumpLogs formats entries as [ts] [scope] msg", () => {
    dbg("auth", "login success");

    const dump = dumpLogs();
    // Should contain the ISO timestamp, scope, and message
    expect(dump).toMatch(/\[.*\] \[auth\] login success/);
  });

  it("dumpLogs handles unserializable data with [unserializable]", () => {
    // Create a circular reference which cannot be serialized
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    dbg("test", "bad data", circular);

    const dump = dumpLogs();
    expect(dump).toContain("[unserializable]");
  });

  it("getLogs returns readonly array", () => {
    dbg("scope", "msg");
    const logs = getLogs();
    // The return type is readonly LogEntry[], verify it returns an array
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBe(1);
  });
});
