import type { PresenceStatus } from "../../types/shared.js";
import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./types.js";
import { useCryptoStore } from "../crypto.js";
import type { AuthStoreRef } from "./events.js";

// ── Member / presence / server event handlers ──

export function handlePresence(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
  authStoreRef: AuthStoreRef,
) {
  const selfId = authStoreRef?.getState()?.user?.id;
  // The server broadcasts "offline" to mask invisible users from others, but also sends
  // that broadcast to the user themselves. Skip only those "offline" masking events for self
  // so they don't wipe out our local "invisible" status.
  if (event.userId === selfId && event.status === "offline") return;
  useChatStore.setState((s) => {
    const isOffline = event.status === "offline";
    const wasOnline = s.onlineUsers.has(event.userId);
    const prevStatus = s.userStatuses[event.userId];
    // Skip if already in the desired state
    if (isOffline && !wasOnline) return s;
    if (!isOffline && wasOnline && prevStatus === event.status) return s;
    const newSet = new Set(s.onlineUsers);
    const newStatuses = { ...s.userStatuses };
    if (isOffline) {
      newSet.delete(event.userId);
      delete newStatuses[event.userId];
    } else {
      newSet.add(event.userId);
      newStatuses[event.userId] = event.status as PresenceStatus;
    }
    return { onlineUsers: newSet, userStatuses: newStatuses };
  });
}

export function handleActivityUpdate(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => {
    const activities = { ...s.userActivities };
    if (event.activity) {
      activities[event.userId] = event.activity;
    } else {
      delete activities[event.userId];
    }
    return { userActivities: activities };
  });
}

export function handleMemberJoined(
  event: any,
  state: ChatState,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  if (event.serverId === state.activeServerId) {
    const alreadyExists = state.members.some((m) => m.userId === event.userId);
    if (!alreadyExists) {
      useChatStore.setState((s) => ({
        members: [...s.members, {
          userId: event.userId,
          serverId: event.serverId,
          username: event.username,
          image: event.image,
          role: event.role as "owner" | "admin" | "member",
          joinedAt: new Date().toISOString(),
          ringStyle: event.ringStyle ?? "default",
          ringSpin: event.ringSpin ?? false,
          steamId: event.steamId ?? null,
          ringPatternSeed: event.ringPatternSeed ?? null,
          bannerCss: event.bannerCss ?? null,
          bannerPatternSeed: event.bannerPatternSeed ?? null,
        }],
      }));
    }
  }
  // Auto-share server encryption key with new member
  useCryptoStore.getState().handleKeyRequested(event.serverId, event.userId);
}

export function handleServerKeyShared(event: any) {
  useCryptoStore.getState().handleKeyShared(event.serverId, event.encryptedKey, event.senderId);
}

export function handleServerKeyRequested(event: any) {
  useCryptoStore.getState().handleKeyRequested(event.serverId, event.userId);
}

export function handleMemberLeft(
  event: any,
  state: ChatState,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  if (event.serverId === state.activeServerId) {
    useChatStore.setState((s) => ({
      members: s.members.filter((m) => m.userId !== event.userId),
    }));
  }
}

export function handleServerUpdated(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => ({
    servers: s.servers.map((sv) =>
      sv.id === event.serverId ? { ...sv, name: event.name } : sv
    ),
  }));
}

export function handleServerDeleted(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => ({
    servers: s.servers.filter((sv) => sv.id !== event.serverId),
    ...(s.activeServerId === event.serverId
      ? { activeServerId: null, activeChannelId: null, channels: [], messages: [], members: [] }
      : {}),
  }));
}

export function handleMemberRoleUpdated(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
  authStoreRef: AuthStoreRef,
) {
  useChatStore.setState((s) => ({
    members: s.members.map((m) =>
      m.userId === event.userId && m.serverId === event.serverId
        ? { ...m, role: event.role as "owner" | "admin" | "member" }
        : m
    ),
    servers: s.servers.map((sv) =>
      sv.id === event.serverId && event.userId === authStoreRef?.getState()?.user?.id
        ? { ...sv, role: event.role }
        : sv
    ),
  }));
}

export function handleProfileUpdate(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => ({
    members: s.members.map((m) =>
      m.userId === event.userId
        ? {
            ...m,
            ...(event.username !== undefined ? { username: event.username } : {}),
            ...(event.image !== undefined ? { image: event.image } : {}),
            ...(event.ringStyle !== undefined ? { ringStyle: event.ringStyle } : {}),
            ...(event.ringSpin !== undefined ? { ringSpin: event.ringSpin } : {}),
            ...(event.ringPatternSeed !== undefined ? { ringPatternSeed: event.ringPatternSeed } : {}),
            ...(event.bannerCss !== undefined ? { bannerCss: event.bannerCss } : {}),
            ...(event.bannerPatternSeed !== undefined ? { bannerPatternSeed: event.bannerPatternSeed } : {}),
          }
        : m
    ),
  }));
}
