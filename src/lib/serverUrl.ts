// Server URL configuration.
// Set VITE_SERVER_URL in .env to connect to a remote server.
// When unset, relative URLs are used (goes through Vite proxy in dev).

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;

/** Base URL for API requests, e.g. "http://1.2.3.4:3001/api" or "/api" */
export const API_BASE = SERVER_URL ? `${SERVER_URL.replace(/\/+$/, "")}/api` : "/api";

/** WebSocket gateway URL, e.g. "ws://1.2.3.4:3001/gateway" or derived from window.location */
export function getGatewayUrl(): string {
  if (SERVER_URL) {
    const url = new URL("/gateway", SERVER_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/gateway`;
}
