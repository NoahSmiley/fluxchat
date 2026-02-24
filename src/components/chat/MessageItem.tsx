import { Pencil, Trash2 } from "lucide-react";
import { MessageAttachments } from "./MessageAttachments.js";
import { LinkEmbed } from "./LinkEmbed.js";
import { avatarColor, ringClass, ringGradientStyle } from "@/lib/avatarColor.js";
import { relativeTime } from "@/lib/relativeTime.js";
import { renderEmoji, TWEMOJI_OPTIONS } from "@/lib/emoji.js";
import { API_BASE } from "@/lib/serverUrl.js";
import EmojiPicker from "@/components/EmojiPicker.js";
import { getCharOffset, setCursorAtOffset } from "@/lib/contentEditable.js";
import twemoji from "twemoji";
import type { Message, CustomEmoji } from "@/types/shared.js";

const RELATIVE_STYLE: React.CSSProperties = { position: "relative" };

export interface MessageDataEntry {
  decoded: string;
  html: string;
  emojiOnly: boolean;
  urls: string[];
  isMentioned: boolean;
}

interface MessageItemProps {
  msg: Message;
  msgData: MessageDataEntry | undefined;
  senderName: string;
  senderImage: string | null;
  senderRing: { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null } | undefined;
  senderRole: string;
  msgReactions: { emoji: string; userIds: string[] }[];
  customEmojis: CustomEmoji[];
  usernameMap: Record<string, string>;
  channelNameMap: Record<string, string>;
  userId: string | undefined;
  activeServerId: string | null;
  isSearchResult: boolean;
  isEditing: boolean;
  emojiPickerMsgId: string | null;
  editDivRef: React.RefObject<HTMLDivElement | null>;
  onContextMenu: (e: React.MouseEvent) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSubmitEdit: () => void;
  onDelete: () => void;
  onToggleEmojiPicker: () => void;
  onReactionPickerSelect: (emoji: string) => void;
  onReactionPickerClose: () => void;
  onReactionClick: (emoji: string, hasReacted: boolean) => void;
  onReactionTooltipEnter: (e: React.MouseEvent, emoji: string, userIds: string[]) => void;
  onReactionTooltipLeave: () => void;
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

export function MessageItem({
  msg, msgData, senderName, senderImage, senderRing, senderRole,
  msgReactions, customEmojis, usernameMap, channelNameMap,
  userId, activeServerId, isSearchResult, isEditing, emojiPickerMsgId,
  editDivRef, onContextMenu, onStartEditing, onCancelEditing, onSubmitEdit,
  onDelete, onToggleEmojiPicker, onReactionPickerSelect, onReactionPickerClose,
  onReactionClick, onReactionTooltipEnter, onReactionTooltipLeave,
}: MessageItemProps) {
  const decoded = msgData?.decoded ?? "";
  const rc = ringClass(senderRing?.ringStyle, senderRing?.ringSpin, senderRole, false, senderRing?.ringPatternSeed);
  const isOwn = msg.senderId === userId;

  return (
    <div
      className={`message ${isOwn ? "own" : ""} ${msgData?.isMentioned ? "mentioned" : ""}`}
      onContextMenu={onContextMenu}
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
          {isSearchResult && (
            <span className="search-result-channel">#{channelNameMap[msg.channelId] ?? "unknown"}</span>
          )}
          <span className="message-time" title={new Date(msg.createdAt).toLocaleString()}>{relativeTime(msg.createdAt)}</span>
        </div>
        <div className="message-body">
          {isEditing ? (
            <div className="message-edit-form">
              <div
                ref={editDivRef}
                contentEditable
                suppressContentEditableWarning
                className="message-edit-input"
                onInput={() => { if (editDivRef.current) applyTwemoji(editDivRef.current); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmitEdit(); }
                  if (e.key === "Escape") onCancelEditing();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData?.getData("text/plain") ?? "";
                  document.execCommand("insertText", false, text);
                  if (editDivRef.current) applyTwemoji(editDivRef.current);
                }}
              />
              <div className="message-edit-actions">
                <button className="btn-small" onClick={onCancelEditing}>Cancel</button>
                <button className="btn-small btn-primary" onClick={onSubmitEdit}>Save</button>
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
            {msgReactions.map(({ emoji, userIds }) => {
              const hasReacted = userIds.includes(userId ?? "");
              return (
                <button
                  key={emoji}
                  className={`reaction-chip ${hasReacted ? "own" : ""}`}
                  onClick={() => onReactionClick(emoji, hasReacted)}
                  onMouseEnter={(e) => onReactionTooltipEnter(e, emoji, userIds)}
                  onMouseLeave={onReactionTooltipLeave}
                >
                  <span dangerouslySetInnerHTML={{ __html: renderEmoji(emoji, customEmojis, API_BASE) }} /> {userIds.length}
                </button>
              );
            })}
          </div>
        )}

        <div className="message-actions">
          {isOwn && (
            <>
              <button className="reaction-add-btn edit-btn" onClick={onStartEditing} title="Edit message">
                <Pencil size={12} />
              </button>
              <button className="reaction-add-btn delete-btn" onClick={onDelete} title="Delete message">
                <Trash2 size={12} />
              </button>
            </>
          )}
          <div style={RELATIVE_STYLE}>
            <button className="reaction-add-btn" onClick={(e) => { e.stopPropagation(); onToggleEmojiPicker(); }}>
              +
            </button>
            {emojiPickerMsgId === msg.id && activeServerId && (
              <EmojiPicker
                serverId={activeServerId}
                placement="auto"
                onSelect={onReactionPickerSelect}
                onClose={onReactionPickerClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
