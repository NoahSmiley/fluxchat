import { useState, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore, base64ToUtf8 } from "../../stores/chat.js";
import { useDMStore } from "../../stores/dm.js";
import { useAuthStore } from "../../stores/auth.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../../lib/avatarColor.js";

const URL_REGEX = /https?:\/\/[^\s<]+/g;

function renderDMContent(text: string): ReactNode[] {
  const segments: ReactNode[] = [];
  let lastIndex = 0;

  URL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push(text.slice(lastIndex, m.index));
    }
    segments.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer">
        {m[0]}
      </a>
    );
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

export function DMChatView() {
  const {
    dmMessages, sendDM, loadMoreDMMessages, dmHasMore, loadingDMMessages,
    dmChannels, activeDMChannelId,
    searchDMMessages, dmSearchResults, dmSearchQuery, clearDMSearch,
    dmError, clearDmError, retryEncryptionSetup,
  } = useDMStore(useShallow((s) => ({
    dmMessages: s.dmMessages, sendDM: s.sendDM, loadMoreDMMessages: s.loadMoreDMMessages,
    dmHasMore: s.dmHasMore, loadingDMMessages: s.loadingDMMessages, dmChannels: s.dmChannels,
    activeDMChannelId: s.activeDMChannelId,
    searchDMMessages: s.searchDMMessages, dmSearchResults: s.dmSearchResults,
    dmSearchQuery: s.dmSearchQuery, clearDMSearch: s.clearDMSearch,
    dmError: s.dmError, clearDmError: s.clearDmError, retryEncryptionSetup: s.retryEncryptionSetup,
  })));
  const { onlineUsers, userStatuses, decryptedCache, members } = useChatStore(useShallow((s) => ({
    onlineUsers: s.onlineUsers, userStatuses: s.userStatuses,
    decryptedCache: s.decryptedCache, members: s.members,
  })));
  const user = useAuthStore((s) => s.user);
  const [input, setInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dm = dmChannels.find((d) => d.id === activeDMChannelId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dmMessages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    await sendDM(input);
    if (!useDMStore.getState().dmError) {
      setInput("");
    }
  }

  function handleScroll() {
    if (!containerRef.current) return;
    if (containerRef.current.scrollTop === 0 && dmHasMore && !loadingDMMessages) {
      loadMoreDMMessages();
    }
  }

  function decodeContent(msgId: string, ciphertext: string): string {
    const cached = decryptedCache[msgId];
    if (cached !== undefined) return cached;
    try {
      return base64ToUtf8(ciphertext);
    } catch {
      return "[encrypted message]";
    }
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      searchDMMessages(searchInput.trim());
    }
  }

  const displayMessages = dmSearchResults ?? dmMessages;

  // Look up other user's member data for banner
  const otherMember = dm ? members.find((m) => m.userId === dm.otherUser.id) : undefined;
  const dmBannerBg = bannerBackground(otherMember?.bannerCss, otherMember?.bannerPatternSeed);

  return (
    <div className="chat-view">
      {dmBannerBg && (
        <div className="dm-banner-strip" style={{ background: dmBannerBg }} />
      )}
      <div className="chat-header">
        <span className="dm-chat-title">
          {dm && (
            <>
              <span className={`status-dot ${userStatuses[dm.otherUser.id] ?? (onlineUsers.has(dm.otherUser.id) ? "online" : "offline")}`} />
              {dm.otherUser.username}
            </>
          )}
        </span>
        <div className="chat-header-actions">
          <form className="search-bar" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              placeholder="Search..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {dmSearchResults && (
              <button type="button" className="btn-small" onClick={() => { clearDMSearch(); setSearchInput(""); }}>
                Clear
              </button>
            )}
          </form>
        </div>
      </div>

      {dmSearchResults && (
        <div className="search-results-banner">
          {dmSearchResults.length} result{dmSearchResults.length !== 1 ? "s" : ""} for &quot;{dmSearchQuery}&quot;
        </div>
      )}

      <div className="messages-container" ref={containerRef} onScroll={handleScroll}>
        {loadingDMMessages && <div className="loading-messages">Loading...</div>}

        {displayMessages.map((msg) => {
          const isOwn = msg.senderId === user?.id;
          const senderName = isOwn ? (user?.username ?? "You") : (dm?.otherUser.username ?? msg.senderId.slice(0, 8));
          const senderImage = isOwn ? (user?.image ?? null) : (dm?.otherUser.image ?? null);
          const decoded = decodeContent(msg.id, msg.ciphertext);
          const senderMember = members.find((m) => m.userId === msg.senderId);
          const senderRingStyle = isOwn ? user?.ringStyle : senderMember?.ringStyle;
          const senderRingSpin = isOwn ? user?.ringSpin : senderMember?.ringSpin;
          const senderRingPatternSeed = isOwn ? user?.ringPatternSeed ?? null : senderMember?.ringPatternSeed ?? null;
          const rc = ringClass(senderRingStyle, senderRingSpin, senderMember?.role, false, senderRingPatternSeed);

          return (
            <div key={msg.id} className={`message ${isOwn ? "own" : ""}`}>
              <div className={`message-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(senderName), ...ringGradientStyle(senderRingPatternSeed, senderRingStyle as string) } as React.CSSProperties}>
                <div className="message-avatar">
                  {senderImage ? (
                    <img src={senderImage} alt={senderName} className="avatar-img" />
                  ) : (
                    <div className="avatar-fallback" style={{ background: avatarColor(senderName) }}>{senderName.charAt(0).toUpperCase()}</div>
                  )}
                </div>
              </div>
              <div className="message-content">
                <div className="message-header">
                  <span className="message-sender">{senderName}</span>
                  <span className="message-time">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="message-body">
                  {renderDMContent(decoded)}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {dmError && (
        <div className="dm-encryption-error">
          <span>{dmError}</span>
          <button onClick={retryEncryptionSetup}>Retry</button>
          <button onClick={clearDmError}>Dismiss</button>
        </div>
      )}
      <div className="message-input-wrapper">
        <form className="message-input-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="message-input"
            placeholder={dm ? `Message @${dm.otherUser.username}` : "Type a message..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-send" disabled={!input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
