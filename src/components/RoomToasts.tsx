import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import * as api from "../lib/api.js";
import { X, DoorOpen, UserPlus } from "lucide-react";

export function RoomToasts() {
  const roomKnocks = useChatStore((s) => s.roomKnocks);
  const roomInvites = useChatStore((s) => s.roomInvites);
  const dismissKnock = useChatStore((s) => s.dismissKnock);
  const dismissRoomInvite = useChatStore((s) => s.dismissRoomInvite);
  const activeServerId = useChatStore((s) => s.activeServerId);
  const channels = useChatStore((s) => s.channels);

  if (roomKnocks.length === 0 && roomInvites.length === 0) return null;

  return (
    <div className="room-toasts">
      {roomKnocks.map((knock) => {
        const room = channels.find((c) => c.id === knock.channelId);
        const roomName = room?.name ?? "a room";
        return (
          <div key={knock.timestamp} className="room-toast knock-toast">
            <div className="room-toast-icon">
              <DoorOpen size={16} />
            </div>
            <div className="room-toast-content">
              <div className="room-toast-title">
                <strong>{knock.username}</strong> is knocking on <strong>{roomName}</strong>
              </div>
            </div>
            <div className="room-toast-actions">
              <button
                className="room-toast-btn accept"
                onClick={() => {
                  if (activeServerId) {
                    api.acceptKnock(activeServerId, knock.channelId, knock.userId).catch(() => {});
                  }
                  dismissKnock(knock.timestamp);
                }}
              >
                Accept
              </button>
              <button
                className="room-toast-btn dismiss"
                onClick={() => dismissKnock(knock.timestamp)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {roomInvites.map((invite) => (
        <div key={invite.timestamp} className="room-toast invite-toast">
          <div className="room-toast-icon">
            <UserPlus size={16} />
          </div>
          <div className="room-toast-content">
            <div className="room-toast-title">
              <strong>{invite.inviterUsername}</strong> invited you to <strong>{invite.channelName}</strong>
            </div>
          </div>
          <div className="room-toast-actions">
            <button
              className="room-toast-btn accept"
              onClick={() => {
                useVoiceStore.getState().joinVoiceChannel(invite.channelId);
                dismissRoomInvite(invite.timestamp);
              }}
            >
              Join
            </button>
            <button
              className="room-toast-btn dismiss"
              onClick={() => dismissRoomInvite(invite.timestamp)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
