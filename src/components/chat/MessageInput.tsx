import { useState, useRef, useCallback, useMemo, type FormEvent, type RefObject } from "react";
import { Paperclip, X, Smile } from "lucide-react";
import { avatarColor } from "@/lib/avatarColor.js";
import { gateway } from "@/lib/ws.js";
import twemoji from "twemoji";
import { TWEMOJI_OPTIONS } from "@/lib/emoji.js";
import EmojiPicker from "@/components/EmojiPicker.js";
import ContextMenu from "@/components/ContextMenu.js";
import { getCharOffset, setCursorAtOffset, getDivPlainText, getTextBeforeCursor } from "@/lib/contentEditable.js";
import type { MemberWithUser, Attachment } from "@/types/shared.js";

type MentionEntry =
  | { kind: "special"; name: string; desc: string }
  | { kind: "user"; member: MemberWithUser };

interface MessageInputProps {
  activeChannelId: string | null;
  activeServerId: string | null;
  members: MemberWithUser[];
  onlineUsers: Set<string>;
  userStatuses: Record<string, string>;
  userId: string | undefined;
  pendingAttachments: Attachment[];
  uploadProgress: Record<string, number>;
  removePendingAttachment: (id: string) => void;
  sendMessage: (content: string) => void;
  uploadFile: (file: File) => Promise<void>;
  spellcheck: boolean;
  setSpellcheck: (v: boolean) => void;
  showSendButton: boolean;
  setShowSendButton: (v: boolean) => void;
  inputRef: RefObject<HTMLDivElement | null>;
  inputValueRef: React.MutableRefObject<string>;
  hasContent: boolean;
  setHasContent: (v: boolean) => void;
}

function applyTwemoji(div: HTMLDivElement) {
  const sel = window.getSelection();
  let offset = 0;
  if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
    offset = getCharOffset(div, sel.getRangeAt(0));
  }
  twemoji.parse(div, TWEMOJI_OPTIONS as any);
  setCursorAtOffset(div, offset);
}

function statusLabel(s: string) {
  if (s === "offline") return <span className="mention-offline-label">Offline</span>;
  if (s === "idle") return <span className="mention-offline-label">Idle</span>;
  if (s === "dnd") return <span className="mention-offline-label">DND</span>;
  return null;
}

export function MessageInput({
  activeChannelId, activeServerId, members, onlineUsers, userStatuses, userId,
  pendingAttachments, uploadProgress, removePendingAttachment, sendMessage,
  uploadFile, spellcheck, setSpellcheck, showSendButton, setShowSendButton,
  inputRef, inputValueRef, hasContent, setHasContent,
}: MessageInputProps) {
  const [inputEmojiOpen, setInputEmojiOpen] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [chatboxMenu, setChatboxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputCursorRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredMentions = useMemo((): MentionEntry[] => {
    if (!mentionActive) return [];
    const q = mentionQuery.toLowerCase();
    const specials: MentionEntry[] = [];
    if ("everyone".startsWith(q)) specials.push({ kind: "special", name: "everyone", desc: "Notify all members" });
    if ("here".startsWith(q)) specials.push({ kind: "special", name: "here", desc: "Notify online members" });
    const users: MentionEntry[] = members
      .filter((m) => m.username.toLowerCase().includes(q) && m.userId !== userId)
      .slice(0, 8)
      .map((m) => ({ kind: "user", member: m }));
    return [...specials, ...users];
  }, [mentionActive, mentionQuery, members, userId]);

  function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) uploadFile(file);
  }

  function doSubmit() {
    if (!inputValueRef.current.trim() && pendingAttachments.length === 0) return;
    sendMessage(inputValueRef.current);
    if (inputRef.current) inputRef.current.innerHTML = "";
    inputValueRef.current = "";
    setHasContent(false);
    setMentionActive(false);
    if (activeChannelId) gateway.send({ type: "typing_stop", channelId: activeChannelId });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }

  function handleSubmit(e: FormEvent) { e.preventDefault(); doSubmit(); }

  function handleDivInput() {
    const div = inputRef.current;
    if (!div) return;
    applyTwemoji(div);
    handleInputChange(getDivPlainText(div));
  }

  function handleDivPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) { e.preventDefault(); handleFiles(files); return; }
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
    handleDivInput();
  }

  function insertTextAtCursor(text: string) {
    const div = inputRef.current;
    if (!div) return;
    div.focus();
    setCursorAtOffset(div, inputCursorRef.current);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      range.setStartAfter(tn); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    } else {
      div.innerText = getDivPlainText(div) + text;
    }
    applyTwemoji(div);
    const newText = getDivPlainText(div);
    inputValueRef.current = newText;
    const nonEmpty = newText.trim().length > 0;
    if (nonEmpty !== hasContent) setHasContent(nonEmpty);
  }

  function handleInputChange(value: string) {
    inputValueRef.current = value;
    const nonEmpty = value.trim().length > 0;
    if (nonEmpty !== hasContent) setHasContent(nonEmpty);
    const textBeforeCursor = inputRef.current ? getTextBeforeCursor(inputRef.current) : value;
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    if (atMatch) { setMentionActive(true); setMentionQuery(atMatch[1]); setMentionIndex(0); }
    else { setMentionActive(false); }
    if (activeChannelId && value.trim()) {
      gateway.send({ type: "typing_start", channelId: activeChannelId });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        if (activeChannelId) gateway.send({ type: "typing_stop", channelId: activeChannelId });
      }, 3000);
    }
  }

  function insertMention(username: string) {
    const div = inputRef.current;
    if (!div) return;
    const textBeforeCursor = getTextBeforeCursor(div);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return;
    const fullText = getDivPlainText(div);
    const newText = fullText.slice(0, atIndex) + `@${username} ` + fullText.slice(textBeforeCursor.length);
    div.innerText = newText;
    twemoji.parse(div, TWEMOJI_OPTIONS as any);
    setCursorAtOffset(div, atIndex + username.length + 2);
    inputValueRef.current = newText;
    const nonEmpty = newText.trim().length > 0;
    if (nonEmpty !== hasContent) setHasContent(nonEmpty);
    setMentionActive(false);
  }

  function handleDivKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (mentionActive && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); const entry = filteredMentions[mentionIndex]; insertMention(entry.kind === "special" ? entry.name : entry.member.username); return; }
      if (e.key === "Escape")    { setMentionActive(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); }
  }

  const handlePasteClick = useCallback(async () => {
    setChatboxMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) { inputRef.current?.focus(); document.execCommand("insertText", false, text); }
    } catch { /* Clipboard access denied */ }
  }, [inputRef]);

  const hasPending = pendingAttachments.length > 0 || Object.keys(uploadProgress).length > 0;

  return (
    <>
      <div className="message-input-wrapper">
        {mentionActive && filteredMentions.length > 0 && (
          <div className="mention-autocomplete">
            {filteredMentions.map((entry, i) => {
              if (entry.kind === "special") return (
                <button key={entry.name} className={`mention-option ${i === mentionIndex ? "selected" : ""}`} onMouseDown={(e) => { e.preventDefault(); insertMention(entry.name); }}>
                  <div className="mention-avatar-wrapper"><span className="mention-avatar mention-avatar-fallback mention-special-icon">@</span></div>
                  <span className="mention-username">@{entry.name}</span>
                  <span className="mention-offline-label">{entry.desc}</span>
                </button>
              );
              const m = entry.member;
              const s = userStatuses[m.userId] ?? (onlineUsers.has(m.userId) ? "online" : "offline");
              return (
                <button key={m.userId} className={`mention-option ${i === mentionIndex ? "selected" : ""}`} onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}>
                  <div className="mention-avatar-wrapper">
                    {m.image
                      ? <img src={m.image} alt={m.username} className="mention-avatar" />
                      : <span className="mention-avatar mention-avatar-fallback" style={{ background: avatarColor(m.username) }}>{m.username.charAt(0).toUpperCase()}</span>}
                    <span className={`mention-status-dot ${s}`} />
                  </div>
                  <span className="mention-username">{m.username}</span>
                  {statusLabel(s)}
                </button>
              );
            })}
          </div>
        )}
        {hasPending && (
          <div className="pending-attachments">
            {pendingAttachments.map((att) => (
              <div key={att.id} className="pending-attachment">
                <span className="pending-attachment-name">{att.filename}</span>
                <button className="pending-attachment-remove" onClick={() => removePendingAttachment(att.id)}><X size={12} /></button>
              </div>
            ))}
            {Object.entries(uploadProgress)
              .filter(([name]) => !pendingAttachments.some((a) => a.filename === name))
              .map(([name, pct]) => (
                <div key={name} className="pending-attachment uploading">
                  <span className="pending-attachment-name">{name}</span>
                  <div className="upload-progress"><div className="upload-progress-bar" style={{ width: `${pct}%` }} /></div>
                </div>
              ))}
          </div>
        )}
        <form className="message-input-form" onSubmit={handleSubmit}>
          <button type="button" className="btn-attach" onClick={() => fileInputRef.current?.click()} title="Attach file"><Paperclip size={18} /></button>
          <input ref={fileInputRef} type="file" multiple className="file-input-hidden" onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />
          <div
            ref={inputRef} contentEditable suppressContentEditableWarning spellCheck={spellcheck}
            className="message-input" data-testid="message-input" data-placeholder="Type a message..."
            onInput={handleDivInput} onKeyDown={handleDivKeyDown} onPaste={handleDivPaste}
            onContextMenu={(e) => { e.preventDefault(); setChatboxMenu({ x: e.clientX, y: e.clientY }); }}
            onBlur={() => {
              const div = inputRef.current; const sel = window.getSelection();
              if (div && sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) inputCursorRef.current = getCharOffset(div, sel.getRangeAt(0));
            }}
            autoFocus
          />
          <button type="button" className="btn-attach" onClick={() => setInputEmojiOpen((o) => !o)} title="Emoji"><Smile size={18} /></button>
          {inputEmojiOpen && activeServerId && (
            <EmojiPicker serverId={activeServerId} onSelect={(emoji) => { insertTextAtCursor(emoji); setInputEmojiOpen(false); }} onClose={() => setInputEmojiOpen(false)} placement="auto" />
          )}
          {showSendButton && <button type="submit" className="btn-send" disabled={!hasContent && pendingAttachments.length === 0}>Send</button>}
        </form>
      </div>

      {chatboxMenu && (
        <ContextMenu x={chatboxMenu.x} y={chatboxMenu.y} onClose={() => setChatboxMenu(null)} items={[
          { label: "Paste", onClick: handlePasteClick },
          { type: "separator" },
          { label: "Spellcheck", checked: spellcheck, onClick: () => setSpellcheck(!spellcheck) },
          { label: "Show send button", checked: showSendButton, onClick: () => setShowSendButton(!showSendButton) },
        ]} />
      )}
    </>
  );
}
