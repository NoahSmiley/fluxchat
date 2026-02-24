import { useState, useRef } from "react";
import { Play, X, Upload } from "lucide-react";
import * as api from "../../lib/api.js";
import type { SoundboardSound, CustomEmoji } from "../../types/shared.js";
import { API_BASE } from "../../lib/serverUrl.js";
import { renderEmoji } from "../../lib/emoji.js";
import EmojiPicker from "../EmojiPicker.js";
import { audioBufferToWav, WaveformCanvas } from "./SoundboardWaveform.js";

// ── Add Sound Form ────────────────────────────────────────────────────────

export interface SoundboardAddFormProps {
  serverId: string;
  customEmojis: CustomEmoji[];
  onSave: (sound: SoundboardSound) => void;
  onCancel: () => void;
}

export function SoundboardAddForm({ serverId, customEmojis, onSave, onCancel }: SoundboardAddFormProps) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(10);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [volume, setVolume] = useState(0.8);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const previewNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  function resetForm() {
    setAudioFile(null);
    setAudioBuffer(null);
    setAudioDuration(0);
    setStartSec(0);
    setEndSec(10);
    setName("");
    setEmoji("");
    setVolume(0.8);
    setSaving(false);
    setError("");
  }

  async function handleAudioPick(file: File) {
    setAudioFile(file);
    setError("");
    const arrayBuf = await file.arrayBuffer();
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    await ctx.close();
    setAudioBuffer(decoded);
    const dur = decoded.duration;
    setAudioDuration(dur);
    setStartSec(0);
    setEndSec(Math.min(dur, 10));
  }

  function stopPreview() {
    previewNodeRef.current?.stop();
    previewNodeRef.current = null;
    previewCtxRef.current?.close();
    previewCtxRef.current = null;
    setPreviewing(false);
  }

  async function handlePreview() {
    if (!audioBuffer) return;
    if (previewing) { stopPreview(); return; }
    const ctx = new AudioContext();
    previewCtxRef.current = ctx;
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(gainNode);
    previewNodeRef.current = src;
    setPreviewing(true);
    src.start(0, startSec, endSec - startSec);
    src.onended = () => {
      setPreviewing(false);
      previewNodeRef.current = null;
    };
  }

  async function handleSave() {
    if (!audioBuffer || !audioFile) return;
    if (!name.trim()) { setError("Name is required"); return; }

    const selDuration = endSec - startSec;
    if (selDuration > 10) { setError("Selection must be 10 seconds or less"); return; }

    setSaving(true);
    setError("");

    try {
      // Trim audio via OfflineAudioContext
      const sampleRate = audioBuffer.sampleRate;
      const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
      const frameCount = Math.ceil(selDuration * sampleRate);
      const offlineCtx = new OfflineAudioContext(numChannels, frameCount, sampleRate);
      const src = offlineCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offlineCtx.destination);
      src.start(0, startSec, selDuration);
      const trimmed = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(trimmed);
      const wavFile = new File([wavBlob], `${name.trim().replace(/\s+/g, "_")}.wav`, { type: "audio/wav" });

      // Upload audio
      const audioAtt = await api.uploadFile(wavFile);

      const sound = await api.createSoundboardSound(serverId, {
        name: name.trim(),
        emoji: emoji.trim() || undefined,
        audioAttachmentId: audioAtt.id,
        volume,
      });

      onSave(sound);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sound");
    } finally {
      setSaving(false);
    }
  }

  const selDuration = endSec - startSec;
  const needsTrim = audioDuration > 10;

  return (
    <div className="soundboard-add-form">
      <div className="soundboard-add-header">
        <h3>Add Sound</h3>
        <button className="icon-btn" onClick={() => { resetForm(); onCancel(); }}><X size={16} /></button>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {/* Audio file */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Audio File</span>
        <span className="settings-row-desc">MP3, WAV, OGG, WebM, AAC — max 10 seconds (or trim below)</span>
        {!audioFile ? (
          <label className="soundboard-file-label">
            <Upload size={14} /> Choose audio file
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/aac"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAudioPick(f); }}
            />
          </label>
        ) : (
          <div className="soundboard-file-picked">
            <span>{audioFile.name}</span>
            <button className="icon-btn" onClick={() => { setAudioFile(null); setAudioBuffer(null); }}><X size={12} /></button>
          </div>
        )}
      </div>

      {/* Trim UI */}
      {audioBuffer && needsTrim && (
        <div className="settings-row settings-row-col">
          <span className="settings-row-label">Trim Selection (file is {audioDuration.toFixed(1)}s)</span>
          <WaveformCanvas
            audioBuffer={audioBuffer}
            startSec={startSec}
            endSec={endSec}
            duration={audioDuration}
            onStartChange={setStartSec}
            onEndChange={setEndSec}
          />
          <span className={`trim-duration-label${selDuration > 10 ? " over" : ""}`}>
            Selected: {selDuration.toFixed(1)}s / 10.0s max
          </span>
        </div>
      )}

      {/* Name */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Name</span>
        <input
          type="text"
          placeholder="e.g. Airhorn"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          className="settings-input"
        />
      </div>

      {/* Emoji */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Emoji</span>
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            className="emoji-picker-trigger"
            onClick={() => setShowEmojiPicker((o) => !o)}
            title="Choose emoji"
          >
            {emoji
              ? <span dangerouslySetInnerHTML={{ __html: renderEmoji(emoji, customEmojis, API_BASE) }} />
              : <span className="emoji-placeholder">🎵</span>}
          </div>
          {showEmojiPicker && (
            <EmojiPicker
              serverId={serverId}
              placement="right"
              onSelect={(e) => { setEmoji(e); setShowEmojiPicker(false); }}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
        </div>
      </div>

      {/* Volume */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Volume — {Math.round(volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {audioBuffer && (
          <button className="btn-small" onClick={handlePreview} disabled={selDuration > 10}>
            <Play size={12} /> {previewing ? "Stop" : "Preview"}
          </button>
        )}
        <button
          className="btn-small btn-primary"
          onClick={handleSave}
          disabled={saving || !audioBuffer || !name.trim() || selDuration > 10}
        >
          {saving ? "Saving..." : "Save Sound"}
        </button>
      </div>
    </div>
  );
}
