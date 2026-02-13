import { useState, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import type { Message } from "../types/shared.js";
import { onStateUpdate, sendCommand, type ChatStateMessage, type StateMessage } from "../lib/broadcast.js";
import { base64ToUtf8 } from "../stores/chat.js";

const URL_REGEX = /https?:\/\/[^\s<]+/g;

function renderMessageContent(text: string): ReactNode[] {
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push(text.slice(lastIndex, m.index));
    segments.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segments.push(text.slice(lastIndex));
  return segments.length > 0 ? segments : [text];
}

export function PopoutChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelName, setChannelName] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleState = (msg: StateMessage) => {
      if (msg.type === "chat-state") {
        const chatMsg = msg as ChatStateMessage;
        setMessages(chatMsg.messages);
        setChannelName(chatMsg.channelName);
      }
    };
    const cleanup = onStateUpdate(handleState);
    sendCommand({ type: "request-state" });
    return cleanup;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    sendCommand({ type: "send-message", content: input });
    setInput("");
  }

  function decodeContent(ciphertext: string): string {
    try {
      return base64ToUtf8(ciphertext);
    } catch {
      return "[encrypted message]";
    }
  }

  return (
    <div className="popout-chat">
      <div className="popout-header">
        <span>{channelName ? `# ${channelName}` : "Chat"}</span>
      </div>
      <div className="messages-container popout-messages">
        {messages.map((msg) => (
          <div key={msg.id} className="message">
            <div className="message-header">
              <span className="message-sender">{msg.senderId.slice(0, 8)}</span>
              <span className="message-time">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-body">{renderMessageContent(decodeContent(msg.ciphertext))}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="message-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="message-input"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-send" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
