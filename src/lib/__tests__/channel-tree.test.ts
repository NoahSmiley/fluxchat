import { describe, it, expect, beforeEach } from "vitest";
import { buildTree, flattenTree, loadCollapsed, saveCollapsed } from "../channel-tree.js";
import type { Channel } from "../../types/shared.js";

function makeChannel(overrides: Partial<Channel> & { id: string; name: string }): Channel {
  return {
    serverId: "server1",
    type: "text",
    bitrate: null,
    parentId: null,
    position: 0,
    isRoom: false,
    creatorId: null,
    isLocked: false,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("places root-level channels (no parentId) at depth 0", () => {
    const channels = [
      makeChannel({ id: "ch1", name: "general", position: 0 }),
      makeChannel({ id: "ch2", name: "random", position: 1 }),
    ];
    const tree = buildTree(channels);
    expect(tree).toHaveLength(2);
    expect(tree[0].depth).toBe(0);
    expect(tree[1].depth).toBe(0);
    expect(tree[0].channel.name).toBe("general");
    expect(tree[1].channel.name).toBe("random");
  });

  it("nests channels under their parent category", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Text Channels", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "random", parentId: "cat1", position: 1 }),
    ];
    const tree = buildTree(channels);
    expect(tree).toHaveLength(1);
    expect(tree[0].channel.id).toBe("cat1");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].channel.name).toBe("general");
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[1].channel.name).toBe("random");
  });

  it("sorts channels before categories within the same level", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Category A", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", position: 1 }),
    ];
    const tree = buildTree(channels);
    // text channel before category
    expect(tree[0].channel.id).toBe("ch1");
    expect(tree[1].channel.id).toBe("cat1");
  });

  it("sorts by position within the same type", () => {
    const channels = [
      makeChannel({ id: "ch3", name: "charlie", position: 2 }),
      makeChannel({ id: "ch1", name: "alpha", position: 0 }),
      makeChannel({ id: "ch2", name: "bravo", position: 1 }),
    ];
    const tree = buildTree(channels);
    expect(tree.map((n) => n.channel.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("only builds children for category nodes", () => {
    const channels = [
      makeChannel({ id: "ch1", name: "general", type: "text", position: 0 }),
      makeChannel({ id: "orphan", name: "orphan", parentId: "ch1", position: 0 }),
    ];
    const tree = buildTree(channels);
    // ch1 is not a category so it won't have children built
    const generalNode = tree.find((n) => n.channel.id === "ch1");
    expect(generalNode?.children).toEqual([]);
  });

  it("handles multiple categories with nested children", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "cat2", name: "Cat 2", type: "category", position: 1 }),
      makeChannel({ id: "ch1", name: "in-cat1", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "in-cat2", parentId: "cat2", position: 0 }),
    ];
    const tree = buildTree(channels);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].channel.name).toBe("in-cat1");
    expect(tree[1].children).toHaveLength(1);
    expect(tree[1].children[0].channel.name).toBe("in-cat2");
  });
});

describe("flattenTree", () => {
  it("returns all nodes when nothing is collapsed", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "random", parentId: "cat1", position: 1 }),
    ];
    const tree = buildTree(channels);
    const flat = flattenTree(tree, new Set());
    expect(flat).toHaveLength(3);
    expect(flat.map((n) => n.channel.id)).toEqual(["cat1", "ch1", "ch2"]);
  });

  it("hides children of collapsed categories", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "random", parentId: "cat1", position: 1 }),
    ];
    const tree = buildTree(channels);
    const collapsed = new Set(["cat1"]);
    const flat = flattenTree(tree, collapsed);
    expect(flat).toHaveLength(1);
    expect(flat[0].channel.id).toBe("cat1");
  });

  it("shows the active channel path even when its parent is collapsed", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "random", parentId: "cat1", position: 1 }),
    ];
    const tree = buildTree(channels);
    const collapsed = new Set(["cat1"]);
    const flat = flattenTree(tree, collapsed, "ch1");
    expect(flat.map((n) => n.channel.id)).toEqual(["cat1", "ch1"]);
  });

  it("does not show non-active siblings when parent is collapsed", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch2", name: "random", parentId: "cat1", position: 1 }),
    ];
    const tree = buildTree(channels);
    const collapsed = new Set(["cat1"]);
    const flat = flattenTree(tree, collapsed, "ch1");
    const ids = flat.map((n) => n.channel.id);
    expect(ids).not.toContain("ch2");
  });

  it("marks intermediate categories as pinned in a deep path", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "cat2", name: "Cat 2", type: "category", parentId: "cat1", position: 0 }),
      makeChannel({ id: "ch1", name: "deep", parentId: "cat2", position: 0 }),
    ];
    const tree = buildTree(channels);
    const collapsed = new Set(["cat1"]);
    const flat = flattenTree(tree, collapsed, "ch1");
    // cat1 is top-level, cat2 is intermediate (pinned), ch1 is active
    expect(flat).toHaveLength(3);
    expect(flat[0].channel.id).toBe("cat1");
    expect(flat[0].pinned).toBeFalsy(); // top-level category is just rendered
    expect(flat[1].channel.id).toBe("cat2");
    expect(flat[1].pinned).toBe(true);
    expect(flat[2].channel.id).toBe("ch1");
  });

  it("returns null path when active channel is not in collapsed category", () => {
    const channels = [
      makeChannel({ id: "cat1", name: "Cat 1", type: "category", position: 0 }),
      makeChannel({ id: "ch1", name: "general", parentId: "cat1", position: 0 }),
    ];
    const tree = buildTree(channels);
    const collapsed = new Set(["cat1"]);
    // Active channel is not in this tree
    const flat = flattenTree(tree, collapsed, "nonexistent");
    expect(flat).toHaveLength(1);
    expect(flat[0].channel.id).toBe("cat1");
  });
});

describe("loadCollapsed / saveCollapsed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty set when nothing is stored", () => {
    const set = loadCollapsed();
    expect(set.size).toBe(0);
  });

  it("round-trips through save and load", () => {
    const original = new Set(["cat1", "cat2"]);
    saveCollapsed(original);
    const loaded = loadCollapsed();
    expect(loaded).toEqual(original);
  });

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem("flux-collapsed-categories", "not valid json{{{");
    const set = loadCollapsed();
    expect(set.size).toBe(0);
  });
});
