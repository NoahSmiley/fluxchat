import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Mock import.meta.env
vi.stubGlobal("import", { meta: { env: { DEV: true } } });

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
  open: vi.fn(),
}));

// Mock BroadcastChannel
if (typeof globalThis.BroadcastChannel === "undefined") {
  class BroadcastChannelMock {
    name: string;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(name: string) {
      this.name = name;
    }
    postMessage(_data: unknown) {}
    close() {}
  }
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: BroadcastChannelMock,
    configurable: true,
  });
}

// Mock AudioContext
if (typeof globalThis.AudioContext === "undefined") {
  const mockOsc = {
    type: "",
    frequency: { value: 0 },
    connect() {},
    start() {},
    stop() {},
  };
  const mockGain = {
    connect() {},
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
  };
  Object.defineProperty(globalThis, "AudioContext", {
    value: class {
      createOscillator() {
        return { ...mockOsc };
      }
      createGain() {
        return { ...mockGain };
      }
      get destination() {
        return {};
      }
      get currentTime() {
        return 0;
      }
      close() {}
    },
    configurable: true,
  });
}
