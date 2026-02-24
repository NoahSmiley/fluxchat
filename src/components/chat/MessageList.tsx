import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { createPortal } from "react-dom";
import twemoji from "twemoji";
import { renderEmoji, getEmojiLabel, TWEMOJI_OPTIONS } from "@/lib/emoji.js";
import { API_BASE } from "@/lib/serverUrl.js";
import ContextMenu from "@/components/ContextMenu.js";
import { setCursorAtOffset, getDivPlainText } from "@/lib/contentEditable.js";
import { MessageItem, type MessageDataEntry } from "./MessageItem.js";
import type { Message, CustomEmoji } from "@/types/shared.js";

export type { MessageDataEntry };

export interface MessageListProps {
  displayMessages: Message[];
  messageData: Map<string, MessageDataEntry>;
  usernameMap: Record<string, string>;
  imageMap: Record<string, string | null>;
  roleMap: Record<string, string>;
  ringMap: Record<string, { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null }>;
  channelNameMap: Record<string, string>;
  reactions: Record<string, { emoji: string; userIds: string[] }[]>;
  customEmojis: CustomEmoji[];
  userId: string | undefined;
  userUsername: string | undefined;
  activeServerId: string | null;
  searchResults: Message[] | null;
  highlightOwnMessages: boolean;
  hasMoreMessages: boolean;
  loadingMessages: boolean;
  loadMoreMessages: () => Promise<void>;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  deleteMessage: (messageId: string) => void;
  dragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  typingNames: string[];
  containerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

function formatReactors(users: string[]): string {
  if (users.length === 0) return "";
  if (users.length === 1) return users[0];
  if (users.length === 2) return `${users[0]} and ${users[1]}`;
  const rest = users.length - 2;
  return `${users[0]}, ${users[1]}, and ${rest} other${rest === 1 ? "" : "s"}`;
}

export function MessageList({
  displayMessages, messageData, usernameMap, imageMap, roleMap, ringMap,
  channelNameMap, reactions, customEmojis, userId, userUsername, activeServerId,
  searchResults, highlightOwnMessages, hasMoreMessages, loadingMessages,
  loadMoreMessages, addReaction, removeReaction, editMessage, deleteMessage,
  dragging, onDragOver, onDragLeave, onDrop, typingNames, containerRef, messagesEndRef,
}: MessageListProps) {
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  const [emojiTooltip, setEmojiTooltip] = useState<{ x: number; y: number; src: string; label: string; subtitle: string } | null>(null);
  const [reactionTooltip, setReactionTooltip] = useState<{ x: number; y: number; emojiHtml: string; label: string; users: string[] } | null>(null);
  const [msgMenu, setMsgMenu] = useState<{
    x: number; y: number; msgId: string; isOwnMsg: boolean;
    decoded: string; contextLink: string | null; contextImgSrc: string | null;
  } | null>(null);
  const emojiTooltipActiveRef = useRef(false);
  const editDivRef = useRef<HTMLDivElement>(null);

  const handleReactionPickerClose = useCallback(() => setEmojiPickerMsgId(null), []);
  const handleReactionPickerSelect = useCallback((emoji: string) => {
    if (emojiPickerMsgId) addReaction(emojiPickerMsgId, emoji);
    setEmojiPickerMsgId(null);
  }, [emojiPickerMsgId, addReaction]);

  useEffect(() => {
    if (!editingMsgId || !editDivRef.current) return;
    const div = editDivRef.current;
    div.innerText = editInput;
    twemoji.parse(div, TWEMOJI_OPTIONS as any);
    setCursorAtOffset(div, getDivPlainText(div).length);
    div.focus();
  }, [editingMsgId, editInput]);

  function startEditing(msgId: string, currentText: string) { setEditingMsgId(msgId); setEditInput(currentText); }
  function cancelEditing() { setEditingMsgId(null); setEditInput(""); }
  function submitEdit(msgId: string) {
    const text = editDivRef.current ? getDivPlainText(editDivRef.current).trim() : editInput.trim();
    if (text) editMessage(msgId, text);
    cancelEditing();
  }

  function handleScroll() {
    if (!containerRef.current) return;
    if (containerRef.current.scrollTop === 0 && hasMoreMessages && !loadingMessages) loadMoreMessages();
  }

  function handleMsgMouseOver(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
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

  function handleReactionTooltipEnter(e: React.MouseEvent, emoji: string, userIds: string[]) {
    const rect = e.currentTarget.getBoundingClientRect();
    setReactionTooltip({
      x: rect.left + rect.width / 2, y: rect.top,
      emojiHtml: renderEmoji(emoji, customEmojis, API_BASE),
      label: getEmojiLabel(emoji),
      users: userIds.map((id) => usernameMap[id] ?? id.slice(0, 8)),
    });
  }

  const isSearchResult = !!searchResults;

  return (
    <>
      <div
        className={`messages-container ${highlightOwnMessages ? "highlight-own" : ""} ${dragging ? "drag-active" : ""}`}
        ref={containerRef}
        onScroll={handleScroll}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onMouseOver={handleMsgMouseOver}
        onMouseLeave={() => { if (emojiTooltipActiveRef.current) { emojiTooltipActiveRef.current = false; setEmojiTooltip(null); } }}
      >
        {dragging && <div className="drag-overlay">Drop files to upload</div>}
        {loadingMessages && <div className="loading-messages">Loading...</div>}

        {displayMessages.map((msg) => {
          const senderName = usernameMap[msg.senderId] ?? (msg.senderId === userId ? (userUsername ?? msg.senderId.slice(0, 8)) : msg.senderId.slice(0, 8));
          return (
            <MessageItem
              key={msg.id}
              msg={msg}
              msgData={messageData.get(msg.id)}
              senderName={senderName}
              senderImage={imageMap[msg.senderId] ?? null}
              senderRole={roleMap[msg.senderId] ?? "member"}
              senderRing={ringMap[msg.senderId]}
              msgReactions={reactions[msg.id] ?? []}
              customEmojis={customEmojis}
              usernameMap={usernameMap}
              channelNameMap={channelNameMap}
              userId={userId}
              activeServerId={activeServerId}
              isSearchResult={isSearchResult}
              isEditing={editingMsgId === msg.id}
              emojiPickerMsgId={emojiPickerMsgId}
              editDivRef={editDivRef}
              onContextMenu={(e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                const link = target.closest("a") as HTMLAnchorElement | null;
                const decoded = messageData.get(msg.id)?.decoded ?? "";
                const img = (target instanceof HTMLImageElement && !target.classList.contains("emoji") && !target.classList.contains("custom-emoji")) ? target : null;
                setMsgMenu({ x: e.clientX, y: e.clientY, msgId: msg.id, isOwnMsg: msg.senderId === userId, decoded, contextLink: link?.href ?? null, contextImgSrc: img?.src ?? null });
              }}
              onStartEditing={() => startEditing(msg.id, messageData.get(msg.id)?.decoded ?? "")}
              onCancelEditing={cancelEditing}
              onSubmitEdit={() => submitEdit(msg.id)}
              onDelete={() => setDeletingMsgId(msg.id)}
              onToggleEmojiPicker={() => setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id)}
              onReactionPickerSelect={handleReactionPickerSelect}
              onReactionPickerClose={handleReactionPickerClose}
              onReactionClick={(emoji, hasReacted) => hasReacted ? removeReaction(msg.id, emoji) : addReaction(msg.id, emoji)}
              onReactionTooltipEnter={handleReactionTooltipEnter}
              onReactionTooltipLeave={() => setReactionTooltip(null)}
            />
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
        const trimmed = preview.length > 80 ? preview.slice(0, 80) + "\u2026" : preview;
        return createPortal(
          <div className="modal-overlay" onClick={() => setDeletingMsgId(null)}>
            <div className="modal confirm-delete-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Delete Message</h3>
              {trimmed && <p className="confirm-delete-preview">"{trimmed}"</p>}
              <p className="confirm-delete-desc">This cannot be undone.</p>
              <div className="modal-actions">
                <button className="btn-small" onClick={() => setDeletingMsgId(null)}>Cancel</button>
                <button className="btn-small btn-danger" onClick={() => { deleteMessage(deletingMsgId); setDeletingMsgId(null); }}>Delete</button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

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
    </>
  );
}
