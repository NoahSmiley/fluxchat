import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../ui.js";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      serverSettingsOpen: false,
      showingEconomy: false,
      sidebarPosition: "left",
      appBorderStyle: "none",
      showDummyUsers: false,
    });
  });

  it("initial state has correct defaults", () => {
    const state = useUIStore.getState();
    expect(state.settingsOpen).toBe(false);
    expect(state.serverSettingsOpen).toBe(false);
    expect(state.showingEconomy).toBe(false);
    expect(state.sidebarPosition).toBe("left");
    expect(state.appBorderStyle).toBe("none");
    expect(state.showDummyUsers).toBe(false);
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

  it("openServerSettings sets serverSettingsOpen to true", () => {
    useUIStore.getState().openServerSettings();
    expect(useUIStore.getState().serverSettingsOpen).toBe(true);
  });

  it("closeServerSettings sets serverSettingsOpen to false", () => {
    useUIStore.setState({ serverSettingsOpen: true });
    useUIStore.getState().closeServerSettings();
    expect(useUIStore.getState().serverSettingsOpen).toBe(false);
  });

  it("showEconomy sets showingEconomy to true", () => {
    useUIStore.getState().showEconomy();
    expect(useUIStore.getState().showingEconomy).toBe(true);
  });

  it("hideEconomy sets showingEconomy to false", () => {
    useUIStore.setState({ showingEconomy: true });
    useUIStore.getState().hideEconomy();
    expect(useUIStore.getState().showingEconomy).toBe(false);
  });

  it("toggleEconomy toggles showingEconomy", () => {
    expect(useUIStore.getState().showingEconomy).toBe(false);
    useUIStore.getState().toggleEconomy();
    expect(useUIStore.getState().showingEconomy).toBe(true);
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

  it("toggleDummyUsers toggles showDummyUsers", () => {
    expect(useUIStore.getState().showDummyUsers).toBe(false);
    useUIStore.getState().toggleDummyUsers();
    expect(useUIStore.getState().showDummyUsers).toBe(true);
  });

  it("multiple toggles work correctly", () => {
    expect(useUIStore.getState().showingEconomy).toBe(false);
    useUIStore.getState().toggleEconomy();
    expect(useUIStore.getState().showingEconomy).toBe(true);
    useUIStore.getState().toggleEconomy();
    expect(useUIStore.getState().showingEconomy).toBe(false);

    expect(useUIStore.getState().showDummyUsers).toBe(false);
    useUIStore.getState().toggleDummyUsers();
    expect(useUIStore.getState().showDummyUsers).toBe(true);
    useUIStore.getState().toggleDummyUsers();
    expect(useUIStore.getState().showDummyUsers).toBe(false);
  });
});
