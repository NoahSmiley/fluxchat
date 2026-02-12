import { useEffect } from "react";

/**
 * Spotify OAuth redirects here (http://127.0.0.1:1420/spotify-callback).
 * We forward the code & state to the real backend server's GET callback,
 * which handles the token exchange.
 */
export function SpotifyCallback() {
  useEffect(() => {
    const params = window.location.search;
    const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
    const base = serverUrl ? serverUrl.replace(/\/+$/, "") : "";
    window.location.href = `${base}/api/spotify/callback${params}`;
  }, []);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "#1a1a2e", color: "#fff",
      fontFamily: "system-ui",
    }}>
      <p>Linking Spotify...</p>
    </div>
  );
}
