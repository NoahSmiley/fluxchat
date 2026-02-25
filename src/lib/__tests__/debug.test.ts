import { describe, it, expect, vi, beforeEach } from "vitest";

describe("debug", () => {
  let dbg: typeof import("@/lib/debug.js").dbg;
  let dumpLogs: typeof import("@/lib/debug.js").dumpLogs;
  let setDebugEnabled: typeof import("@/lib/debug.js").setDebugEnabled;
  let getDebugEnabled: typeof import("@/lib/debug.js").getDebugEnabled;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    const mod = await import("@/lib/debug.js");
    dbg = mod.dbg;
    dumpLogs = mod.dumpLogs;
    setDebugEnabled = mod.setDebugEnabled;
    getDebugEnabled = mod.getDebugEnabled;
  });

  it("dbg pushes entry to buffer", () => {
    dbg("test-scope", "test message");

    const dump = dumpLogs();
    expect(dump).toContain("[test-scope]");
    expect(dump).toContain("test message");
  });

  it("buffer respects MAX_LOG_ENTRIES of 2000", () => {
    for (let i = 0; i < 2001; i++) {
      dbg("scope", `msg-${i}`);
    }

    const dump = dumpLogs();
    const lines = dump.split("\n");
    expect(lines.length).toBe(2000);
    // The first entry should have been evicted
    expect(lines[0]).toContain("msg-1");
    expect(lines[lines.length - 1]).toContain("msg-2000");
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
});
