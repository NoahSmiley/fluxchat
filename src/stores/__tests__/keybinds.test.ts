import { describe, it, expect, beforeEach } from "vitest";
import { useKeybindsStore } from "../keybinds.js";

describe("useKeybindsStore", () => {
  beforeEach(() => {
    useKeybindsStore.setState({
      keybinds: [
        { action: "push-to-talk", key: null, label: null },
        { action: "push-to-mute", key: null, label: null },
        { action: "toggle-mute", key: null, label: null },
        { action: "toggle-deafen", key: null, label: null },
      ],
      recording: null,
    });
  });

  it("initial state has 4 default keybinds with null keys and labels", () => {
    const state = useKeybindsStore.getState();
    expect(state.keybinds).toHaveLength(4);
    expect(state.recording).toBeNull();
    for (const kb of state.keybinds) {
      expect(kb.key).toBeNull();
      expect(kb.label).toBeNull();
    }
    expect(state.keybinds.map((kb) => kb.action)).toEqual([
      "push-to-talk",
      "push-to-mute",
      "toggle-mute",
      "toggle-deafen",
    ]);
  });

  it("setKeybind updates the correct keybind and clears recording", () => {
    useKeybindsStore.setState({ recording: "push-to-talk" });

    useKeybindsStore.getState().setKeybind("push-to-talk", "KeyV", "V");

    const state = useKeybindsStore.getState();
    const ptt = state.keybinds.find((kb) => kb.action === "push-to-talk");
    expect(ptt?.key).toBe("KeyV");
    expect(ptt?.label).toBe("V");
    expect(state.recording).toBeNull();
  });

  it("clearKeybind sets key and label to null", () => {
    useKeybindsStore.getState().setKeybind("toggle-mute", "KeyM", "M");
    useKeybindsStore.getState().clearKeybind("toggle-mute");

    const kb = useKeybindsStore
      .getState()
      .keybinds.find((kb) => kb.action === "toggle-mute");
    expect(kb?.key).toBeNull();
    expect(kb?.label).toBeNull();
  });

  it("startRecording sets recording to the given action", () => {
    useKeybindsStore.getState().startRecording("push-to-mute");
    expect(useKeybindsStore.getState().recording).toBe("push-to-mute");
  });

  it("stopRecording clears recording", () => {
    useKeybindsStore.setState({ recording: "toggle-deafen" });
    useKeybindsStore.getState().stopRecording();
    expect(useKeybindsStore.getState().recording).toBeNull();
  });

  it("setKeybind only changes the targeted action, others remain unchanged", () => {
    useKeybindsStore.getState().setKeybind("push-to-talk", "Space", "Space");

    const state = useKeybindsStore.getState();
    const ptt = state.keybinds.find((kb) => kb.action === "push-to-talk");
    expect(ptt?.key).toBe("Space");
    expect(ptt?.label).toBe("Space");

    const others = state.keybinds.filter((kb) => kb.action !== "push-to-talk");
    for (const kb of others) {
      expect(kb.key).toBeNull();
      expect(kb.label).toBeNull();
    }
  });

  it("clearKeybind only clears the targeted action", () => {
    useKeybindsStore.getState().setKeybind("push-to-talk", "KeyV", "V");
    useKeybindsStore.getState().setKeybind("toggle-mute", "KeyM", "M");

    useKeybindsStore.getState().clearKeybind("push-to-talk");

    const state = useKeybindsStore.getState();
    const ptt = state.keybinds.find((kb) => kb.action === "push-to-talk");
    expect(ptt?.key).toBeNull();
    expect(ptt?.label).toBeNull();

    const mute = state.keybinds.find((kb) => kb.action === "toggle-mute");
    expect(mute?.key).toBe("KeyM");
    expect(mute?.label).toBe("M");
  });
});
