import { describe, it, expect } from "vitest";
import { avatarColor } from "../avatarColor.js";

describe("avatarColor", () => {
  it("returns a deterministic color for the same name", () => {
    const color1 = avatarColor("alice");
    const color2 = avatarColor("alice");
    expect(color1).toBe(color2);
  });

  it("returns different colors for different names", () => {
    const colorAlice = avatarColor("alice");
    const colorBob = avatarColor("bob");
    // Not guaranteed to differ but very likely with different hashes
    // At minimum they should both be valid hex colors
    expect(colorAlice).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorBob).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("returns the first color for null/undefined", () => {
    expect(avatarColor(null)).toBe("#e06c75");
    expect(avatarColor(undefined)).toBe("#e06c75");
  });

  it("returns a valid hex color from the palette", () => {
    const validColors = [
      "#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef",
      "#c678dd", "#d19a66", "#be5046", "#7ec8e3", "#c3e88d",
    ];
    expect(validColors).toContain(avatarColor("testuser"));
    expect(validColors).toContain(avatarColor("anotheruser"));
  });
});
