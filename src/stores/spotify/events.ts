import type { StoreApi } from "zustand";
import type { SpotifyState } from "./types.js";
import type { WSServerEvent } from "../../types/shared.js";
import { playOnDevice, yt, useYouTubeStore, dbg } from "./types.js";
import { gateway } from "../../lib/ws.js";

// ═══════════════════════════════════════════════════════════════════
// WebSocket event handler
// ═══════════════════════════════════════════════════════════════════

export function createHandleWSEvent(store: StoreApi<SpotifyState>) {
  return (event: WSServerEvent) => {
    switch (event.type) {
      case "spotify_queue_update": {
        const { session } = store.getState();
        dbg("spotify", `WS spotify_queue_update sessionId=${event.sessionId}`, {
          trackName: event.queueItem?.trackName,
          trackUri: event.queueItem?.trackUri,
          matched: session?.id === event.sessionId,
        });
        if (session && session.id === event.sessionId) {
          store.setState((s) => ({ queue: [...s.queue, event.queueItem] }));
        }
        break;
      }
      case "spotify_queue_remove": {
        const { session } = store.getState();
        dbg("spotify", `WS spotify_queue_remove sessionId=${event.sessionId} itemId=${event.itemId}`);
        if (session && session.id === event.sessionId) {
          store.setState((s) => ({ queue: s.queue.filter((item) => item.id !== event.itemId) }));
        }
        break;
      }
      case "spotify_playback_sync": {
        const { session, player } = store.getState();
        dbg("spotify", `WS spotify_playback_sync`, {
          sessionId: event.sessionId,
          action: event.action,
          trackUri: event.trackUri,
          positionMs: event.positionMs,
          hasPlayer: !!player,
          sessionMatch: session?.id === event.sessionId,
        });
        if (!session || session.id !== event.sessionId) break;

        const source = (event as any).source ?? "spotify";

        if (source === "youtube") {
          const findTrackInfo = (videoId: string) => {
            const qi = store.getState().queue.find(i => i.trackUri === videoId);
            if (qi) return { name: qi.trackName, artist: qi.trackArtist, imageUrl: qi.trackImageUrl ?? "", durationMs: qi.trackDurationMs };
            const si = yt().youtubeSearchResults.find(t => t.id === videoId);
            if (si) return { name: si.title, artist: si.channel, imageUrl: si.thumbnail, durationMs: si.durationMs };
            return undefined;
          };

          if (event.action === "play" && event.trackUri) {
            player?.pause();
            yt().playYouTube(event.trackUri, findTrackInfo(event.trackUri));
          } else if (event.action === "play" && !event.trackUri) {
            // Resume YouTube
            const audio = yt().youtubeAudio;
            if (audio) { audio.play(); useYouTubeStore.setState({ youtubePaused: false }); }
          } else if (event.action === "pause") {
            yt().youtubeAudio?.pause();
          } else if (event.action === "seek" && event.positionMs != null) {
            const audio = yt().youtubeAudio;
            if (audio) audio.currentTime = event.positionMs / 1000;
          } else if (event.action === "skip" && event.trackUri) {
            player?.pause();
            const info = findTrackInfo(event.trackUri);
            store.setState((s) => ({ queue: s.queue.filter((item) => item.trackUri !== event.trackUri) }));
            yt().playYouTube(event.trackUri, info);
          }
          break;
        }

        // Spotify sync — stop YouTube first
        if (event.action === "play" || event.action === "skip") {
          yt().stopYouTube();
        }

        // Sync playback from another session member
        const playTrackOnDevice = async (uri: string, positionMs?: number) => {
          const deviceId = await store.getState().ensureDeviceId();
          if (!deviceId) {
            dbg("spotify", "playback_sync: no deviceId, cannot play");
            return;
          }
          await playOnDevice(deviceId, [uri], positionMs);
        };

        if (event.action === "play" && event.trackUri && player) {
          dbg("spotify", `playback_sync: playing track ${event.trackUri} at position ${event.positionMs ?? 0}ms`);
          playTrackOnDevice(event.trackUri, event.positionMs ?? undefined);
        } else if (event.action === "play" && !event.trackUri && player) {
          dbg("spotify", "playback_sync: resuming");
          player.resume();
        } else if (event.action === "pause" && player) {
          dbg("spotify", "playback_sync: pausing");
          player.pause();
        } else if (event.action === "seek" && player && event.positionMs != null) {
          dbg("spotify", `playback_sync: seeking to ${event.positionMs}ms`);
          player.seek(event.positionMs);
        } else if (event.action === "skip" && event.trackUri && player) {
          dbg("spotify", `playback_sync: skipping to ${event.trackUri}`);
          const skipUri = event.trackUri;
          store.setState((s) => ({ queue: s.queue.filter((item) => item.trackUri !== skipUri) }));
          playTrackOnDevice(skipUri);
        } else {
          dbg("spotify", "playback_sync: unhandled combination", { action: event.action, hasTrackUri: !!event.trackUri, hasPlayer: !!player });
        }
        break;
      }
      case "spotify_session_ended": {
        const { session, player } = store.getState();
        dbg("spotify", `WS spotify_session_ended sessionId=${event.sessionId}`, { currentSession: session?.id });
        if (session && session.id === event.sessionId) {
          player?.pause();
          yt().stopYouTube();
          store.setState({ session: null, queue: [], isHost: false, playerState: null });
          gateway.send({ type: "update_activity", activity: null });
        }
        break;
      }
    }
  };
}
