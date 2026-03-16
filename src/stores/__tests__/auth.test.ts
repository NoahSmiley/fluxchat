import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "@/stores/auth.js";

// Mock the api module
vi.mock("../../lib/api/index.js", () => ({
  getSession: vi.fn(),
  ssoInitiate: vi.fn(),
  ssoPoll: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
}));

import * as api from "@/lib/api/index.js";

const mockedApi = vi.mocked(api);

describe("useAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useAuthStore.setState({ user: null, loading: true, error: null, ssoPolling: false, ssoCode: null });
  });

  it("initialize sets user from session", async () => {
    const mockUser = {
      id: "u1",
      email: "alice@test.com",
      username: "alice",
      ringStyle: "default" as const,
      ringSpin: false,
    };
    mockedApi.getSession.mockResolvedValue({ user: mockUser });

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("initialize sets null when no session", async () => {
    mockedApi.getSession.mockResolvedValue(null);

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it("cancelSSO stops polling", () => {
    useAuthStore.setState({ ssoPolling: true, ssoCode: "abc" });

    useAuthStore.getState().cancelSSO();

    expect(useAuthStore.getState().ssoPolling).toBe(false);
    expect(useAuthStore.getState().ssoCode).toBeNull();
  });

  it("logout clears user", async () => {
    useAuthStore.setState({
      user: {
        id: "u1",
        email: "alice@test.com",
        username: "alice",
        ringStyle: "default",
        ringSpin: false,
      },
    });

    mockedApi.signOut.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
  });
});
