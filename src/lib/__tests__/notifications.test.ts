import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../stores/auth.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: "u1" } })),
  },
}));

vi.mock("../../stores/chat.js", () => ({
  useChatStore: {
    getState: vi.fn(() => ({ userStatuses: {} })),
  },
}));

// Mock AudioContext using a class so `new AudioContext()` works correctly
const mockOscillator = {
  type: "",
  frequency: { value: 0 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};
const mockGain = {
  connect: vi.fn(),
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  },
};
let audioCtxInstance: any;
class MockAudioContext {
  createOscillator = vi.fn(() => ({ ...mockOscillator }));
  createGain = vi.fn(() => ({ ...mockGain }));
  destination = {};
  currentTime = 0;
  close = vi.fn();
  constructor() {
    audioCtxInstance = this;
  }
}
vi.stubGlobal("AudioContext", MockAudioContext);

// Mock Notification
const NotificationMock = vi.fn();
(NotificationMock as any).permission = "granted";
(NotificationMock as any).requestPermission = vi.fn();
vi.stubGlobal("Notification", NotificationMock);

import {
  playMessageSound,
  showDesktopNotification,
  requestNotificationPermission,
} from "../notifications.js";
import { useAuthStore } from "../../stores/auth.js";
import { useChatStore } from "../../stores/chat.js";

const mockedAuthStore = vi.mocked(useAuthStore);
const mockedChatStore = vi.mocked(useChatStore);

describe("notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (NotificationMock as any).permission = "granted";
    (mockedAuthStore.getState as any).mockReturnValue({ user: { id: "u1" } });
    (mockedChatStore.getState as any).mockReturnValue({ userStatuses: {} });
  });

  it("playMessageSound creates AudioContext and oscillators", () => {
    playMessageSound();

    expect(audioCtxInstance).toBeDefined();
    expect(audioCtxInstance.createOscillator).toHaveBeenCalled();
    expect(audioCtxInstance.createGain).toHaveBeenCalled();
  });

  it("playMessageSound skips when sound is disabled", () => {
    localStorage.setItem("flux-sound-enabled", "false");
    audioCtxInstance = undefined;

    playMessageSound();

    expect(audioCtxInstance).toBeUndefined();
  });

  it("playMessageSound skips when user is DND", () => {
    (mockedChatStore.getState as any).mockReturnValue({
      userStatuses: { u1: "dnd" },
    });
    audioCtxInstance = undefined;

    playMessageSound();

    expect(audioCtxInstance).toBeUndefined();
  });

  it("showDesktopNotification creates Notification", () => {
    showDesktopNotification("Alice", "Hello there!");

    expect(NotificationMock).toHaveBeenCalledWith("Alice", {
      body: "Hello there!",
      silent: true,
    });
  });

  it("showDesktopNotification skips when notifications disabled", () => {
    localStorage.setItem("flux-notifications-enabled", "false");

    showDesktopNotification("Alice", "Hello!");

    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("showDesktopNotification skips when user is DND", () => {
    (mockedChatStore.getState as any).mockReturnValue({
      userStatuses: { u1: "dnd" },
    });

    showDesktopNotification("Alice", "Hello!");

    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("showDesktopNotification truncates text longer than 100 chars", () => {
    const longText = "A".repeat(150);

    showDesktopNotification("Bob", longText);

    expect(NotificationMock).toHaveBeenCalledWith("Bob", {
      body: "A".repeat(100) + "...",
      silent: true,
    });
  });

  it("requestNotificationPermission calls Notification.requestPermission when permission is default", () => {
    (NotificationMock as any).permission = "default";

    requestNotificationPermission();

    expect(NotificationMock.requestPermission).toHaveBeenCalled();
  });
});
