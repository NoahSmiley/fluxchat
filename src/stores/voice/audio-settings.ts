import type { AudioSettings } from "@/lib/audio/voice-pipeline.js";
import { dbg } from "@/lib/debug.js";
import { DEFAULT_SETTINGS } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// Audio Settings Persistence
// ═══════════════════════════════════════════════════════════════════

const SETTINGS_STORAGE_KEY = "flux-audio-settings";

export function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) { dbg("voice", "Failed to load audio settings from localStorage", e); }
  return { ...DEFAULT_SETTINGS };
}

export function saveAudioSettings(settings: AudioSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) { dbg("voice", "Failed to save audio settings to localStorage", e); }
}
