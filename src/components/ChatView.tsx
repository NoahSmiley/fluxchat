import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useChatStore, getUsernameMap, getUserImageMap, getUserRoleMap, getUserRingMap } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { useUIStore } from "../stores/ui.js";
import { ArrowUpRight, Pencil, Trash2, Paperclip, X, Smile } from "lucide-react";
import { SearchBar } from "./SearchBar.js";
import { MessageAttachments } from "./MessageAttachments.js";
import { LinkEmbed } from "./LinkEmbed.js";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";
import { relativeTime } from "../lib/relativeTime.js";
import { gateway } from "../lib/ws.js";
import twemoji from "twemoji";
import { renderMessageContent, renderEmoji, isEmojiOnly, getEmojiLabel, TWEMOJI_OPTIONS } from "../lib/emoji.js";
import { API_BASE } from "../lib/serverUrl.js";
import EmojiPicker from "./EmojiPicker.js";
import ContextMenu from "./ContextMenu.js";

// ── Contenteditable helpers ───────────────────────────────────────────────

/** Count chars to range.startContainer/startOffset, treating each twemoji <img> as 1 char. */
function getCharOffset(root: HTMLElement, range: Range): number {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node === range.startContainer) { count += range.startOffset; break; }
    if (node.nodeType === Node.TEXT_NODE) count += (node as Text).length;
    else if ((node as Element).tagName === "IMG") count += 1;
    node = walker.nextNode();
  }
  return count;
}

/** Place cursor at charOffset inside root, treating each twemoji <img> as 1 char. */
function setCursorAtOffset(root: HTMLElement, charOffset: number): void {
  let remaining = charOffset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).length;
      if (remaining <= len) {
        const r = document.createRange();
        r.setStart(node, remaining); r.collapse(true);
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
        return;
      }
      remaining -= len;
    } else if ((node as Element).tagName === "IMG") {
      if (remaining === 0) {
        const r = document.createRange();
        r.setStartBefore(node); r.collapse(true);
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
        return;
      }
      remaining -= 1;
    }
    node = walker.nextNode();
  }
  const r = document.createRange();
  r.selectNodeContents(root); r.collapse(false);
  const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
}

/** Read plain text, treating twemoji <img> alt as the original emoji char. */
function getDivPlainText(div: HTMLElement): string {
  let text = "";
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
    else if ((node as Element).tagName === "IMG") text += (node as Element).getAttribute("alt") ?? "";
    node = walker.nextNode();
  }
  return text;
}

/** Plain text from start-of-div to current cursor (for @mention detection). */
function getTextBeforeCursor(div: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(div, 0);
  const frag = range.cloneContents();
  let text = "";
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
    else if ((node as Element).tagName === "IMG") text += (node as Element).getAttribute("alt") ?? "";
    node = walker.nextNode();
  }
  return text;
}

// ── URL extraction ────────────────────────────────────────────────────────

const EXTRACT_URL_REGEX = /https?:\/\/[^\s<]+/g;

function extractUrls(text: string): string[] {
  if (!text) return [];
  EXTRACT_URL_REGEX.lastIndex = 0;
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = EXTRACT_URL_REGEX.exec(text)) !== null) {
    urls.push(match[0]);
  }
  return urls;
}


export function ChatView() {
  const {
    messages, sendMessage, editMessage, deleteMessage, loadMoreMessages, hasMoreMessages, loadingMessages,
    members, onlineUsers, userStatuses, reactions, addReaction, removeReaction,
    searchResults, searchQuery, searchFilters, searchUserActivity,
    channels, activeChannelId, activeServerId, decryptedCache,
    pendingAttachments, uploadProgress, uploadFile, removePendingAttachment,
    typingUsers, customEmojis,
  } = useChatStore();
  const { user } = useAuthStore();
  const { highlightOwnMessages, spellcheck, showSendButton, setSpellcheck, setShowSendButton } = useUIStore();
  const inputValueRef = useRef(""); // stores current input text without triggering re-renders
  const [hasContent, setHasContent] = useState(false); // only flips at empty↔non-empty boundary
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
  // Stable callbacks so EmojiPicker's dismiss-on-outside-click effect doesn't re-register on every render
  const handleReactionPickerClose = useCallback(() => setEmojiPickerMsgId(null), []);
  const handleReactionPickerSelect = useCallback((emoji: string) => {
    if (emojiPickerMsgId) addReaction(emojiPickerMsgId, emoji);
    setEmojiPickerMsgId(null);
  }, [emojiPickerMsgId, addReaction]);
  const [inputEmojiOpen, setInputEmojiOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  const [emojiTooltip, setEmojiTooltip] = useState<{ x: number; y: number; src: string; label: string; subtitle: string } | null>(null);
  const [reactionTooltip, setReactionTooltip] = useState<{ x: number; y: number; emojiHtml: string; label: string; users: string[] } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiTooltipActiveRef = useRef(false); // guard against redundant setEmojiTooltip(null) calls
  const [chatboxMenu, setChatboxMenu] = useState<{ x: number; y: number } | null>(null);
  const [msgMenu, setMsgMenu] = useState<{
    x: number; y: number;
    msgId: string;
    isOwnMsg: boolean;
    decoded: string;
    contextLink: string | null;
    contextImgSrc: string | null;
  } | null>(null);

  // Mention autocomplete
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLDivElement>(null);
  const inputCursorRef = useRef(0); // saved cursor offset for emoji-picker insert-at-cursor
  const editDivRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const usernameMap = useMemo(() => getUsernameMap(members), [members]);
  const imageMap = useMemo(() => getUserImageMap(members), [members]);
  const roleMap = useMemo(() => getUserRoleMap(members), [members]);
  const ringMap = useMemo(() => getUserRingMap(members), [members]);
  const memberUsernames = useMemo(() => new Set(members.map((m) => m.username)), [members]);
  const channelNameMap = useMemo(() => Object.fromEntries(channels.map((c) => [c.id, c.name])), [channels]);

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

  useEffect(() => {
    if (inputRef.current) inputRef.current.innerHTML = "";
    inputValueRef.current = "";
    setHasContent(false);
  }, [activeChannelId]);

  // Initialize edit div with twemoji-rendered content when editing starts
  useEffect(() => {
    if (!editingMsgId || !editDivRef.current) return;
    const div = editDivRef.current;
    div.innerText = editInput;
    twemoji.parse(div, TWEMOJI_OPTIONS as any);
    setCursorAtOffset(div, getDivPlainText(div).length);
    div.focus();
  }, [editingMsgId, editInput]);

  const displayMessages = searchResults ?? messages;

  // Cache expensive per-message work (twemoji.parse, regex) so it doesn't re-run on keystrokes
  const messageData = useMemo(() => {
    return new Map(displayMessages.map((msg) => {
      const decoded = decryptedCache[msg.id] ?? msg.content ?? "";
      return [msg.id, {
        decoded,
        html: renderMessageContent(decoded, customEmojis, API_BASE, memberUsernames),
        emojiOnly: isEmojiOnly(decoded, customEmojis),
        urls: extractUrls(decoded),
      }];
    }));
  }, [displayMessages, decryptedCache, customEmojis, memberUsernames]);

  function formatReactors(users: string[]): string {
    if (users.length === 0) return "";
    if (users.length === 1) return users[0];
    if (users.length === 2) return `${users[0]} and ${users[1]}`;
    const rest = users.length - 2;
    return `${users[0]}, ${users[1]}, and ${rest} other${rest === 1 ? "" : "s"}`;
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

  function applyTwemoji(div: HTMLDivElement) {
    const sel = window.getSelection();
    let offset = 0;
    if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
      offset = getCharOffset(div, sel.getRangeAt(0));
    }
    twemoji.parse(div, TWEMOJI_OPTIONS as any);
    setCursorAtOffset(div, offset);
  }

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
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
    handleDivInput();
  }

  function insertTextAtCursor(text: string) {
    const div = inputRef.current;
    if (!div) return;
    div.focus();
    // Restore the cursor to where it was before focus left the input (e.g., clicking emoji button)
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

  function handleMsgMouseOver(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    // Don't trigger tooltip for emojis inside the emoji picker panel or reaction chips
    if (target.closest(".emoji-picker-panel") || target.closest(".reaction-chip")) return;
    if (!(target instanceof HTMLImageElement)) {
      if (emojiTooltipActiveRef.current) { emojiTooltipActiveRef.current = false; setEmojiTooltip(null); }
      return;
    }
    const isStd = target.classList.contains("emoji");
    const isCustom = target.classList.contains("custom-emoji");
    if (!isStd && !isCustom) {
      if (emojiTooltipActiveRef.current) { emojiTooltipActiveRef.current = false; setEmojiTooltip(null); }
      return;
    }
    const rect = target.getBoundingClientRect();
    emojiTooltipActiveRef.current = true;
    if (isCustom) {
      const uploader = target.dataset.uploader ?? "Unknown";
      setEmojiTooltip({ x: rect.left + rect.width / 2, y: rect.top, src: target.src, label: target.alt, subtitle: `${uploader}'s emoji` });
    } else {
      setEmojiTooltip({ x: rect.left + rect.width / 2, y: rect.top, src: target.src, label: target.dataset.emojiId ?? target.alt, subtitle: "standard emoji" });
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
    return content ?? "";
  }

  function handlePopOut() {
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "chat" })).catch(() => {});
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
    const text = editDivRef.current ? getDivPlainText(editDivRef.current).trim() : editInput.trim();
    if (text) {
      editMessage(msgId, text);
    }
    cancelEditing();
  }

  function handleInputChange(value: string) {
    inputValueRef.current = value;
    const nonEmpty = value.trim().length > 0;
    if (nonEmpty !== hasContent) setHasContent(nonEmpty);
    const div = inputRef.current;
    const textBeforeCursor = div ? getTextBeforeCursor(div) : value;
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
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); insertMention(filteredMentions[mentionIndex].username); return; }
      if (e.key === "Escape")    { setMentionActive(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSubmit(); }
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span className="chat-header-channel">{channels.find((c) => c.id === activeChannelId)?.name}</span>
        <div className="chat-header-actions">
          <SearchBar />
          <button className="btn-small popout-btn" onClick={handlePopOut} title="Pop out chat">
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      {searchResults && (
        <div className="search-results-banner">
          {(() => {
            const parts: string[] = [];
            if (searchQuery) parts.push(`"${searchQuery}"`);
            if (searchFilters.fromUsername) parts.push(`from ${searchFilters.fromUsername}`);
            if (searchFilters.inChannelName) parts.push(`in #${searchFilters.inChannelName}`);
            if (searchFilters.has) parts.push(`has: ${searchFilters.has}`);
            if (searchFilters.mentionsUsername) parts.push(`mentions @${searchFilters.mentionsUsername}`);
            if (searchFilters.before) parts.push(`before ${searchFilters.before}`);
            if (searchFilters.on) parts.push(`on ${searchFilters.on}`);
            if (searchFilters.after) parts.push(`after ${searchFilters.after}`);
            return `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}${parts.length > 0 ? " — " + parts.join(", ") : ""}`;
          })()}
        </div>
      )}

      <div
        className={`messages-container ${highlightOwnMessages ? "highlight-own" : ""} ${dragging ? "drag-active" : ""}`}
        ref={containerRef}
        onScroll={handleScroll}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseOver={handleMsgMouseOver}
        onMouseLeave={() => { if (emojiTooltipActiveRef.current) { emojiTooltipActiveRef.current = false; setEmojiTooltip(null); } }}
      >
        {dragging && <div className="drag-overlay">Drop files to upload</div>}
        {loadingMessages && <div className="loading-messages">Loading...</div>}

        {displayMessages.map((msg) => {
          const senderName = usernameMap[msg.senderId] ?? (msg.senderId === user?.id ? (user?.username ?? msg.senderId.slice(0, 8)) : msg.senderId.slice(0, 8));
          const senderImage = imageMap[msg.senderId] ?? null;
          const senderRole = roleMap[msg.senderId] ?? "member";
          const senderRing = ringMap[msg.senderId];
          const msgReactions = reactions[msg.id] ?? [];
          const msgData = messageData.get(msg.id);
          const decoded = msgData?.decoded ?? "";
          const rc = ringClass(senderRing?.ringStyle, senderRing?.ringSpin, senderRole, false, senderRing?.ringPatternSeed);

          return (
            <div
              key={msg.id}
              className={`message ${msg.senderId === user?.id ? "own" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                const link = target.closest("a") as HTMLAnchorElement | null;
                const img = (target instanceof HTMLImageElement && !target.classList.contains("emoji") && !target.classList.contains("custom-emoji"))
                  ? target : null;
                setMsgMenu({ x: e.clientX, y: e.clientY, msgId: msg.id, isOwnMsg: msg.senderId === user?.id, decoded, contextLink: link?.href ?? null, contextImgSrc: img?.src ?? null });
              }}
            >
              <div className={`message-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(senderName), ...ringGradientStyle(senderRing?.ringPatternSeed, senderRing?.ringStyle) } as React.CSSProperties}>
                <div className="message-avatar">
                  {senderImage && <img src={senderImage} alt={senderName} className="avatar-img" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                  <div className="avatar-fallback" style={{ background: avatarColor(senderName) }}>{senderName.charAt(0).toUpperCase()}</div>
                </div>
              </div>
              <div className="message-content">
              <div className="message-header">
                <span className="message-sender">{senderName}</span>
                {searchResults && (
                  <span className="search-result-channel">#{channelNameMap[msg.channelId] ?? "unknown"}</span>
                )}
                <span className="message-time" title={new Date(msg.createdAt).toLocaleString()}>{relativeTime(msg.createdAt)}</span>
              </div>
              <div className="message-body">
                {editingMsgId === msg.id ? (
                  <div className="message-edit-form">
                    <div
                      ref={editDivRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="message-edit-input"
                      onInput={() => { if (editDivRef.current) applyTwemoji(editDivRef.current); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id); }
                        if (e.key === "Escape") cancelEditing();
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const text = e.clipboardData?.getData("text/plain") ?? "";
                        document.execCommand("insertText", false, text);
                        if (editDivRef.current) applyTwemoji(editDivRef.current);
                      }}
                    />
                    <div className="message-edit-actions">
                      <button className="btn-small" onClick={cancelEditing}>Cancel</button>
                      <button className="btn-small btn-primary" onClick={() => submitEdit(msg.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={msgData?.emojiOnly ? "big-emoji" : undefined} dangerouslySetInnerHTML={{ __html: msgData?.html ?? "" }} />
                    {msg.editedAt && <span className="message-edited">(edited)</span>}
                  </>
                )}
              </div>

              {msg.attachments && msg.attachments.length > 0 && (
                <MessageAttachments attachments={msg.attachments} />
              )}

              {msgData && msgData.urls.length > 0 && (
                <div className="message-embeds">
                  {msgData.urls.slice(0, 3).map((url) => (
                    <LinkEmbed key={url} url={url} />
                  ))}
                </div>
              )}

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
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setReactionTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          emojiHtml: renderEmoji(emoji, customEmojis, API_BASE),
                          label: getEmojiLabel(emoji),
                          users: userIds.map((id) => usernameMap[id] ?? id.slice(0, 8)),
                        });
                      }}
                      onMouseLeave={() => setReactionTooltip(null)}
                    >
                      <span dangerouslySetInnerHTML={{ __html: renderEmoji(emoji, customEmojis, API_BASE) }} /> {userIds.length}
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
                      onClick={() => setDeletingMsgId(msg.id)}
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
                <div style={{ position: "relative" }}>
                  <button
                    className="reaction-add-btn"
                    onClick={(e) => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id); }}
                  >
                    +
                  </button>
                  {emojiPickerMsgId === msg.id && activeServerId && (
                    <EmojiPicker
                      serverId={activeServerId}
                      placement="auto"
                      onSelect={handleReactionPickerSelect}
                      onClose={handleReactionPickerClose}
                    />
                  )}
                </div>
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

      {emojiTooltip && (
        <div className="emoji-msg-tooltip" style={{ left: emojiTooltip.x, top: emojiTooltip.y - 8 }}>
          <img src={emojiTooltip.src} alt={emojiTooltip.label} className="emoji-msg-tooltip-img" />
          <div className="emoji-msg-tooltip-label">{emojiTooltip.label}</div>
          <div className="emoji-msg-tooltip-sub">{emojiTooltip.subtitle}</div>
        </div>
      )}

      {reactionTooltip && (
        <div className="reaction-tooltip" style={{ left: reactionTooltip.x, top: reactionTooltip.y - 8 }}>
          <span className="reaction-tooltip-emoji" dangerouslySetInnerHTML={{ __html: reactionTooltip.emojiHtml }} />
          <div>
            <div className="reaction-tooltip-label">{reactionTooltip.label}</div>
            <div className="reaction-tooltip-users">reacted by {formatReactors(reactionTooltip.users)}</div>
          </div>
        </div>
      )}

      {deletingMsgId && (() => {
        const preview = messageData.get(deletingMsgId)?.decoded ?? "";
        const trimmed = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
        return createPortal(
          <div className="modal-overlay" onClick={() => setDeletingMsgId(null)}>
            <div className="modal confirm-delete-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Delete Message</h3>
              {trimmed && <p className="confirm-delete-preview">"{trimmed}"</p>}
              <p className="confirm-delete-desc">This cannot be undone.</p>
              <div className="modal-actions">
                <button className="btn-small" onClick={() => setDeletingMsgId(null)}>Cancel</button>
                <button
                  className="btn-small btn-danger"
                  onClick={() => { deleteMessage(deletingMsgId); setDeletingMsgId(null); }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

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
          <div
            ref={inputRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={spellcheck}
            className="message-input"
            data-testid="message-input"
            data-placeholder="Type a message..."
            onInput={handleDivInput}
            onKeyDown={handleDivKeyDown}
            onPaste={handleDivPaste}
            onContextMenu={(e) => { e.preventDefault(); setChatboxMenu({ x: e.clientX, y: e.clientY }); }}
            onBlur={() => {
              const div = inputRef.current;
              const sel = window.getSelection();
              if (div && sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
                inputCursorRef.current = getCharOffset(div, sel.getRangeAt(0));
              }
            }}
            autoFocus
          />
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn-attach"
              onClick={() => setInputEmojiOpen((o) => !o)}
              title="Emoji"
            >
              <Smile size={18} />
            </button>
            {inputEmojiOpen && activeServerId && (
              <EmojiPicker
                serverId={activeServerId}
                onSelect={(emoji) => { insertTextAtCursor(emoji); setInputEmojiOpen(false); }}
                onClose={() => setInputEmojiOpen(false)}
              />
            )}
          </div>
          {showSendButton && (
            <button type="submit" className="btn-send" disabled={!hasContent && pendingAttachments.length === 0}>
              Send
            </button>
          )}
        </form>
      </div>

      {chatboxMenu && (
        <ContextMenu
          x={chatboxMenu.x}
          y={chatboxMenu.y}
          onClose={() => setChatboxMenu(null)}
          items={[
            {
              label: "Paste",
              onClick: async () => {
                setChatboxMenu(null);
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) {
                    inputRef.current?.focus();
                    document.execCommand("insertText", false, text);
                  }
                } catch {
                  // Clipboard access denied — silently ignore
                }
              },
            },
            { type: "separator" },
            {
              label: "Spellcheck",
              checked: spellcheck,
              onClick: () => setSpellcheck(!spellcheck),
            },
            {
              label: "Show send button",
              checked: showSendButton,
              onClick: () => setShowSendButton(!showSendButton),
            },
          ]}
        />
      )}

      {msgMenu && (
        <ContextMenu
          x={msgMenu.x}
          y={msgMenu.y}
          onClose={() => setMsgMenu(null)}
          items={[
            ...(msgMenu.isOwnMsg ? [{ label: "Edit message", onClick: () => { startEditing(msgMenu.msgId, msgMenu.decoded); setMsgMenu(null); } }] : []),
            { label: "Add reaction", onClick: () => { setEmojiPickerMsgId(msgMenu.msgId); setMsgMenu(null); } },
            ...(msgMenu.decoded.trim() ? [{ label: "Copy text", onClick: () => { navigator.clipboard.writeText(msgMenu.decoded); setMsgMenu(null); } }] : []),
            ...(msgMenu.contextLink ? [
              { type: "separator" as const },
              { label: "Open link", onClick: () => { window.open(msgMenu.contextLink!, "_blank"); setMsgMenu(null); } },
              { label: "Copy link", onClick: () => { navigator.clipboard.writeText(msgMenu.contextLink!); setMsgMenu(null); } },
            ] : []),
            ...(msgMenu.contextImgSrc ? [
              { type: "separator" as const },
              { label: "Open image", onClick: () => { window.open(msgMenu.contextImgSrc!, "_blank"); setMsgMenu(null); } },
              { label: "Save image", onClick: () => { const a = document.createElement("a"); a.href = msgMenu.contextImgSrc!; a.download = ""; a.click(); setMsgMenu(null); } },
            ] : []),
          ]}
        />
      )}
    </div>
  );
}
