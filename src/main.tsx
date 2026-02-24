import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { PopoutApp } from "./PopoutApp.js";
import { isPopout } from "./lib/broadcast.js";
import "./styles/base.css";
import "./styles/layout-main.css";
import "./styles/layout-grid.css";
import "./styles/sidebar-server.css";
import "./styles/sidebar-channels.css";
import "./styles/sidebar-items.css";
import "./styles/chat-messages.css";
import "./styles/chat-context.css";
import "./styles/chat-editing.css";
import "./styles/search-bar.css";
import "./styles/search-results.css";
import "./styles/modals-base.css";
import "./styles/modals-specific.css";
import "./styles/voice-channel.css";
import "./styles/voice-controls.css";
import "./styles/voice-sidebar.css";
import "./styles/voice-rooms.css";
import "./styles/screen-share-viewer.css";
import "./styles/screen-share-controls.css";
import "./styles/settings-layout.css";
import "./styles/settings-controls.css";
import "./styles/settings-appearance.css";
import "./styles/emoji-picker.css";
import "./styles/emoji-grid.css";
import "./styles/dm-sidebar.css";
import "./styles/dm-members.css";
import "./styles/dm-usercard.css";
import "./styles/music-player.css";
import "./styles/music-visualizer.css";
import "./styles/music-controls.css";
import "./styles/music-search.css";
import "./styles/music-queue.css";
import "./styles/soundboard-panel.css";
import "./styles/soundboard-tab.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPopout() ? (
      <PopoutApp />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>
);
