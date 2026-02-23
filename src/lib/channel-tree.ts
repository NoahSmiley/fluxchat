import type { Channel } from "../types/shared.js";

const COLLAPSE_KEY = "flux-collapsed-categories";

export function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

export function saveCollapsed(set: Set<string>) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
}

export interface TreeNode {
  channel: Channel;
  children: TreeNode[];
  depth: number;
  pinned?: boolean; // shown as an ancestor of the active channel under a collapsed parent
}

export function buildTree(channels: Channel[]): TreeNode[] {
  const childMap = new Map<string, Channel[]>();
  for (const ch of channels) {
    const key = ch.parentId ?? "__root__";
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key)!.push(ch);
  }
  for (const [, list] of childMap) {
    // Channels always before categories, then by position within each group
    list.sort((a, b) => {
      const aIsCat = a.type === "category" ? 1 : 0;
      const bIsCat = b.type === "category" ? 1 : 0;
      if (aIsCat !== bIsCat) return aIsCat - bIsCat;
      return a.position - b.position;
    });
  }

  function build(parentId: string | null, depth: number): TreeNode[] {
    const key = parentId ?? "__root__";
    const children = childMap.get(key) ?? [];
    return children.map((ch) => ({
      channel: ch,
      children: ch.type === "category" ? build(ch.id, depth + 1) : [],
      depth,
    }));
  }

  return build(null, 0);
}

export function flattenTree(nodes: TreeNode[], collapsed: Set<string>, activeChannelId?: string | null): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.channel.type === "category") {
      if (!collapsed.has(node.channel.id)) {
        result.push(...flattenTree(node.children, collapsed, activeChannelId));
      } else if (activeChannelId) {
        // Category is collapsed — show the full path to the active channel so
        // intermediate categories are visible but locked (pinned)
        const activePath = findActivePath(node.children, activeChannelId);
        if (activePath) result.push(...activePath);
      }
    }
  }
  return result;
}

/** Recursively find the path from the search root down to the active channel.
 *  Returns every node along the way, with intermediate categories marked pinned. */
function findActivePath(nodes: TreeNode[], activeChannelId: string): TreeNode[] | null {
  for (const node of nodes) {
    if (node.channel.id === activeChannelId) return [node];
    if (node.channel.type === "category") {
      const path = findActivePath(node.children, activeChannelId);
      if (path) return [{ ...node, pinned: true }, ...path];
    }
  }
  return null;
}
