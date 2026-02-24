import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { PopoutApp } from "./PopoutApp.js";
import { isPopout } from "./lib/broadcast.js";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/chat.css";
import "./styles/search.css";
import "./styles/modals.css";
import "./styles/voice.css";
import "./styles/screen-share.css";
import "./styles/settings.css";
import "./styles/emoji.css";
import "./styles/dm.css";
import "./styles/music.css";
import "./styles/soundboard.css";

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
