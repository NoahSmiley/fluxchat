import type { StoreApi } from "zustand";
import type { SpotifyState } from "./types.js";
import { playOnDevice, yt, getYouTubeAudio, useYouTubeStore, dbg } from "./types.js";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";

// ═══════════════════════════════════════════════════════════════════
// Playback action creators
// ═══════════════════════════════════════════════════════════════════

export function createEnsureDeviceId(store: StoreApi<SpotifyState>) {
  return async (): Promise<string | null> => {
    let { deviceId } = store.getState();
    if (deviceId) {
      dbg("spotify", `ensureDeviceId already have ${deviceId}`);
      return deviceId;
    }

    // Try reconnecting the existing player
    const { player } = store.getState();
    if (player) {
      dbg("spotify", "ensureDeviceId reconnecting player...");
      player.connect();
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        deviceId = store.getState().deviceId;
        if (deviceId) {
          dbg("spotify", `ensureDeviceId got deviceId=${deviceId} after ${i + 1} polls`);
          return deviceId;
        }
      }
    }

    dbg("spotify", "ensureDeviceId FAILED — no deviceId after 10 polls", { hasPlayer: !!player });
    return null;
  };
}

export function createUpdateActivity(store: StoreApi<SpotifyState>) {
  return () => {
    const { playerState } = store.getState();
    const { youtubeTrack, youtubePaused } = yt();

    // YouTube activity
    if (youtubeTrack && !youtubePaused) {
      yt().updateYouTubeActivity();
      return;
    }

    // Spotify activity
    if (!playerState || !playerState.track_window.current_track) {
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    const track = playerState.track_window.current_track;
    if (playerState.paused) {
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    gateway.send({
      type: "update_activity",
      activity: {
        name: track.name,
        activityType: "listening",
        artist: track.artists.map((a) => a.name).join(", "),
        albumArt: track.album.images[0]?.url,
        durationMs: track.duration_ms,
        progressMs: playerState.position,
      },
    });
  };
}

export function createPlay(store: StoreApi<SpotifyState>) {
  return async (trackUri?: string, source?: string) => {
    const { session, player, queue } = store.getState();
    const { youtubeTrack } = yt();
    if (!session) return;

    // Determine the effective source
    let effectiveSource = source ?? queue.find(i => i.trackUri === trackUri)?.source ?? undefined;

    // Resume case: no trackUri means resume whatever is currently active
    if (!trackUri) {
      if (youtubeTrack) {
        // Resume YouTube
        dbg("spotify", "play: resuming YouTube");
        const audio = getYouTubeAudio();
        if (audio) {
          audio.play();
          useYouTubeStore.setState({ youtubePaused: false });
        }
        gateway.send({
          type: "spotify_playback_control",
          sessionId: session.id,
          action: "play",
          positionMs: Math.round(yt().youtubeProgress),
          source: "youtube",
        });
        store.getState().updateActivity();
        return;
      }
      // Resume Spotify
      dbg("spotify", "play: resuming Spotify");
      player?.resume();
      gateway.send({
        type: "spotify_playback_control",
        sessionId: session.id,
        action: "play",
        positionMs: store.getState().playerState?.position ?? 0,
        source: "spotify",
      });
      return;
    }

    // Default source to spotify if still unknown
    if (!effectiveSource) effectiveSource = "spotify";

    const queueItem = queue.find((item) => item.trackUri === trackUri);
    if (queueItem) {
      store.setState((s) => ({ queue: s.queue.filter((item) => item.trackUri !== trackUri) }));
      api.removeFromQueue(session.id, queueItem.id);
    }

    // Build track info from queue or search results (needed for both send and local playback)
    const searchItem = effectiveSource === "youtube" ? yt().youtubeSearchResults.find(t => t.id === trackUri) : undefined;
    const trackInfo = effectiveSource === "youtube"
      ? queueItem
        ? { name: queueItem.trackName, artist: queueItem.trackArtist, imageUrl: queueItem.trackImageUrl ?? "", durationMs: queueItem.trackDurationMs }
        : searchItem
        ? { name: searchItem.title, artist: searchItem.channel, imageUrl: searchItem.thumbnail, durationMs: searchItem.durationMs }
        : undefined
      : undefined;

    // Broadcast to other session members (include metadata so they don't need local lookup)
    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "play",
      trackUri,
      positionMs: 0,
      source: effectiveSource,
      ...(trackInfo && {
        trackName: trackInfo.name,
        trackArtist: trackInfo.artist,
        trackImageUrl: trackInfo.imageUrl,
        trackDurationMs: trackInfo.durationMs,
      }),
    });

    if (effectiveSource === "youtube") {
      yt().playYouTube(trackUri, trackInfo);
    } else {
      // Switch to Spotify
      yt().stopYouTube();
      const deviceId = await store.getState().ensureDeviceId();
      if (deviceId) await playOnDevice(deviceId, [trackUri]);
    }
  };
}

export function createPause(store: StoreApi<SpotifyState>) {
  return () => {
    const { session, player, playerState } = store.getState();
    const { youtubeTrack, youtubePaused, youtubeProgress } = yt();
    if (!session) return;

    const ytActive = youtubeTrack && !youtubePaused;

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "pause",
      positionMs: ytActive ? Math.round(youtubeProgress) : playerState?.position,
      source: ytActive ? "youtube" : "spotify",
    });

    if (ytActive) {
      const audio = getYouTubeAudio();
      if (audio) audio.pause();
      useYouTubeStore.setState({ youtubePaused: true });
    } else {
      player?.pause();
    }
    store.getState().updateActivity();
  };
}

export function createSkip(store: StoreApi<SpotifyState>) {
  return async (trackUri?: string) => {
    const { session, player, queue } = store.getState();
    if (!session) return;

    const nextItem = trackUri ? queue.find(i => i.trackUri === trackUri) : queue[0];
    const nextTrack = trackUri ?? queue[0]?.trackUri;
    const nextSource = nextItem?.source ?? "spotify";

    // Nothing to skip to — stop everything
    if (!nextTrack) {
      gateway.send({ type: "spotify_playback_control", sessionId: session.id, action: "pause", positionMs: 0, source: "spotify" });
      player?.pause();
      yt().stopYouTube();
      store.setState({ playerState: null });
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    const skipTrackInfo = nextItem && nextSource === "youtube" ? {
      trackName: nextItem.trackName,
      trackArtist: nextItem.trackArtist,
      trackImageUrl: nextItem.trackImageUrl ?? "",
      trackDurationMs: nextItem.trackDurationMs,
    } : undefined;

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "skip",
      trackUri: nextTrack,
      source: nextSource,
      ...skipTrackInfo,
    });

    store.setState((s) => ({ queue: s.queue.filter((item) => item.trackUri !== nextTrack) }));

    if (nextSource === "youtube") {
      player?.pause();
      yt().playYouTube(nextTrack, nextItem ? {
        name: nextItem.trackName,
        artist: nextItem.trackArtist,
        imageUrl: nextItem.trackImageUrl ?? "",
        durationMs: nextItem.trackDurationMs,
      } : undefined);
    } else {
      yt().stopYouTube();
      const deviceId = await store.getState().ensureDeviceId();
      if (deviceId) await playOnDevice(deviceId, [nextTrack]);
    }
  };
}

export function createSeek(store: StoreApi<SpotifyState>) {
  return (ms: number) => {
    const { session, player } = store.getState();
    const { youtubeTrack } = yt();
    if (!session) return;
    dbg("spotify", `seek ms=${ms}`);

    const ytActive = !!youtubeTrack;

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "seek",
      positionMs: ms,
      source: ytActive ? "youtube" : "spotify",
    });

    if (ytActive) {
      const audio = getYouTubeAudio();
      if (audio) audio.currentTime = ms / 1000;
    } else {
      player?.seek(ms);
    }
  };
}

export function createSetVolume(store: StoreApi<SpotifyState>) {
  return (vol: number) => {
    const { player } = store.getState();
    store.setState({ volume: vol });
    player?.setVolume(vol);
    yt().setYouTubeVolume(vol);
  };
}
