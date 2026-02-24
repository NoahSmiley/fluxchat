import type { DragEndEvent, DragStartEvent, DragOverEvent } from "@dnd-kit/core";
import type { Channel, ReorderItem } from "../../types/shared.js";
import { useChatStore } from "../../stores/chat/index.js";
import * as api from "../../lib/api/index.js";

export interface DnDState {
  activeId: string | null;
  dropTargetCategoryId: string | null;
  dwellRef: React.MutableRefObject<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>;
  dropIntoCategoryRef: React.MutableRefObject<string | null>;
  flatList: { channel: Channel; depth: number }[];
  regularChannels: Channel[];
  activeServerId: string;
  setActiveId: (id: string | null) => void;
  setDropTargetCategoryId: (id: string | null) => void;
}

const DROP_INTO_CATEGORY_DWELL_MS = 1000;

export function clearDwell(dwellRef: React.MutableRefObject<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>) {
  if (dwellRef.current) clearTimeout(dwellRef.current.timer);
  dwellRef.current = null;
}

export function handleDragStart(event: DragStartEvent, state: DnDState) {
  state.setActiveId(event.active.id as string);
  state.setDropTargetCategoryId(null);
  clearDwell(state.dwellRef);
  state.dropIntoCategoryRef.current = null;
}

export function handleDragOver(event: DragOverEvent, state: DnDState) {
  const { active, over } = event;
  if (!over || !active) {
    clearDwell(state.dwellRef);
    state.dropIntoCategoryRef.current = null;
    state.setDropTargetCategoryId(null);
    return;
  }
  const activeNode = state.flatList.find((n) => n.channel.id === active.id);
  const overNode = state.flatList.find((n) => n.channel.id === over.id);
  if (!activeNode || !overNode) {
    clearDwell(state.dwellRef);
    state.dropIntoCategoryRef.current = null;
    state.setDropTargetCategoryId(null);
    return;
  }

  if (overNode.channel.type === "category" && overNode.channel.id !== activeNode.channel.id) {
    const activeIdx = state.flatList.findIndex((n) => n.channel.id === active.id);
    const overIdx = state.flatList.findIndex((n) => n.channel.id === over.id);
    let dwellCatId = overNode.channel.id;
    if (activeIdx > overIdx && overIdx > 0) {
      const aboveNode = state.flatList[overIdx - 1];
      if (aboveNode.channel.type === "category" && aboveNode.channel.id !== activeNode.channel.id) {
        dwellCatId = aboveNode.channel.id;
      }
    }

    const currentLockedCat = state.dropIntoCategoryRef.current;
    const hoveredCatId = dwellCatId;

    if (currentLockedCat === hoveredCatId) return;

    if (currentLockedCat) {
      state.dropIntoCategoryRef.current = null;
      state.setDropTargetCategoryId(null);
    }

    if (!state.dwellRef.current || state.dwellRef.current.catId !== hoveredCatId) {
      clearDwell(state.dwellRef);
      state.dwellRef.current = {
        catId: hoveredCatId,
        timer: setTimeout(() => {
          state.dropIntoCategoryRef.current = hoveredCatId;
          state.setDropTargetCategoryId(hoveredCatId);
        }, DROP_INTO_CATEGORY_DWELL_MS),
      };
    }
  } else if (state.dropIntoCategoryRef.current) {
    return;
  }
}

export async function handleDragEnd(event: DragEndEvent, state: DnDState) {
  const activatedCategory = state.dropIntoCategoryRef.current;
  state.setActiveId(null);
  state.setDropTargetCategoryId(null);
  clearDwell(state.dwellRef);
  state.dropIntoCategoryRef.current = null;

  const { active, over } = event;
  if (!over || active.id === over.id) return;

  const activeNode = state.flatList.find((n) => n.channel.id === active.id);
  const overNode = state.flatList.find((n) => n.channel.id === over.id);
  if (!activeNode || !overNode) return;

  const isActiveCategory = activeNode.channel.type === "category";

  let newParentId: string | null;
  if (activatedCategory && activatedCategory !== (active.id as string)) {
    newParentId = activatedCategory;
  } else {
    newParentId = overNode.channel.parentId;
  }

  if (newParentId) {
    const parent = state.regularChannels.find((c) => c.id === newParentId);
    if (!parent || parent.type !== "category") {
      newParentId = null;
    } else if (isActiveCategory) {
      let checkId: string | null = newParentId;
      while (checkId) {
        if (checkId === active.id) { newParentId = null; break; }
        checkId = state.regularChannels.find((c) => c.id === checkId)?.parentId ?? null;
      }
    }
  }
  const sameParent = (activeNode.channel.parentId ?? null) === (newParentId ?? null);
  const items: ReorderItem[] = [];

  function assignPositions(siblings: Channel[], parentId: string | null): ReorderItem[] {
    const sorted = [...siblings].sort((a, b) => a.position - b.position);
    const chans = sorted.filter((c) => c.type !== "category");
    const categories = sorted.filter((c) => c.type === "category");
    const ordered = [...chans, ...categories];
    return ordered.map((c, i) => ({ id: c.id, parentId, position: i }));
  }

  if (sameParent) {
    const allSiblings = state.regularChannels
      .filter((c) => (c.parentId ?? null) === (newParentId ?? null))
      .sort((a, b) => a.position - b.position);

    const typeGroup = allSiblings.filter((c) => (c.type === "category") === isActiveCategory);
    const oldIdx = typeGroup.findIndex((c) => c.id === active.id);
    const newIdx = typeGroup.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = [...typeGroup];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);

    const otherGroup = allSiblings.filter((c) => (c.type === "category") !== isActiveCategory);
    const fullList = isActiveCategory
      ? [...otherGroup, ...reordered]
      : [...reordered, ...otherGroup];

    for (let i = 0; i < fullList.length; i++) {
      items.push({ id: fullList[i].id, parentId: newParentId, position: i });
    }
  } else {
    const newSiblings = state.regularChannels
      .filter((c) => (c.parentId ?? null) === (newParentId ?? null) && c.id !== (active.id as string));

    const withMoved = [...newSiblings, activeNode.channel];
    items.push(...assignPositions(withMoved, newParentId));

    const oldSiblings = state.regularChannels
      .filter((c) => (c.parentId ?? null) === (activeNode.channel.parentId ?? null) && c.id !== (active.id as string));
    items.push(...assignPositions(oldSiblings, activeNode.channel.parentId));
  }

  useChatStore.setState((s) => ({
    channels: s.channels.map((ch) => {
      const item = items.find((it) => it.id === ch.id);
      if (item) return { ...ch, parentId: item.parentId, position: item.position };
      return ch;
    }),
  }));

  if (items.length === 0) return;

  try {
    await api.reorderChannels(state.activeServerId, items);
  } catch {
    const fresh = await api.getChannels(state.activeServerId);
    useChatStore.setState({ channels: fresh });
  }
}
