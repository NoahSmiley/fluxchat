import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { PopoutApp } from "./PopoutApp.js";
import { isPopout } from "./lib/broadcast.js";
import "./styles/tailwind.css";
import "./styles/global.css";

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
