import { describe, it, expect, vi, beforeEach } from "vitest";

describe("serverUrl", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.resetModules();
    // Clean up any VITE_SERVER_URL set by previous tests
    delete (import.meta.env as any).VITE_SERVER_URL;
    // Reset DEV to true (default in test)
    import.meta.env.DEV = true;
    // Restore default window.location
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", host: "example.com", search: "" },
      writable: true,
      configurable: true,
    });
  });

  it("API_BASE defaults to /api when VITE_SERVER_URL is unset", async () => {
    const mod = await import("../serverUrl.js");
    expect(mod.API_BASE).toBe("/api");
  });

  it("API_BASE uses VITE_SERVER_URL when set", async () => {
    (import.meta.env as any).VITE_SERVER_URL = "http://1.2.3.4:3001";
    const mod = await import("../serverUrl.js");
    expect(mod.API_BASE).toBe("http://1.2.3.4:3001/api");
  });

  it("API_BASE strips trailing slashes from VITE_SERVER_URL", async () => {
    (import.meta.env as any).VITE_SERVER_URL = "http://1.2.3.4:3001///";
    const mod = await import("../serverUrl.js");
    expect(mod.API_BASE).toBe("http://1.2.3.4:3001/api");
  });

  it("getGatewayUrl returns dev URL in dev mode", async () => {
    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("ws://127.0.0.1:3001/gateway");
  });

  it("getGatewayUrl uses VITE_SERVER_URL when set", async () => {
    (import.meta.env as any).VITE_SERVER_URL = "http://1.2.3.4:3001";
    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("ws://1.2.3.4:3001/gateway");
  });

  it("getGatewayUrl uses wss: for https: SERVER_URL", async () => {
    (import.meta.env as any).VITE_SERVER_URL = "https://my-server.com";
    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("wss://my-server.com/gateway");
  });

  it("getGatewayUrl uses ws: for http: SERVER_URL", async () => {
    (import.meta.env as any).VITE_SERVER_URL = "http://my-server.com";
    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("ws://my-server.com/gateway");
  });

  it("getGatewayUrl derives from window.location in prod mode", async () => {
    import.meta.env.DEV = false;
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", host: "prod.example.com", search: "" },
      writable: true,
      configurable: true,
    });

    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("wss://prod.example.com/gateway");
  });

  it("getGatewayUrl uses wss: when window.location.protocol is https:", async () => {
    import.meta.env.DEV = false;
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", host: "secure.example.com", search: "" },
      writable: true,
      configurable: true,
    });

    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("wss://secure.example.com/gateway");
  });

  it("getGatewayUrl uses ws: when window.location.protocol is http:", async () => {
    import.meta.env.DEV = false;
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", host: "local.example.com", search: "" },
      writable: true,
      configurable: true,
    });

    const mod = await import("../serverUrl.js");
    expect(mod.getGatewayUrl()).toBe("ws://local.example.com/gateway");
  });
});
