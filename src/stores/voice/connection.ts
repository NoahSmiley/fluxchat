import { Room, ExternalE2EEKeyProvider, Track } from "livekit-client";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";
import { useKeybindsStore } from "@/stores/keybinds.js";
import { useCryptoStore } from "@/stores/crypto.js";
import { exportKeyAsBase64 } from "@/lib/crypto.js";
import { dbg } from "@/lib/debug.js";
import { playJoinSound, playLeaveSound } from "@/lib/sounds.js";
import { RnnoiseProcessor, DeepFilterProcessor, DtlnProcessor } from "@/lib/noiseProcessor.js";
import { VadProcessor } from "@/lib/vadProcessor.js";
import { initAdaptiveBitrate, resetAdaptiveBitrate } from "@/lib/adaptiveBitrate.js";

import type { VoiceState } from "./types.js";
import { checkLobbyMusic, stopLobbyMusic } from "./lobby.js";
import { startStatsPolling } from "./stats.js";
import { setupRoomEventHandlers } from "./room-events.js";
import type { StoreApi } from "zustand";

const DEFAULT_BITRATE = 510_000;

// Cached chat store ref (populated on first joinVoiceChannel, avoids async gap on leave)
let cachedChatStore: any = null;

// Monotonically increasing counter to detect stale joinVoiceChannel calls
let joinNonce = 0;

// Adaptive bitrate ceiling
export let adaptiveTargetBitrate = DEFAULT_BITRATE;
export function setAdaptiveTargetBitrate(bitrate: number) {
  adaptiveTargetBitrate = bitrate;
}

// ── Audio processor instances (shared so store can toggle live) ──
export let activeRnnoiseProcessor: RnnoiseProcessor | null = null;
export let activeDeepFilterProcessor: DeepFilterProcessor | null = null;
export let activeDtlnProcessor: DtlnProcessor | null = null;
export let activeVadProcessor: VadProcessor | null = null;

export function setActiveRnnoiseProcessor(p: RnnoiseProcessor | null) { activeRnnoiseProcessor = p; }
export function setActiveDeepFilterProcessor(p: DeepFilterProcessor | null) { activeDeepFilterProcessor = p; }
export function setActiveDtlnProcessor(p: DtlnProcessor | null) { activeDtlnProcessor = p; }
export function setActiveVadProcessor(p: VadProcessor | null) { activeVadProcessor = p; }

async function destroyAllProcessors(room?: Room | null) {
  if (activeRnnoiseProcessor) {
    // Restore original track if possible
    await activeRnnoiseProcessor.destroy();
    activeRnnoiseProcessor = null;
  }
  if (activeDeepFilterProcessor) {
    const micPub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    await activeDeepFilterProcessor.detach(micPub);
    activeDeepFilterProcessor = null;
  }
  if (activeDtlnProcessor) {
    await activeDtlnProcessor.destroy();
    activeDtlnProcessor = null;
  }
  if (activeVadProcessor) {
    await activeVadProcessor.destroy();
    activeVadProcessor = null;
  }
  resetAdaptiveBitrate();
}

export function createJoinVoiceChannel(storeRef: StoreApi<VoiceState>) {
  return async (channelId: string) => {
    const get = () => storeRef.getState();
    const set = (partial: Partial<VoiceState> | ((state: VoiceState) => Partial<VoiceState>)) => {
      storeRef.setState(partial as any);
    };

    const { room: existingRoom, connectedChannelId, audioSettings } = get();

    dbg("voice", `joinVoiceChannel requested channel=${channelId}`, {
      currentChannel: connectedChannelId,
      hasExistingRoom: !!existingRoom,
    });

    if (connectedChannelId === channelId) {
      dbg("voice", "joinVoiceChannel skipped — already connected");
      return;
    }

    // Room switch: silently disconnect without sounds or full state reset
    const isSwitching = !!existingRoom && !!connectedChannelId;
    if (existingRoom) {
      dbg("voice", `joinVoiceChannel ${isSwitching ? "switching" : "disconnecting"} from previous room`);
      existingRoom.removeAllListeners();

      // Clean up audio processors from previous room
      await destroyAllProcessors(existingRoom);

      try {
        for (const pub of existingRoom.localParticipant.audioTrackPublications.values()) {
          if (pub.track) pub.track.stop();
        }
      } catch (e) { dbg("voice", "Failed to stop local mic tracks during room switch", e); }

      stopLobbyMusic();

      for (const participant of existingRoom.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          if (pub.track) pub.track.detach().forEach((el) => el.remove());
        }
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.track) pub.track.detach().forEach((el) => el.remove());
        }
      }

      await existingRoom.disconnect();
      set({ room: null, connectedChannelId: null, connecting: true, connectionError: null });
    }

    const previousChannelId = isSwitching ? connectedChannelId : null;
    const myNonce = ++joinNonce;
    const isStale = () => myNonce !== joinNonce;

    if (!isSwitching) set({ connecting: true, connectionError: null });

    try {
      dbg("voice", "joinVoiceChannel fetching voice token...");
      const { token, url } = await api.getVoiceToken(channelId);

      if (isStale()) {
        dbg("voice", "joinVoiceChannel aborted after token fetch — newer join in progress");
        set({ connecting: false });
        return;
      }

      const { useChatStore } = await import("@/stores/chat/store.js");
      cachedChatStore = useChatStore;
      const chatState = useChatStore.getState();
      const channel = chatState.channels.find((c) => c.id === channelId);
      const channelBitrate = channel?.bitrate ?? DEFAULT_BITRATE;
      adaptiveTargetBitrate = channelBitrate;

      const cryptoState = useCryptoStore.getState();
      const serverId = chatState.activeServerId;
      const serverKey = serverId ? cryptoState.getServerKey(serverId) : null;

      let e2eeOptions: { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | undefined;
      if (serverKey) {
        try {
          const keyProvider = new ExternalE2EEKeyProvider();
          const keyBase64 = await exportKeyAsBase64(serverKey);
          await keyProvider.setKey(keyBase64);
          e2eeOptions = {
            keyProvider,
            worker: new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" }),
          };
        } catch (e) { dbg("voice", "joinVoiceChannel E2EE setup failed", e); }
      }

      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: audioSettings.echoCancellation,
          noiseSuppression: false, // Handled by RNNoise/DeepFilterNet3, not browser
          autoGainControl: audioSettings.autoGainControl,
          sampleRate: 48000,
          channelCount: 2,
        },
        publishDefaults: {
          audioPreset: { maxBitrate: channelBitrate },
          dtx: audioSettings.dtx,
          red: true,
          forceStereo: true,
          stopMicTrackOnMute: false,
          videoCodec: "h264",
          screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 60, priority: "high" },
          screenShareSimulcastLayers: [],
          scalabilityMode: "L1T1",
          degradationPreference: "balanced",
          backupCodec: { codec: "vp8" },
        },
        ...(e2eeOptions ? { e2ee: e2eeOptions } : {}),
      });

      setupRoomEventHandlers(room, storeRef);

      await room.connect(url, token);

      if (isStale()) {
        room.disconnect();
        set({ connecting: false });
        return;
      }

      const micDeviceId = audioSettings.audioInputDeviceId;
      if (micDeviceId) {
        await room.switchActiveDevice("audioinput", micDeviceId);
      }
      await room.localParticipant.setMicrophoneEnabled(true);
      const outputDeviceId = audioSettings.audioOutputDeviceId;
      if (outputDeviceId) {
        await room.switchActiveDevice("audiooutput", outputDeviceId).catch(() => {});
      }

      // ── Attach noise suppression processor ──
      try {
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (audioSettings.noiseSuppression === "standard" && micPub?.track?.mediaStreamTrack) {
          const processor = new RnnoiseProcessor();
          const processedTrack = await processor.init(micPub.track.mediaStreamTrack);
          await micPub.track.mediaStreamTrack.stop(); // not needed after reroute
          await (micPub.track as any).replaceTrack(processedTrack);
          activeRnnoiseProcessor = processor;
          dbg("voice", "RNNoise processor attached on join");
        } else if (audioSettings.noiseSuppression === "enhanced" && micPub) {
          const processor = new DeepFilterProcessor();
          await processor.attach(micPub);
          activeDeepFilterProcessor = processor;
          dbg("voice", "DeepFilterNet3 processor attached on join");
        } else if (audioSettings.noiseSuppression === "dtln" && micPub?.track?.mediaStreamTrack) {
          const processor = new DtlnProcessor();
          const processedTrack = await processor.init(micPub.track.mediaStreamTrack);
          await micPub.track.mediaStreamTrack.stop();
          await (micPub.track as any).replaceTrack(processedTrack);
          activeDtlnProcessor = processor;
          dbg("voice", "DTLN processor attached on join");
        }
      } catch (e) {
        dbg("voice", "Noise suppression setup failed (non-fatal)", e);
      }

      // ── Init VAD for voice gating ──
      if (audioSettings.voiceGating) {
        try {
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          const mst = micPub?.track?.mediaStreamTrack;
          if (mst) {
            const vadProc = new VadProcessor();
            await vadProc.init(
              new MediaStream([mst]),
              audioSettings.sensitivity,
              (speaking) => {
                const { isMuted, isDeafened } = storeRef.getState();
                // Skip if user is manually muted/deafened or PTT is active
                const { keybinds } = useKeybindsStore.getState();
                const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
                if (isMuted || isDeafened || hasPTT) return;
                room.localParticipant.setMicrophoneEnabled(speaking);
              },
            );
            activeVadProcessor = vadProc;
            dbg("voice", "VAD processor initialized on join");
          }
        } catch (e) {
          dbg("voice", "VAD setup failed (non-fatal)", e);
        }
      }

      // ── Init adaptive bitrate ──
      if (audioSettings.adaptiveBitrate) {
        initAdaptiveBitrate(channelBitrate, (bitrate) => {
          storeRef.getState().applyBitrate(bitrate);
        });
      }

      // Optimistically add self to channelParticipants
      const localIdentity = room.localParticipant.identity;
      const localName = room.localParticipant.name ?? localIdentity.slice(0, 8);
      const optimisticParticipants = { ...get().channelParticipants };
      if (previousChannelId && optimisticParticipants[previousChannelId]) {
        optimisticParticipants[previousChannelId] = optimisticParticipants[previousChannelId].filter(
          (p) => p.userId !== localIdentity,
        );
      }
      optimisticParticipants[channelId] = [
        ...(optimisticParticipants[channelId] || []).filter((p) => p.userId !== localIdentity),
        { userId: localIdentity, username: localName },
      ];

      set({
        room,
        connectedChannelId: channelId,
        connecting: false,
        isMuted: false,
        isDeafened: false,
        isScreenSharing: false,
        screenSharers: [],
        pinnedScreenShare: null,
        channelParticipants: optimisticParticipants,
      });

      get()._updateParticipants();
      get()._updateScreenSharers();
      startStatsPolling();
      checkLobbyMusic();
      playJoinSound();

      // If push-to-talk is configured, start muted
      const { keybinds } = useKeybindsStore.getState();
      const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
      if (hasPTT) {
        room.localParticipant.setMicrophoneEnabled(false);
        set({ isMuted: true });
      }

      if (previousChannelId) {
        gateway.send({ type: "voice_state_update", channelId: previousChannelId, action: "leave" });
      }
      gateway.send({ type: "voice_state_update", channelId, action: "join" });
    } catch (err) {
      if (isStale()) return;
      set({
        connecting: false,
        connectionError: err instanceof Error ? err.message : "Failed to connect to voice",
      });
    }
  };
}

export function createLeaveVoiceChannel(storeRef: StoreApi<VoiceState>) {
  return () => {
    ++joinNonce;

    const get = () => storeRef.getState();
    const set = (partial: Partial<VoiceState>) => { storeRef.setState(partial); };

    const { room, connectedChannelId, channelParticipants } = get();
    const localId = room?.localParticipant?.identity;

    // Clean up audio processors before disconnecting
    destroyAllProcessors(room).catch(() => {});

    stopLobbyMusic();
    playLeaveSound();

    try {
      import("@/stores/spotify/store.js").then(({ useSpotifyStore }) => {
        useSpotifyStore.getState().leaveSession();
      });
    } catch (e) { dbg("voice", "Failed to stop Spotify session on voice leave", e); }

    if (room) {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track) publication.track.detach().forEach((el) => el.remove());
        }
        for (const publication of participant.videoTrackPublications.values()) {
          if (publication.track) publication.track.detach().forEach((el) => el.remove());
        }
      }
      room.disconnect();
    }
    if (connectedChannelId) {
      gateway.send({ type: "voice_state_update", channelId: connectedChannelId, action: "leave" });
    }

    const updatedParticipants = { ...channelParticipants };
    if (connectedChannelId && updatedParticipants[connectedChannelId] && localId) {
      updatedParticipants[connectedChannelId] = updatedParticipants[connectedChannelId].filter(
        (p) => p.userId !== localId,
      );
    }

    // Disconnected handler resets core voice state; we only set fields it doesn't cover
    set({
      channelParticipants: updatedParticipants,
      connecting: false,
      connectedChannelId: null,
    });

    // If we left a room (ephemeral voice channel), switch to a text channel
    // immediately (synchronous) to prevent a flash of the "Join Room" UI
    if (connectedChannelId && cachedChatStore) {
      const chatState = cachedChatStore.getState();
      const channel = chatState.channels.find((c: any) => c.id === connectedChannelId);
      if (channel?.isRoom && chatState.activeChannelId === connectedChannelId) {
        const fallback = chatState.channels.find(
          (c: any) => c.type === "text" && c.serverId === channel.serverId,
        );
        if (fallback) {
          cachedChatStore.getState().selectChannel(fallback.id);
        }
      }
    }
  };
}
