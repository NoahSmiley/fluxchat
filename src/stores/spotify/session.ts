import type { StoreApi } from "zustand";
import type { SpotifyState } from "./types.js";
import { playOnDevice, yt, useYouTubeStore, dbg } from "./types.js";
import { gateway } from "@/lib/ws.js";
import * as api from "@/lib/api/index.js";

// ═══════════════════════════════════════════════════════════════════
// Session action creators
// ═══════════════════════════════════════════════════════════════════

export function createStartSession(store: StoreApi<SpotifyState>) {
  return async (voiceChannelId: string) => {
    dbg("spotify", `startSession channel=${voiceChannelId}`);
    // Stop lobby music when a jam session starts
    import("@/stores/voice/store.js").then((mod) => mod.useVoiceStore.getState().stopLobbyMusicAction());
    const { player } = store.getState();
    player?.pause();
    yt().stopYouTube();
    store.setState({ playerState: null, queue: [], searchResults: [], searchInput: "", showSearch: false });
    useYouTubeStore.setState({ youtubeSearchResults: [] });
    await api.createListeningSession(voiceChannelId);
    await store.getState().loadSession(voiceChannelId);
    dbg("spotify", "startSession complete", { sessionId: store.getState().session?.id });
  };
}

export function createLoadSession(store: StoreApi<SpotifyState>) {
  return async (voiceChannelId: string) => {
    dbg("spotify", `loadSession channel=${voiceChannelId}`);
    try {
      const data = await api.getListeningSession(voiceChannelId);
      if (data.session) {
        const { useAuthStore } = await import("@/stores/auth.js");
        const userId = useAuthStore.getState().user?.id;
        const wasAlreadyLoaded = store.getState().session?.id === data.session.id;
        dbg("spotify", "loadSession found session", {
          sessionId: data.session.id,
          host: data.session.hostUserId,
          isPlaying: data.session.isPlaying,
          currentTrackUri: data.session.currentTrackUri,
          currentTrackPositionMs: data.session.currentTrackPositionMs,
          queueLength: data.queue.length,
          wasAlreadyLoaded,
          isHost: data.session.hostUserId === userId,
        });
        store.setState({
          session: data.session,
          queue: data.queue,
          isHost: data.session.hostUserId === userId,
        });

        // If joining a session that has an active track playing, sync playback
        if (!wasAlreadyLoaded && data.session.isPlaying && data.session.currentTrackUri) {
          const elapsed = Date.now() - new Date(data.session.updatedAt).getTime();
          const seekTo = data.session.currentTrackPositionMs + Math.max(0, elapsed);
          dbg("spotify", "loadSession syncing playback to active track", {
            trackUri: data.session.currentTrackUri,
            positionMs: data.session.currentTrackPositionMs,
            elapsed,
            seekTo,
          });
          const deviceId = await store.getState().ensureDeviceId();
          if (deviceId) {
            await playOnDevice(deviceId, [data.session.currentTrackUri], seekTo);
          } else {
            dbg("spotify", "loadSession sync failed — no deviceId");
          }
        }
      } else {
        dbg("spotify", "loadSession no active session");
        store.setState({ session: null, queue: [], isHost: false });
      }
    } catch (e) {
      dbg("spotify", "loadSession error", e);
      store.setState({ session: null, queue: [], isHost: false });
    }
  };
}

export function createLeaveSession(store: StoreApi<SpotifyState>) {
  return () => {
    dbg("spotify", "leaveSession");
    const { player } = store.getState();
    player?.pause();
    yt().stopYouTube();
    store.setState({ session: null, queue: [], isHost: false, playerState: null });
    gateway.send({ type: "update_activity", activity: null });
  };
}

export function createEndSession(store: StoreApi<SpotifyState>) {
  return async () => {
    const { session, player } = store.getState();
    if (!session) return;
    dbg("spotify", `endSession sessionId=${session.id}`);
    player?.pause();
    yt().stopYouTube();
    try {
      await api.deleteListeningSession(session.id);
    } catch (e) {
      dbg("spotify", "endSession error", e);
    }
    store.setState({ session: null, queue: [], isHost: false, playerState: null });
    gateway.send({ type: "update_activity", activity: null });
  };
}
