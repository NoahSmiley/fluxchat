import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime } from "../relativeTime.js";

describe("relativeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'just now' for less than 60 seconds ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 30_000); // 30 seconds ago
    expect(relativeTime(date)).toBe("just now");
  });

  it("returns minutes ago for < 60 minutes", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 5 * 60_000); // 5 minutes ago
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("returns hours ago for < 24 hours", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 3 * 3_600_000); // 3 hours ago
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("returns 'Yesterday' for exactly 1 day ago", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 25 * 3_600_000); // 25 hours ago (1 day)
    expect(relativeTime(date)).toBe("Yesterday");
  });

  it("returns days ago for 2-6 days", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 4 * 86_400_000); // 4 days ago
    expect(relativeTime(date)).toBe("4d ago");
  });

  it("returns formatted date for >= 7 days", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 10 * 86_400_000); // 10 days ago
    const result = relativeTime(date);
    // Should be a locale date string, not a relative time
    expect(result).not.toContain("ago");
    expect(result).not.toBe("just now");
    expect(result).not.toBe("Yesterday");
  });

  it("accepts string dates", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const date = new Date(now - 120_000).toISOString(); // 2 minutes ago
    expect(relativeTime(date)).toBe("2m ago");
  });
});
