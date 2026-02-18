import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent, type ReactNode, type KeyboardEvent, type DragEvent, type ClipboardEvent } from "react";
import { useChatStore, getUsernameMap, getUserImageMap, getUserRoleMap, getUserRingMap } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { ArrowUpRight, Pencil, Trash2, Paperclip, X } from "lucide-react";
import { MessageAttachments } from "./MessageAttachments.js";
import { LinkEmbed } from "./LinkEmbed.js";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";
import { relativeTime } from "../lib/relativeTime.js";
import { gateway } from "../lib/ws.js";

const QUICK_EMOJIS = ["👍", "👎", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "🗿"];

const URL_REGEX = /https?:\/\/[^\s<]+/g;
const MENTION_REGEX = /@([a-zA-Z0-9_-]+)/g;

function renderMessageContent(text: string, memberUsernames: Set<string>): ReactNode[] {
  const segments: ReactNode[] = [];
  let lastIndex = 0;

  const matches: { index: number; length: number; type: "url" | "mention"; value: string }[] = [];

  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    matches.push({ index: m.index, length: m[0].length, type: "url", value: m[0] });
  }
  MENTION_REGEX.lastIndex = 0;
  while ((m = MENTION_REGEX.exec(text)) !== null) {
    if (memberUsernames.has(m[1])) {
      matches.push({ index: m.index, length: m[0].length, type: "mention", value: m[0] });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  for (const match of matches) {
    if (match.index < lastIndex) continue;
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    if (match.type === "url") {
      segments.push(
        <a key={match.index} href={match.value} target="_blank" rel="noopener noreferrer">
          {match.value}
        </a>
      );
    } else {
      segments.push(
        <span key={match.index} className="mention">{match.value}</span>
      );
    }
    lastIndex = match.index + match.length;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

function extractUrls(text: string): string[] {
  URL_REGEX.lastIndex = 0;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    urls.push(match[0]);
  }
  return urls;
}


export function ChatView() {
  const {
    messages, sendMessage, editMessage, deleteMessage, loadMoreMessages, hasMoreMessages, loadingMessages,
    members, onlineUsers, userStatuses, reactions, addReaction, removeReaction,
    searchMessages, searchResults, searchQuery, clearSearch,
    channels, activeChannelId, decryptedCache,
    pendingAttachments, uploadProgress, uploadFile, removePendingAttachment,
    typingUsers,
  } = useChatStore();
  const { user } = useAuthStore();
  const [input, setInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mention autocomplete
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const usernameMap = useMemo(() => getUsernameMap(members), [members]);
  const imageMap = useMemo(() => getUserImageMap(members), [members]);
  const roleMap = useMemo(() => getUserRoleMap(members), [members]);
  const ringMap = useMemo(() => getUserRingMap(members), [members]);
  const memberUsernames = useMemo(() => new Set(members.map((m) => m.username)), [members]);

  // Typing indicator: who's typing in current channel (excluding self)
  const typingNames = useMemo(() => {
    if (!activeChannelId) return [];
    const typers = typingUsers[activeChannelId];
    if (!typers) return [];
    return Array.from(typers)
      .filter((id) => id !== user?.id)
      .map((id) => usernameMap[id] ?? id.slice(0, 8));
  }, [typingUsers, activeChannelId, user?.id, usernameMap]);

  const filteredMentions = useMemo(() => {
    if (!mentionActive) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => m.username.toLowerCase().includes(q) && m.userId !== user?.id).slice(0, 8);
  }, [mentionActive, mentionQuery, members, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!emojiPickerMsgId) return;
    const handler = () => setEmojiPickerMsgId(null);
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handler); };
  }, [emojiPickerMsgId]);

  const displayMessages = searchResults ?? messages;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() && pendingAttachments.length === 0) return;
    sendMessage(input);
    setInput("");
    setMentionActive(false);
    if (activeChannelId) gateway.send({ type: "typing_stop", channelId: activeChannelId });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }

  function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      uploadFile(file);
    }
  }

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, []);

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  function handleScroll() {
    if (!containerRef.current) return;
    if (containerRef.current.scrollTop === 0 && hasMoreMessages && !loadingMessages) {
      loadMoreMessages();
    }
  }

  function decodeContent(msgId: string, content: string): string {
    if (decryptedCache[msgId]) return decryptedCache[msgId];
    return content;
  }

  function handlePopOut() {
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "chat" })).catch(() => {});
  }


  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      searchMessages(searchInput.trim());
    }
  }

  function startEditing(msgId: string, currentText: string) {
    setEditingMsgId(msgId);
    setEditInput(currentText);
  }

  function cancelEditing() {
    setEditingMsgId(null);
    setEditInput("");
  }

  function submitEdit(msgId: string) {
    if (editInput.trim()) {
      editMessage(msgId, editInput.trim());
    }
    cancelEditing();
  }

  function handleInputChange(value: string) {
    setInput(value);
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/);
    if (atMatch) {
      setMentionActive(true);
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionActive(false);
    }

    // Send typing indicator
    if (activeChannelId && value.trim()) {
      gateway.send({ type: "typing_start", channelId: activeChannelId });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        if (activeChannelId) gateway.send({ type: "typing_stop", channelId: activeChannelId });
      }, 3000);
    }
  }

  function insertMention(username: string) {
    const cursorPos = inputRef.current?.selectionStart ?? input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return;
    const newInput = input.slice(0, atIndex) + `@${username} ` + input.slice(cursorPos);
    setInput(newInput);
    setMentionActive(false);
    setTimeout(() => {
      const newPos = atIndex + username.length + 2;
      inputRef.current?.setSelectionRange(newPos, newPos);
      inputRef.current?.focus();
    }, 0);
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (mentionActive && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab" || (e.key === "Enter" && mentionActive)) {
        e.preventDefault();
        insertMention(filteredMentions[mentionIndex].username);
      } else if (e.key === "Escape") {
        setMentionActive(false);
      }
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span className="chat-header-channel">{channels.find((c) => c.id === activeChannelId)?.name}</span>
        <div className="chat-header-actions">
          <form className="search-bar" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              placeholder="Search..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchResults && (
              <button type="button" className="btn-small" onClick={() => { clearSearch(); setSearchInput(""); }}>
                Clear
              </button>
            )}
          </form>
          <button className="btn-small popout-btn" onClick={handlePopOut} title="Pop out chat">
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      {searchResults && (
        <div className="search-results-banner">
          {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
        </div>
      )}

      <div
        className={`messages-container ${dragging ? "drag-active" : ""}`}
        ref={containerRef}
        onScroll={handleScroll}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragging && <div className="drag-overlay">Drop files to upload</div>}
        {loadingMessages && <div className="loading-messages">Loading...</div>}

        {displayMessages.map((msg) => {
          const senderName = usernameMap[msg.senderId] ?? (msg.senderId === user?.id ? (user?.username ?? msg.senderId.slice(0, 8)) : msg.senderId.slice(0, 8));
          const senderImage = imageMap[msg.senderId] ?? null;
          const senderRole = roleMap[msg.senderId] ?? "member";
          const senderRing = ringMap[msg.senderId];
          const msgReactions = reactions[msg.id] ?? [];
          const decoded = decodeContent(msg.id, msg.content);
          const rc = ringClass(senderRing?.ringStyle, senderRing?.ringSpin, senderRole, false, senderRing?.ringPatternSeed);

          return (
            <div key={msg.id} className={`message ${msg.senderId === user?.id ? "own" : ""}`}>
              <div className={`message-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(senderName), ...ringGradientStyle(senderRing?.ringPatternSeed, senderRing?.ringStyle) } as React.CSSProperties}>
                <div className="message-avatar">
                  {senderImage && <img src={senderImage} alt={senderName} className="avatar-img" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                  <div className="avatar-fallback" style={{ background: avatarColor(senderName) }}>{senderName.charAt(0).toUpperCase()}</div>
                </div>
              </div>
              <div className="message-content">
              <div className="message-header">
                <span className="message-sender">{senderName}</span>
                <span className="message-time" title={new Date(msg.createdAt).toLocaleString()}>{relativeTime(msg.createdAt)}</span>
              </div>
              <div className="message-body">
                {editingMsgId === msg.id ? (
                  <div className="message-edit-form">
                    <input
                      type="text"
                      className="message-edit-input"
                      value={editInput}
                      onChange={(e) => setEditInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitEdit(msg.id);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      autoFocus
                    />
                    <div className="message-edit-actions">
                      <button className="btn-small" onClick={cancelEditing}>Cancel</button>
                      <button className="btn-small btn-primary" onClick={() => submitEdit(msg.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {renderMessageContent(decoded, memberUsernames)}
                    {msg.editedAt && <span className="message-edited">(edited)</span>}
                  </>
                )}
              </div>

              {msg.attachments && msg.attachments.length > 0 && (
                <MessageAttachments attachments={msg.attachments} />
              )}

              {(() => {
                const urls = extractUrls(decoded);
                return urls.length > 0 ? (
                  <div className="message-embeds">
                    {urls.slice(0, 3).map((url) => (
                      <LinkEmbed key={url} url={url} />
                    ))}
                  </div>
                ) : null;
              })()}

              {msgReactions.length > 0 && (
                <div className="message-reactions">
                  {msgReactions.map(({ emoji, userIds }) => (
                    <button
                      key={emoji}
                      className={`reaction-chip ${userIds.includes(user?.id ?? "") ? "own" : ""}`}
                      onClick={() =>
                        userIds.includes(user?.id ?? "")
                          ? removeReaction(msg.id, emoji)
                          : addReaction(msg.id, emoji)
                      }
                      title={userIds.map((id) => usernameMap[id] ?? id.slice(0, 8)).join(", ")}
                    >
                      {emoji} {userIds.length}
                    </button>
                  ))}
                </div>
              )}

              <div className="message-actions">
                {msg.senderId === user?.id && (
                  <>
                    <button
                      className="reaction-add-btn edit-btn"
                      onClick={() => startEditing(msg.id, decoded)}
                      title="Edit message"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="reaction-add-btn delete-btn"
                      onClick={() => deleteMessage(msg.id)}
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
                <button
                  className="reaction-add-btn"
                  onClick={(e) => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id); }}
                >
                  +
                </button>
                {emojiPickerMsgId === msg.id && (
                  <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => { addReaction(msg.id, emoji); setEmojiPickerMsgId(null); }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="typing-indicator">
          <span className="typing-dots"><span /><span /><span /></span>
          <span className="typing-text">
            {typingNames.length === 1
              ? `${typingNames[0]} is typing`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing`
                : `${typingNames[0]} and ${typingNames.length - 1} others are typing`
            }
          </span>
        </div>
      )}

      <div className="message-input-wrapper">
        {mentionActive && filteredMentions.length > 0 && (
          <div className="mention-autocomplete">
            {filteredMentions.map((m, i) => (
              <button
                key={m.userId}
                className={`mention-option ${i === mentionIndex ? "selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}
              >
                <div className="mention-avatar-wrapper">
                  {m.image ? (
                    <img src={m.image} alt={m.username} className="mention-avatar" />
                  ) : (
                    <span className="mention-avatar mention-avatar-fallback" style={{ background: avatarColor(m.username) }}>{m.username.charAt(0).toUpperCase()}</span>
                  )}
                  <span className={`mention-status-dot ${userStatuses[m.userId] ?? (onlineUsers.has(m.userId) ? "online" : "offline")}`} />
                </div>
                <span className="mention-username">{m.username}</span>
                {(() => { const s = userStatuses[m.userId] ?? (onlineUsers.has(m.userId) ? "online" : "offline"); return s === "offline" ? <span className="mention-offline-label">Offline</span> : s === "idle" ? <span className="mention-offline-label">Idle</span> : s === "dnd" ? <span className="mention-offline-label">DND</span> : null; })()}
              </button>
            ))}
          </div>
        )}
        {(pendingAttachments.length > 0 || Object.keys(uploadProgress).length > 0) && (
          <div className="pending-attachments">
            {pendingAttachments.map((att) => (
              <div key={att.id} className="pending-attachment">
                <span className="pending-attachment-name">{att.filename}</span>
                <button className="pending-attachment-remove" onClick={() => removePendingAttachment(att.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {Object.entries(uploadProgress)
              .filter(([name]) => !pendingAttachments.some((a) => a.filename === name))
              .map(([name, pct]) => (
                <div key={name} className="pending-attachment uploading">
                  <span className="pending-attachment-name">{name}</span>
                  <div className="upload-progress">
                    <div className="upload-progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
          </div>
        )}
        <form className="message-input-form" onSubmit={handleSubmit}>
          <button
            type="button"
            className="btn-attach"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="file-input-hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={inputRef}
            type="text"
            className="message-input"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
            autoFocus
          />
          <button type="submit" className="btn-send" disabled={!input.trim() && pendingAttachments.length === 0}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
