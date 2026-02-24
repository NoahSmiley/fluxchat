import { Track } from "livekit-client";
import { dbg } from "../lib/debug.js";
import type { VoiceState, ScreenShareQuality } from "./voice-types.js";
import { SCREEN_SHARE_PRESETS } from "./voice-types.js";
import type { StoreApi } from "zustand";

export function createToggleScreenShare(storeRef: StoreApi<VoiceState>) {
  return async (displaySurface?: "monitor" | "window") => {
    const get = () => storeRef.getState();
    const set = (partial: Partial<VoiceState>) => { storeRef.setState(partial); };

    const { room, isScreenSharing, screenShareQuality } = get();
    if (!room) return;

    const preset = SCREEN_SHARE_PRESETS[screenShareQuality];

    try {
      if (isScreenSharing) {
        dbg("voice", "toggleScreenShare stopping");
        await room.localParticipant.setScreenShareEnabled(false);
        set({ isScreenSharing: false });
      } else {
        dbg("voice", `toggleScreenShare starting quality=${screenShareQuality}`, {
          ...preset,
          displaySurface,
        });
        await room.localParticipant.setScreenShareEnabled(true,
          // Capture options
          {
            audio: true,
            contentHint: preset.contentHint,
            resolution: { width: 3840, height: 2160, frameRate: 60 },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: "include",
            ...(displaySurface ? { displaySurface } : {}),
          },
          // Publish options
          {
            videoCodec: preset.codec,
            screenShareEncoding: {
              maxBitrate: preset.maxBitrate,
              maxFramerate: preset.frameRate,
              priority: "high",
            },
            scalabilityMode: preset.scalabilityMode,
            degradationPreference: preset.degradationPreference,
            backupCodec: { codec: "vp8" },
          },
        );
        set({ isScreenSharing: true });
        dbg("voice", "toggleScreenShare started successfully");

        // Apply resolution + framerate constraints on the captured track
        for (const pub of room.localParticipant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            const mst = pub.track.mediaStreamTrack;
            if (mst?.readyState === "live") {
              mst.applyConstraints({
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate },
              }).catch((e) => { dbg("voice", "Failed to apply screen share track constraints", e); });
            }
          }
        }
      }
      get()._updateScreenSharers();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Permission denied")) {
        dbg("voice", "toggleScreenShare user cancelled permission dialog");
        return;
      }
      dbg("voice", "toggleScreenShare error", err);
    }
  };
}

export function createSetScreenShareQuality(storeRef: StoreApi<VoiceState>) {
  return (quality: ScreenShareQuality) => {
    const get = () => storeRef.getState();
    const set = (partial: Partial<VoiceState>) => { storeRef.setState(partial); };

    const prevQuality = get().screenShareQuality;
    set({ screenShareQuality: quality });

    const { room, isScreenSharing } = get();
    if (!isScreenSharing || !room) return;

    const preset = SCREEN_SHARE_PRESETS[quality];
    const prevPreset = SCREEN_SHARE_PRESETS[prevQuality];

    // Codec change (h264 <-> vp9) requires republishing the track
    if (preset.codec !== prevPreset.codec) {
      dbg("voice", `setScreenShareQuality codec change ${prevPreset.codec} → ${preset.codec}, republishing`);
      (async () => {
        try {
          for (const pub of room.localParticipant.videoTrackPublications.values()) {
            if (pub.source === Track.Source.ScreenShare && pub.track) {
              const mediaStreamTrack = pub.track.mediaStreamTrack;
              await room.localParticipant.unpublishTrack(pub.track, false);
              await room.localParticipant.publishTrack(mediaStreamTrack, {
                source: Track.Source.ScreenShare,
                videoCodec: preset.codec,
                screenShareEncoding: {
                  maxBitrate: preset.maxBitrate,
                  maxFramerate: preset.frameRate,
                  priority: "high",
                },
                scalabilityMode: preset.scalabilityMode,
                degradationPreference: preset.degradationPreference,
              });
              get()._updateScreenSharers();
              break;
            }
          }
        } catch (e) {
          dbg("voice", "Failed to republish screen share for codec change:", e);
        }
      })();
      return;
    }

    // Same codec — apply encoding params live via RTCRtpSender + track constraints
    dbg("voice", `setScreenShareQuality live update: ${prevQuality} → ${quality}`, preset);

    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      if (pub.source === Track.Source.ScreenShare && pub.track) {
        // Update encoder params (bitrate, framerate cap)
        const sender = pub.track.sender;
        if (sender) {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = preset.maxBitrate;
            params.encodings[0].maxFramerate = preset.frameRate;
            sender.setParameters(params).catch((e: unknown) =>
              dbg("voice", "Failed to update screen share encoding:", e),
            );
          }
        }
        // Apply resolution + framerate constraints on the actual MediaStreamTrack
        const mediaTrack = pub.track.mediaStreamTrack;
        if (mediaTrack?.readyState === "live") {
          mediaTrack.contentHint = preset.contentHint;
          mediaTrack.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate },
          }).catch((e: unknown) =>
            dbg("voice", "Failed to apply track constraints:", e),
          );
        }
      }
    }
  };
}
