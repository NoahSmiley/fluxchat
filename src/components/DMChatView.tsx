import { useState, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

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

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function DMChatView() {
  const {
    dmMessages, sendDM, loadMoreDMMessages, dmHasMore, loadingMessages,
    dmChannels, activeDMChannelId, onlineUsers,
  } = useChatStore();
  const { user } = useAuthStore();
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dm = dmChannels.find((d) => d.id === activeDMChannelId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dmMessages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    sendDM(input);
    setInput("");
  }

  function handleScroll() {
    if (!containerRef.current) return;
    if (containerRef.current.scrollTop === 0 && dmHasMore && !loadingMessages) {
      loadMoreDMMessages();
    }
  }

  function decodeContent(ciphertext: string): string {
    try {
      return atob(ciphertext);
    } catch {
      return "[encrypted message]";
    }
  }

  function handleCopy(text: string, id: string) {
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span className="dm-chat-title">
          {dm && (
            <>
              <span className={`status-dot ${onlineUsers.has(dm.otherUser.id) ? "online" : "offline"}`} />
              {dm.otherUser.username}
            </>
          )}
        </span>
      </div>

      <div className="messages-container" ref={containerRef} onScroll={handleScroll}>
        {loadingMessages && <div className="loading-messages">Loading...</div>}

        {dmMessages.map((msg) => {
          const isOwn = msg.senderId === user?.id;
          const senderName = isOwn ? (user?.username ?? "You") : (dm?.otherUser.username ?? msg.senderId.slice(0, 8));
          const senderImage = isOwn ? (user?.image ?? null) : (dm?.otherUser.image ?? null);
          const decoded = decodeContent(msg.ciphertext);

          return (
            <div key={msg.id} className={`message ${isOwn ? "own" : ""}`}>
              <div className="message-avatar">
                {senderImage ? (
                  <img src={senderImage} alt={senderName} className="avatar-img" />
                ) : (
                  <div className="avatar-fallback">{senderName.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <div className="message-content">
                <div className="message-header">
                  <span
                    className={`message-sender ${copiedId === `s-${msg.id}` ? "copied" : ""}`}
                    onClick={() => handleCopy(senderName, `s-${msg.id}`)}
                    title="Click to copy username"
                  >
                    {senderName}
                  </span>
                  <span
                    className={`message-time ${copiedId === `t-${msg.id}` ? "copied" : ""}`}
                    onClick={() => handleCopy(new Date(msg.createdAt).toLocaleString(), `t-${msg.id}`)}
                    title="Click to copy timestamp"
                  >
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </span>
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
