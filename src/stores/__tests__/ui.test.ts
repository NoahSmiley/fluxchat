import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui.js";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      sidebarPosition: "left",
      appBorderStyle: "none",
    });
  });

  it("initial state has correct defaults", () => {
    const state = useUIStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.sidebarPosition).toBe("left");
    expect(state.appBorderStyle).toBe("none");
  });

  it("openSettings sets settingsOpen to true", () => {
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("closeSettings sets settingsOpen to false", () => {
    useUIStore.setState({ settingsOpen: true });
    useUIStore.getState().closeSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  it("setSidebarPosition changes position", () => {
    useUIStore.getState().setSidebarPosition("right");
    expect(useUIStore.getState().sidebarPosition).toBe("right");

    useUIStore.getState().setSidebarPosition("top");
    expect(useUIStore.getState().sidebarPosition).toBe("top");

    useUIStore.getState().setSidebarPosition("bottom");
    expect(useUIStore.getState().sidebarPosition).toBe("bottom");
  });

  it("setAppBorderStyle changes style", () => {
    useUIStore.getState().setAppBorderStyle("chroma");
    expect(useUIStore.getState().appBorderStyle).toBe("chroma");

    useUIStore.getState().setAppBorderStyle("neon");
    expect(useUIStore.getState().appBorderStyle).toBe("neon");
  });

});
