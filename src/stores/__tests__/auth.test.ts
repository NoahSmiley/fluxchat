import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuthStore } from "../auth.js";

// Mock the api module
vi.mock("../../lib/api/index.js", () => ({
  getSession: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
}));

import * as api from "../../lib/api/index.js";

const mockedApi = vi.mocked(api);

describe("useAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useAuthStore.setState({ user: null, loading: true, error: null });
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

  it("login success sets user", async () => {
    const mockUser = {
      id: "u1",
      email: "alice@test.com",
      username: "alice",
      ringStyle: "default" as const,
      ringSpin: false,
    };
    mockedApi.signIn.mockResolvedValue({ user: mockUser, token: "tok123" });
    mockedApi.getSession.mockResolvedValue({ user: mockUser });

    await useAuthStore.getState().login("alice@test.com", "password123");

    expect(mockedApi.signIn).toHaveBeenCalledWith("alice@test.com", "password123");
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it("login failure sets error", async () => {
    mockedApi.signIn.mockRejectedValue(new Error("Invalid credentials"));

    await expect(
      useAuthStore.getState().login("alice@test.com", "wrong"),
    ).rejects.toThrow("Invalid credentials");

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().error).toBe("Invalid credentials");
  });

  it("register success sets user", async () => {
    const mockUser = {
      id: "u1",
      email: "bob@test.com",
      username: "bob",
      ringStyle: "default" as const,
      ringSpin: false,
    };
    mockedApi.signUp.mockResolvedValue({ user: mockUser, token: "tok456" });
    mockedApi.getSession.mockResolvedValue({ user: mockUser });

    await useAuthStore.getState().register("bob@test.com", "password123", "bob");

    expect(mockedApi.signUp).toHaveBeenCalledWith("bob@test.com", "password123", "bob");
    expect(useAuthStore.getState().user).toEqual(mockUser);
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
