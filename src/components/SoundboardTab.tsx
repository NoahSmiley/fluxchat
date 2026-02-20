import { useState, useEffect, useRef } from "react";
import { Trash2, Play, Plus, X, Upload, Pencil } from "lucide-react";
import * as api from "../lib/api.js";
import type { SoundboardSound } from "../types/shared.js";
import { API_BASE } from "../lib/serverUrl.js";
import { useChatStore } from "../stores/chat.js";
import { renderEmoji } from "../lib/emoji.js";
import EmojiPicker from "./EmojiPicker.js";

// ── WAV encoder ───────────────────────────────────────────────────────────

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // int16
  const dataSize = numFrames * numChannels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  function writeUint32LE(offset: number, val: number) { view.setUint32(offset, val, true); }
  function writeUint16LE(offset: number, val: number) { view.setUint16(offset, val, true); }

  writeString(0, "RIFF");
  writeUint32LE(4, 36 + dataSize);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  writeUint32LE(16, 16); // subchunk1 size
  writeUint16LE(20, 1);  // PCM
  writeUint16LE(22, numChannels);
  writeUint32LE(24, sampleRate);
  writeUint32LE(28, sampleRate * numChannels * bytesPerSample); // byte rate
  writeUint16LE(32, numChannels * bytesPerSample); // block align
  writeUint16LE(34, 16); // bits per sample
  writeString(36, "data");
  writeUint32LE(40, dataSize);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = buffer.getChannelData(ch)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ── Waveform canvas ───────────────────────────────────────────────────────

function WaveformCanvas({
  audioBuffer,
  startSec,
  endSec,
  duration,
  onStartChange,
  onEndChange,
}: {
  audioBuffer: AudioBuffer;
  startSec: number;
  endSec: number;
  duration: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const samplesPerPx = Math.floor(data.length / W);

    ctx.clearRect(0, 0, W, H);

    // Draw waveform
    for (let x = 0; x < W; x++) {
      let max = 0;
      const startIdx = x * samplesPerPx;
      for (let s = 0; s < samplesPerPx; s++) {
        const v = Math.abs(data[startIdx + s] ?? 0);
        if (v > max) max = v;
      }
      const barH = Math.max(2, max * H);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, (H - barH) / 2, 1, barH);
    }

    // Draw selection region
    const selX1 = Math.round((startSec / duration) * W);
    const selX2 = Math.round((endSec / duration) * W);
    ctx.fillStyle = "rgba(88, 166, 255, 0.25)";
    ctx.fillRect(selX1, 0, selX2 - selX1, H);

    // Draw handles
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(selX1, 0, 3, H);
    ctx.fillRect(selX2 - 3, 0, 3, H);
  }, [audioBuffer, startSec, endSec, duration]);

  function secFromPointer(e: React.PointerEvent): number {
    const rect = wrapperRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function handlePointerDown(e: React.PointerEvent) {
    const sec = secFromPointer(e);
    const distToStart = Math.abs(sec - startSec);
    const distToEnd = Math.abs(sec - endSec);
    draggingRef.current = distToStart <= distToEnd ? "start" : "end";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const sec = secFromPointer(e);
    if (draggingRef.current === "start") {
      onStartChange(Math.max(0, Math.min(sec, endSec - 0.1)));
    } else {
      onEndChange(Math.min(duration, Math.max(sec, startSec + 0.1)));
    }
  }

  function handlePointerUp() {
    draggingRef.current = null;
  }

  return (
    <div
      ref={wrapperRef}
      className="trim-waveform-wrapper"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: "ew-resize" }}
    >
      <canvas ref={canvasRef} className="trim-waveform-canvas" width={600} height={64} />
    </div>
  );
}

// ── Main SoundboardTab ────────────────────────────────────────────────────

type View = "list" | "add" | "edit";

export function SoundboardTab({ serverId }: { serverId: string }) {
  const customEmojis = useChatStore((s) => s.customEmojis);
  const [view, setView] = useState<View>("list");
  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
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

  // Emoji picker state for add/edit forms
  const [showAddEmojiPicker, setShowAddEmojiPicker] = useState(false);
  const [showEditEmojiPicker, setShowEditEmojiPicker] = useState(false);

  // Edit state
  const [editingSound, setEditingSound] = useState<SoundboardSound | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editVolume, setEditVolume] = useState(0.8);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    api.getSoundboardSounds(serverId)
      .then(async (loadedSounds) => {
        setSounds(loadedSounds);
        // Clear any existing image attachments from sounds (images removed from feature)
        for (const sound of loadedSounds) {
          if (sound.imageAttachmentId) {
            try {
              const updated = await api.updateSoundboardSound(serverId, sound.id, {
                name: sound.name,
                emoji: sound.emoji ?? undefined,
                imageAttachmentId: null,
                volume: sound.volume,
              });
              setSounds((prev) => prev.map((s) => (s.id === sound.id ? updated : s)));
            } catch {}
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverId]);

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

      setSounds((prev) => [...prev, sound]);
      resetForm();
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sound");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(soundId: string) {
    try {
      await api.deleteSoundboardSound(serverId, soundId);
      setSounds((prev) => prev.filter((s) => s.id !== soundId));
    } catch {
      // ignore
    }
  }

  function handleEditStart(sound: SoundboardSound) {
    setEditingSound(sound);
    setEditName(sound.name);
    setEditEmoji(sound.emoji ?? "");
    setEditVolume(sound.volume);
    setEditError("");
    setView("edit");
  }

  function handleEditCancel() {
    setEditingSound(null);
    setView("list");
  }

  async function handleEditSave() {
    if (!editingSound || !editName.trim()) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await api.updateSoundboardSound(serverId, editingSound.id, {
        name: editName.trim(),
        emoji: editEmoji.trim() || undefined,
        imageAttachmentId: null,
        volume: editVolume,
      });
      setSounds((prev) => prev.map((s) => (s.id === editingSound.id ? updated : s)));
      setEditingSound(null);
      setView("list");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  const selDuration = endSec - startSec;
  const needsTrim = audioDuration > 10;

  if (view === "edit" && editingSound) {
    const audioUrl = `${API_BASE}/files/${editingSound.audioAttachmentId}/${editingSound.audioFilename}`;
    return (
      <div className="soundboard-add-form">
        <div className="soundboard-add-header">
          <h3>Edit Sound</h3>
          <button className="icon-btn" onClick={handleEditCancel}><X size={16} /></button>
        </div>

        {editError && <div className="auth-error">{editError}</div>}

        {/* Audio file — locked */}
        <div className="settings-row settings-row-col">
          <span className="settings-row-label">Audio File</span>
          <div className="soundboard-file-locked">
            <span>{editingSound.audioFilename}</span>
          </div>
        </div>

        {/* Name */}
        <div className="settings-row settings-row-col">
          <span className="settings-row-label">Name</span>
          <input
            type="text"
            placeholder="e.g. Airhorn"
            value={editName}
            maxLength={32}
            onChange={(e) => setEditName(e.target.value)}
            className="settings-input"
            autoFocus
          />
        </div>

        {/* Emoji */}
        <div className="settings-row settings-row-col">
          <span className="settings-row-label">Emoji</span>
          <div style={{ position: "relative", display: "inline-block" }}>
            <div
              className="emoji-picker-trigger"
              onClick={() => setShowEditEmojiPicker((o) => !o)}
              title="Choose emoji"
            >
              {editEmoji
                ? <span dangerouslySetInnerHTML={{ __html: renderEmoji(editEmoji, customEmojis, API_BASE) }} />
                : <span className="emoji-placeholder">🎵</span>}
            </div>
            {showEditEmojiPicker && (
              <EmojiPicker
                serverId={serverId}
                placement="right"
                onSelect={(e) => { setEditEmoji(e); setShowEditEmojiPicker(false); }}
                onClose={() => setShowEditEmojiPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Volume */}
        <div className="settings-row settings-row-col">
          <span className="settings-row-label">Volume — {Math.round(editVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={editVolume}
            onChange={(e) => setEditVolume(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            className="btn-small"
            onClick={() => { const a = new Audio(audioUrl); a.volume = editVolume; a.play().catch(() => {}); }}
          >
            <Play size={12} /> Preview
          </button>
          <button
            className="btn-small btn-primary"
            onClick={handleEditSave}
            disabled={editSaving || !editName.trim()}
          >
            {editSaving ? "Saving…" : "Save Sound"}
          </button>
        </div>
      </div>
    );
  }

  if (view === "add") {
    return (
      <div className="soundboard-add-form">
        <div className="soundboard-add-header">
          <h3>Add Sound</h3>
          <button className="icon-btn" onClick={() => { resetForm(); setView("list"); }}><X size={16} /></button>
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
              onClick={() => setShowAddEmojiPicker((o) => !o)}
              title="Choose emoji"
            >
              {emoji
                ? <span dangerouslySetInnerHTML={{ __html: renderEmoji(emoji, customEmojis, API_BASE) }} />
                : <span className="emoji-placeholder">🎵</span>}
            </div>
            {showAddEmojiPicker && (
              <EmojiPicker
                serverId={serverId}
                placement="right"
                onSelect={(e) => { setEmoji(e); setShowAddEmojiPicker(false); }}
                onClose={() => setShowAddEmojiPicker(false)}
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
            {saving ? "Saving…" : "Save Sound"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="soundboard-tab">
      <div className="soundboard-list-header">
        <p className="settings-card-desc">Sounds available in voice channels on this server.</p>
        <button className="btn-small btn-primary" onClick={() => setView("add")}>
          <Plus size={12} /> Add Sound
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading…</p>
      ) : sounds.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No sounds yet. Add one above.</p>
      ) : (
        <div className="soundboard-list">
          {sounds.map((sound) => {
            const audioUrl = `${API_BASE}/files/${sound.audioAttachmentId}/${sound.audioFilename}`;
            return (
              <div key={sound.id} className="soundboard-list-item">
                <div className="soundboard-list-icon">
                  {sound.emoji ? (
                    <span className="soundboard-btn-emoji" dangerouslySetInnerHTML={{ __html: renderEmoji(sound.emoji, customEmojis, API_BASE) }} />
                  ) : null}
                </div>
                <div className="soundboard-list-info">
                  <span className="soundboard-list-name">{sound.name}</span>
                  <span className="soundboard-list-vol">{Math.round(sound.volume * 100)}%</span>
                </div>
                <button
                  className="icon-btn"
                  title="Preview"
                  onClick={() => { const a = new Audio(audioUrl); a.volume = sound.volume; a.play().catch(() => {}); }}
                >
                  <Play size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Edit"
                  onClick={() => handleEditStart(sound)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  onClick={() => handleDelete(sound.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
