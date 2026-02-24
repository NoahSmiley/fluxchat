import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock twemoji before importing the module under test.
// twemoji.parse() replaces Unicode emoji with <img> tags; we stub it to
// return a predictable string so we can test the surrounding logic.
vi.mock("twemoji", () => ({
  default: {
    parse: vi.fn((html: string, _opts?: unknown) => {
      // Simple mock: wrap any emoji-like Unicode chars in an <img> tag
      // For testing purposes, just return the input unchanged unless we
      // want to verify that twemoji.parse was called.
      return html;
    }),
  },
}));

import {
  getEmojiLabel,
  renderEmoji,
  renderMessageContent,
  isEmojiOnly,
} from "../emoji.js";
import type { CustomEmoji } from "../../types/shared.js";

function makeCustomEmoji(name: string): CustomEmoji {
  return {
    id: `emoji-${name}`,
    serverId: "server1",
    name,
    attachmentId: `att-${name}`,
    filename: `${name}.png`,
    uploaderId: "user1",
    uploaderUsername: "alice",
    uploaderImage: null,
    createdAt: "2025-01-01T00:00:00Z",
  };
}

const API_BASE = "http://localhost:3001/api";

describe("getEmojiLabel", () => {
  it("returns the same string for :name: format (custom emoji)", () => {
    expect(getEmojiLabel(":wave:")).toBe(":wave:");
    expect(getEmojiLabel(":custom_emoji:")).toBe(":custom_emoji:");
  });

  it("looks up a native emoji and returns :id: format", () => {
    // The grinning face emoji (U+1F600) should map to :grinning:
    const label = getEmojiLabel("\u{1F600}");
    expect(label).toBe(":grinning:");
  });

  it("returns the raw character for unknown native emoji", () => {
    // Some obscure character that won't be in the emoji data
    const unknown = "\u{0041}"; // capital A — not an emoji
    expect(getEmojiLabel(unknown)).toBe("A");
  });
});

describe("renderEmoji", () => {
  it("renders a custom emoji as an <img> tag", () => {
    const custom = makeCustomEmoji("fire");
    const html = renderEmoji(":fire:", [custom], API_BASE);
    expect(html).toContain("<img");
    expect(html).toContain(`src="${API_BASE}/files/att-fire/fire.png"`);
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain('alt=":fire:"');
  });

  it("returns escaped text for unknown :name: custom emoji", () => {
    const html = renderEmoji(":unknown:", [], API_BASE);
    expect(html).toBe(":unknown:");
    expect(html).not.toContain("<img");
  });

  it("passes native unicode emoji through twemoji.parse", () => {
    // Our mock just returns the input — verify it doesn't crash
    const html = renderEmoji("\u{1F600}", [], API_BASE);
    expect(typeof html).toBe("string");
  });
});

describe("isEmojiOnly", () => {
  it("returns false for empty/whitespace text", () => {
    expect(isEmojiOnly("", [])).toBe(false);
    expect(isEmojiOnly("   ", [])).toBe(false);
  });

  it("returns true for a single standard emoji", () => {
    expect(isEmojiOnly("\u{1F600}", [])).toBe(true);
  });

  it("returns true for multiple standard emoji within limit", () => {
    expect(isEmojiOnly("\u{1F600}\u{1F601}\u{1F602}", [])).toBe(true);
  });

  it("returns false for plain text mixed with emoji", () => {
    expect(isEmojiOnly("hello \u{1F600}", [])).toBe(false);
  });

  it("returns true for custom emoji", () => {
    const custom = makeCustomEmoji("fire");
    expect(isEmojiOnly(":fire:", [custom])).toBe(true);
  });

  it("returns false for :name: that is not a known custom emoji", () => {
    expect(isEmojiOnly(":unknown:", [])).toBe(false);
  });

  it("returns false when emoji count exceeds maxCount", () => {
    const manyEmoji = Array(11).fill("\u{1F600}").join("");
    expect(isEmojiOnly(manyEmoji, [], 10)).toBe(false);
  });

  it("respects custom maxCount parameter", () => {
    const twoEmoji = "\u{1F600}\u{1F601}";
    expect(isEmojiOnly(twoEmoji, [], 1)).toBe(false);
    expect(isEmojiOnly(twoEmoji, [], 2)).toBe(true);
  });
});

describe("renderMessageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string for empty input", () => {
    expect(renderMessageContent("", [], API_BASE)).toBe("");
  });

  it("escapes HTML entities in plain text", () => {
    const html = renderMessageContent("<script>alert('xss')</script>", [], API_BASE);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("converts URLs into clickable links", () => {
    const html = renderMessageContent("Check https://example.com out", [], API_BASE);
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("converts @mentions into spans when memberUsernames is provided", () => {
    const members = new Set(["alice"]);
    const html = renderMessageContent("Hey @alice!", [], API_BASE, members);
    expect(html).toContain('<span class="mention">@alice</span>');
  });

  it("does not convert @mentions for unknown usernames", () => {
    const members = new Set(["alice"]);
    const html = renderMessageContent("Hey @bob!", [], API_BASE, members);
    expect(html).not.toContain('<span class="mention">@bob</span>');
  });

  it("converts @everyone and @here mentions", () => {
    const members = new Set<string>();
    const html = renderMessageContent("Attention @everyone and @here", [], API_BASE, members);
    expect(html).toContain('<span class="mention">@everyone</span>');
    expect(html).toContain('<span class="mention">@here</span>');
  });

  it("does not convert mentions when memberUsernames is not provided", () => {
    const html = renderMessageContent("Hey @alice!", [], API_BASE);
    expect(html).not.toContain('<span class="mention">');
  });

  it("replaces :name: custom emoji with img tags", () => {
    const custom = makeCustomEmoji("fire");
    const html = renderMessageContent("This is :fire:!", [custom], API_BASE);
    expect(html).toContain("<img");
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain(`src="${API_BASE}/files/att-fire/fire.png"`);
  });

  it("handles text with both URLs and mentions", () => {
    const members = new Set(["alice"]);
    const html = renderMessageContent(
      "@alice see https://example.com",
      [],
      API_BASE,
      members,
    );
    expect(html).toContain('<span class="mention">@alice</span>');
    expect(html).toContain('<a href="https://example.com"');
  });

  it("handles multiple URLs in the same message", () => {
    const html = renderMessageContent(
      "Visit https://a.com and https://b.com",
      [],
      API_BASE,
    );
    expect(html).toContain('<a href="https://a.com"');
    expect(html).toContain('<a href="https://b.com"');
  });
});
