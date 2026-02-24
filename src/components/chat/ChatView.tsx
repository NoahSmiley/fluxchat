import { useState, useRef, useEffect, useMemo, useCallback, type DragEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore, getUsernameMap, getUserImageMap, getUserRoleMap, getUserRingMap } from "../../stores/chat.js";
import { useAuthStore } from "../../stores/auth.js";
import { useUIStore } from "../../stores/ui.js";
import { renderMessageContent, isEmojiOnly } from "../../lib/emoji.js";
import { API_BASE } from "../../lib/serverUrl.js";
import { EVERYONE_MENTION_RE, HERE_MENTION_RE } from "../../stores/chat-types.js";

import { ChatHeader } from "./ChatHeader.js";
import { MessageList } from "./MessageList.js";
import { MessageInput } from "./MessageInput.js";

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
  } = useChatStore(useShallow((s) => ({
    messages: s.messages, sendMessage: s.sendMessage, editMessage: s.editMessage,
    deleteMessage: s.deleteMessage, loadMoreMessages: s.loadMoreMessages,
    hasMoreMessages: s.hasMoreMessages, loadingMessages: s.loadingMessages,
    members: s.members, onlineUsers: s.onlineUsers, userStatuses: s.userStatuses,
    reactions: s.reactions, addReaction: s.addReaction, removeReaction: s.removeReaction,
    searchResults: s.searchResults, searchQuery: s.searchQuery, searchFilters: s.searchFilters,
    searchUserActivity: s.searchUserActivity, channels: s.channels,
    activeChannelId: s.activeChannelId, activeServerId: s.activeServerId,
    decryptedCache: s.decryptedCache, pendingAttachments: s.pendingAttachments,
    uploadProgress: s.uploadProgress, uploadFile: s.uploadFile,
    removePendingAttachment: s.removePendingAttachment,
    typingUsers: s.typingUsers, customEmojis: s.customEmojis,
  })));
  const { user } = useAuthStore();
  const { highlightOwnMessages, spellcheck, showSendButton, setSpellcheck, setShowSendButton } = useUIStore();

  const inputValueRef = useRef("");
  const [hasContent, setHasContent] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.innerHTML = "";
    inputValueRef.current = "";
    setHasContent(false);
  }, [activeChannelId]);

  const displayMessages = searchResults ?? messages;

  // Cache expensive per-message work (twemoji.parse, regex, mention detection) so it doesn't re-run on keystrokes
  const messageData = useMemo(() => {
    const userMentionRe = user ? new RegExp(`(?<![a-zA-Z0-9_])@${user.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z0-9_])`, "i") : null;
    return new Map(displayMessages.map((msg) => {
      const decoded = decryptedCache[msg.id] ?? msg.content ?? "";
      return [msg.id, {
        decoded,
        html: renderMessageContent(decoded, customEmojis, API_BASE, memberUsernames),
        emojiOnly: isEmojiOnly(decoded, customEmojis),
        urls: extractUrls(decoded),
        isMentioned: !!user && (
          EVERYONE_MENTION_RE.test(msg.content) ||
          HERE_MENTION_RE.test(msg.content) ||
          (userMentionRe?.test(msg.content) ?? false)
        ),
      }];
    }));
  }, [displayMessages, decryptedCache, customEmojis, memberUsernames, user]);

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
      for (const file of Array.from(e.dataTransfer.files)) {
        uploadFile(file);
      }
    }
  }, [uploadFile]);

  return (
    <div className="chat-view">
      <ChatHeader
        channels={channels}
        activeChannelId={activeChannelId}
        searchResults={searchResults}
        searchQuery={searchQuery}
        searchFilters={searchFilters}
      />

      <MessageList
        displayMessages={displayMessages}
        messageData={messageData}
        usernameMap={usernameMap}
        imageMap={imageMap}
        roleMap={roleMap}
        ringMap={ringMap}
        channelNameMap={channelNameMap}
        reactions={reactions}
        customEmojis={customEmojis}
        userId={user?.id}
        userUsername={user?.username}
        activeServerId={activeServerId}
        searchResults={searchResults}
        highlightOwnMessages={highlightOwnMessages}
        hasMoreMessages={hasMoreMessages}
        loadingMessages={loadingMessages}
        loadMoreMessages={loadMoreMessages}
        addReaction={addReaction}
        removeReaction={removeReaction}
        editMessage={editMessage}
        deleteMessage={deleteMessage}
        dragging={dragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        typingNames={typingNames}
        containerRef={containerRef}
        messagesEndRef={messagesEndRef}
      />

      <MessageInput
        activeChannelId={activeChannelId}
        activeServerId={activeServerId}
        members={members}
        onlineUsers={onlineUsers}
        userStatuses={userStatuses}
        userId={user?.id}
        pendingAttachments={pendingAttachments}
        uploadProgress={uploadProgress}
        removePendingAttachment={removePendingAttachment}
        sendMessage={sendMessage}
        uploadFile={uploadFile}
        spellcheck={spellcheck}
        setSpellcheck={setSpellcheck}
        showSendButton={showSendButton}
        setShowSendButton={setShowSendButton}
        inputRef={inputRef}
        inputValueRef={inputValueRef}
        hasContent={hasContent}
        setHasContent={setHasContent}
      />
    </div>
  );
}
