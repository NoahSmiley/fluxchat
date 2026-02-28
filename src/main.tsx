import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { PopoutApp } from "./PopoutApp.js";
import { isPopout } from "./lib/broadcast.js";
import { initThemeApplicator } from "./lib/applyTheme.js";
// Global styles
import "./styles/base.css";
import "./styles/layout-main.css";
import "./styles/layout-grid.css";
// Component styles — co-located with their components
import "./components/sidebar/styles/sidebar-server.css";
import "./components/sidebar/styles/sidebar-channels.css";
import "./components/sidebar/styles/sidebar-items.css";
import "./components/chat/styles/chat-messages.css";
import "./components/chat/styles/chat-context.css";
import "./components/chat/styles/chat-editing.css";
import "./components/chat/styles/search-bar.css";
import "./components/chat/styles/search-results.css";
import "./components/chat/styles/dm-sidebar.css";
import "./components/chat/styles/dm-members.css";
import "./components/chat/styles/dm-usercard.css";
import "./components/modals/styles/modals-base.css";
import "./components/modals/styles/modals-specific.css";
import "./components/voice/styles/voice-channel.css";
import "./components/voice/styles/voice-controls.css";
import "./components/voice/styles/voice-sidebar.css";
import "./components/voice/styles/voice-rooms.css";
import "./components/voice/styles/screen-share-viewer.css";
import "./components/voice/styles/screen-share-controls.css";
import "./components/settings/styles/settings-layout.css";
import "./components/settings/styles/settings-controls.css";
import "./components/settings/styles/settings-appearance.css";
import "./components/settings/styles/audio-test.css";
import "./components/styles/emoji-picker.css";
import "./components/styles/emoji-grid.css";
import "./components/music/styles/music-player.css";
import "./components/music/styles/music-visualizer.css";
import "./components/music/styles/music-controls.css";
import "./components/music/styles/music-search.css";
import "./components/music/styles/music-queue.css";
import "./components/music/styles/soundboard-panel.css";
import "./components/music/styles/soundboard-tab.css";
import "./components/roadmap/styles/roadmap.css";

initThemeApplicator();

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
