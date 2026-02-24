import { create } from "zustand";
import * as api from "../lib/api/index.js";
import { gateway } from "../lib/ws.js";
import type { YouTubeTrack } from "../types/shared.js";
import { dbg } from "../lib/debug.js";

interface YouTubeState {
  youtubeAudio: HTMLAudioElement | null;
  youtubeTrack: { id: string; name: string; artist: string; imageUrl: string; durationMs: number } | null;
  youtubeProgress: number;
  youtubeDuration: number;
  youtubePaused: boolean;
  youtubeSearchResults: YouTubeTrack[];
  searchLoading: boolean;
  searchError: string | null;

  searchYouTube: (query: string) => Promise<void>;
  addYouTubeToQueue: (track: YouTubeTrack) => Promise<void>;
  playYouTube: (videoId: string, trackInfo?: { name: string; artist: string; imageUrl: string; durationMs: number }) => void;
  pauseYouTube: () => void;
  stopYouTube: () => void;
  setYouTubeVolume: (vol: number) => void;
  updateYouTubeActivity: () => void;
}

export const useYouTubeStore = create<YouTubeState>((set, get) => ({
  youtubeAudio: null,
  youtubeTrack: null,
  youtubeProgress: 0,
  youtubeDuration: 0,
  youtubePaused: true,
  youtubeSearchResults: [],
  searchLoading: false,
  searchError: null,

  searchYouTube: async (query) => {
    if (!query.trim()) { set({ youtubeSearchResults: [], searchError: null }); return; }
    set({ searchLoading: true, searchError: null });
    dbg("youtube", `searchYouTube query="${query}"`);
    try {
      const data = await api.searchYouTubeTracks(query);
      dbg("youtube", `searchYouTube results=${data.tracks?.length ?? 0}`);
      set({ youtubeSearchResults: data.tracks ?? [] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dbg("youtube", `searchYouTube FAILED: ${msg}`);
      set({ youtubeSearchResults: [], searchError: msg });
    } finally { set({ searchLoading: false }); }
  },

  addYouTubeToQueue: async (track) => {
    const { useSpotifyStore } = await import("./spotify/store.js");
    const session = useSpotifyStore.getState().session;
    if (!session) return;
    await api.addToQueue(session.id, {
      trackUri: track.id,
      trackName: track.title,
      trackArtist: track.channel,
      trackAlbum: track.channel,
      trackImageUrl: track.thumbnail,
      trackDurationMs: track.durationMs,
      source: "youtube",
    });
  },

  playYouTube: (videoId, trackInfo) => {
    dbg("youtube", `playYouTube videoId=${videoId}`, trackInfo);
    // Stop lobby music when YouTube plays
    import("./voice/store.js").then((mod) => mod.useVoiceStore.getState().stopLobbyMusicAction());

    // Pause Spotify player if active
    import("./spotify/store.js").then((mod) => {
      const player = mod.useSpotifyStore.getState().player;
      player?.pause();
      mod.useSpotifyStore.setState({ playerState: null });
    });

    // Set track state FIRST so UI renders immediately
    set({
      youtubeTrack: trackInfo
        ? { id: videoId, ...trackInfo }
        : { id: videoId, name: videoId, artist: "YouTube", imageUrl: "", durationMs: 0 },
      youtubePaused: false,
    });

    let audio = get().youtubeAudio;
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("timeupdate", () => {
        set({ youtubeProgress: audio!.currentTime * 1000 });
      });
      audio.addEventListener("loadedmetadata", () => {
        set({ youtubeDuration: audio!.duration * 1000 });
      });
      audio.addEventListener("ended", () => {
        set({ youtubePaused: true });
        // Trigger skip in the spotify store (session queue management)
        import("./spotify/store.js").then((mod) => mod.useSpotifyStore.getState().skip());
      });
      set({ youtubeAudio: audio });
    }

    audio.src = api.getYouTubeAudioUrl(videoId);
    // Read volume from spotify store for consistency
    import("./spotify/store.js").then((mod) => {
      audio!.volume = mod.useSpotifyStore.getState().volume;
    });
    audio.play().catch((e) => {
      dbg("youtube", "playYouTube audio.play() failed", e);
    });

    get().updateYouTubeActivity();
  },

  pauseYouTube: () => {
    const { youtubeAudio } = get();
    if (youtubeAudio) youtubeAudio.pause();
    set({ youtubePaused: true });
  },

  stopYouTube: () => {
    const { youtubeAudio } = get();
    if (youtubeAudio) {
      youtubeAudio.pause();
      youtubeAudio.src = "";
    }
    set({ youtubeTrack: null, youtubePaused: true, youtubeProgress: 0, youtubeDuration: 0 });
  },

  setYouTubeVolume: (vol) => {
    const { youtubeAudio } = get();
    if (youtubeAudio) youtubeAudio.volume = vol;
  },

  updateYouTubeActivity: () => {
    const { youtubeTrack, youtubePaused, youtubeProgress } = get();
    if (youtubeTrack && !youtubePaused) {
      gateway.send({
        type: "update_activity",
        activity: {
          name: youtubeTrack.name,
          activityType: "listening",
          artist: youtubeTrack.artist,
          albumArt: youtubeTrack.imageUrl || undefined,
          durationMs: youtubeTrack.durationMs,
          progressMs: Math.round(youtubeProgress),
        },
      });
    }
  },
}));
