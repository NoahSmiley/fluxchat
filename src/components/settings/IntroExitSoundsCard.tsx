import { useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth.js";
import { uploadFile } from "@/lib/api/messages.js";
import { audioBufferToWav, WaveformCanvas } from "@/components/music/SoundboardWaveform.js";
import { API_BASE } from "@/lib/serverUrl.js";
import { Upload, Play, Square, Trash2 } from "lucide-react";

const MAX_DURATION = 10;
const ACCEPTED_FORMATS = ".mp3,.wav,.ogg,.webm,.aac";

function SoundSection({ label, currentUrl, onSave, onRemove }: {
  label: string;
  currentUrl?: string | null;
  onSave: (attachmentId: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const handleFile = async (file: File) => {
    const ctx = new AudioContext();
    const arrayBuf = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    ctx.close();
    setAudioBuffer(decoded);
    setStartSec(0);
    setEndSec(Math.min(decoded.duration, MAX_DURATION));
  };

  const handleSave = async () => {
    if (!audioBuffer) return;
    setSaving(true);
    try {
      const sampleRate = audioBuffer.sampleRate;
      const startFrame = Math.floor(startSec * sampleRate);
      const endFrame = Math.floor(endSec * sampleRate);
      const length = endFrame - startFrame;

      let trimmed: AudioBuffer;
      if (length < audioBuffer.length) {
        const offline = new OfflineAudioContext(audioBuffer.numberOfChannels, length, sampleRate);
        const src = offline.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(offline.destination);
        src.start(0, startSec, endSec - startSec);
        trimmed = await offline.startRendering();
      } else {
        trimmed = audioBuffer;
      }

      const wavBlob = audioBufferToWav(trimmed);
      const wavFile = new File([wavBlob], "sound.wav", { type: "audio/wav" });
      const attachment = await uploadFile(wavFile);
      await onSave(attachment.id);
      setAudioBuffer(null);
    } catch (err) {
      console.error("Failed to save sound:", err);
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
      setPreviewing(false);
      return;
    }
    const url = currentUrl ? `${API_BASE}${currentUrl}` : null;
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.volume = 0.5;
      audio.onended = () => { URL.revokeObjectURL(blobUrl); previewRef.current = null; setPreviewing(false); };
      audio.onerror = () => { URL.revokeObjectURL(blobUrl); previewRef.current = null; setPreviewing(false); };
      previewRef.current = audio;
      setPreviewing(true);
      await audio.play();
    } catch (err) {
      console.error("Preview failed:", err);
      previewRef.current = null;
      setPreviewing(false);
    }
  };

  return (
    <div className="settings-sound-section">
      <div className="settings-sound-header">
        <div className="settings-sound-info">
          <span className="settings-row-label">{label}</span>
          <span className="settings-row-desc">
            {currentUrl && !audioBuffer ? "Custom sound set" : !audioBuffer ? "Default chime" : null}
          </span>
        </div>
        <div className="settings-sound-actions">
          {currentUrl && (
            <>
              <button className="settings-sound-icon-btn" onClick={handlePreview} title={previewing ? "Stop" : "Preview"}>
                {previewing ? <Square size={14} /> : <Play size={14} />}
              </button>
              <button className="settings-sound-icon-btn settings-sound-icon-btn--danger" onClick={onRemove} title="Remove">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button className="btn-small" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> {currentUrl ? "Replace" : "Upload"}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_FORMATS}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {audioBuffer && (
        <div className="settings-sound-editor">
          <WaveformCanvas
            audioBuffer={audioBuffer}
            startSec={startSec}
            endSec={endSec}
            duration={audioBuffer.duration}
            onStartChange={setStartSec}
            onEndChange={(v) => setEndSec(Math.min(v, startSec + MAX_DURATION))}
          />
          <div className="settings-sound-editor-actions">
            <span className="settings-row-desc">
              {(endSec - startSec).toFixed(1)}s / {MAX_DURATION}s max
            </span>
            <div className="settings-sound-editor-btns">
              <button className="btn-small" onClick={() => setAudioBuffer(null)}>Cancel</button>
              <button className="btn-small btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntroExitSoundsCard() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">Join & Leave Sounds</h3>
      <p className="settings-row-desc" style={{ marginBottom: 12 }}>
        Custom sounds that play when you join or leave a voice channel. Other participants hear your sound. Max {MAX_DURATION} seconds.
      </p>
      <SoundSection
        label="Intro Sound (Join)"
        currentUrl={user?.introSoundUrl}
        onSave={async (id) => { await updateProfile({ introSoundAttachmentId: id }); }}
        onRemove={async () => { await updateProfile({ introSoundAttachmentId: null }); }}
      />
      <SoundSection
        label="Exit Sound (Leave)"
        currentUrl={user?.exitSoundUrl}
        onSave={async (id) => { await updateProfile({ exitSoundAttachmentId: id }); }}
        onRemove={async () => { await updateProfile({ exitSoundAttachmentId: null }); }}
      />
    </div>
  );
}
