import { useState, useEffect } from "react";
import { useChatStore } from "../stores/chat.js";
import { Plus } from "lucide-react";
import * as api from "../lib/api.js";

export function DMSidebar() {
  const { dmChannels, activeDMChannelId, selectDM, openDM, loadDMChannels, onlineUsers } = useChatStore();
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([]);

  useEffect(() => {
    loadDMChannels();
  }, [loadDMChannels]);

  async function handleSearchInput(value: string) {
    setSearchInput(value);
    if (!value.trim()) { setSearchResults([]); return; }
    try {
      const results = await api.searchUsers(value.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }

  function handleStartDM(userId: string) {
    openDM(userId);
    setShowSearch(false);
    setSearchInput("");
    setSearchResults([]);
  }

  const sorted = [...dmChannels].sort((a, b) => {
    const aOnline = onlineUsers.has(a.otherUser.id) ? 0 : 1;
    const bOnline = onlineUsers.has(b.otherUser.id) ? 0 : 1;
    return aOnline - bOnline;
  });

  return (
    <div className="channel-sidebar dm-sidebar">
      <div className="channel-sidebar-header" />

      <div className="dm-header-row">
        <span className="dm-header-label">Messages</span>
        <button
          className="dm-add-btn"
          onClick={() => setShowSearch(!showSearch)}
          title="New Message"
        >
          <Plus size={16} />
        </button>
      </div>

      {showSearch && (
        <div className="dm-search-panel">
          <input
            type="text"
            placeholder="Search users..."
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            autoFocus
          />
          {searchResults.map((u) => (
            <button key={u.id} className="dm-search-result" onClick={() => handleStartDM(u.id)}>
              <span className={`status-dot ${onlineUsers.has(u.id) ? "online" : "offline"}`} />
              {u.username}
            </button>
          ))}
        </div>
      )}

      <div className="channel-list">
        {sorted.map((dm) => {
          const isOnline = onlineUsers.has(dm.otherUser.id);
          return (
            <button
              key={dm.id}
              className={`dm-item ${dm.id === activeDMChannelId ? "active" : ""}`}
              onClick={() => selectDM(dm.id)}
            >
              <div className="dm-item-avatar">
                {dm.otherUser.image ? (
                  <img src={dm.otherUser.image} alt={dm.otherUser.username} />
                ) : (
                  dm.otherUser.username.charAt(0).toUpperCase()
                )}
                <span className={`dm-status-dot ${isOnline ? "online" : "offline"}`} />
              </div>
              <span className="dm-item-name">{dm.otherUser.username}</span>
            </button>
          );
        })}
        {dmChannels.length === 0 && !showSearch && (
          <div className="dm-empty">No conversations yet</div>
        )}
      </div>
    </div>
  );
}
