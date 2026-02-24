import { getPopoutType } from "./lib/broadcast.js";
import { PopoutChatView } from "./components/popout/PopoutChatView.js";
import { PopoutScreenShareView } from "./components/popout/PopoutScreenShareView.js";

export function PopoutApp() {
  const type = getPopoutType();

  return (
    <div className="popout-container">
      <div className="titlebar" data-tauri-drag-region />
      {type === "chat" && <PopoutChatView />}
      {type === "screenshare" && <PopoutScreenShareView />}
    </div>
  );
}
