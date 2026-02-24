import { useNotifStore, type GlobalNotifSetting } from "@/stores/notifications.js";

export function NotificationsTab() {
  const { defaultChannelSetting, setDefaultChannelSetting } = useNotifStore();

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-card-title">Direct Messages</h3>
        <p className="settings-card-desc">You'll always be notified for every direct message. Mute individual users to suppress their notifications.</p>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Server Messages</h3>
        <p className="settings-card-desc">Default notification behavior for server text channels. Individual channels and categories can override this.</p>
        {(["all", "only_mentions", "none"] as GlobalNotifSetting[]).map((opt) => (
          <label key={opt} className="settings-radio-row">
            <input
              type="radio"
              name="channel-notif"
              checked={defaultChannelSetting === opt}
              onChange={() => setDefaultChannelSetting(opt)}
              className="settings-radio"
            />
            <div className="settings-row-info">
              <span className="settings-row-label">
                {opt === "all" ? "All Messages" : opt === "only_mentions" ? "Only @Mentions" : "Nothing"}
              </span>
              <span className="settings-row-desc">
                {opt === "all"
                  ? "Get notified for every message in server channels"
                  : opt === "only_mentions"
                  ? "Only notify for @everyone, @here, or your @username"
                  : "Never notify for server channel messages"}
              </span>
            </div>
          </label>
        ))}
      </div>
    </>
  );
}
