# context.md — Flux Application Knowledge Base

> **Purpose**: Living reference document for AI agents and humans working on this codebase.
> Designed for searchability — use grep/ripgrep on `## SECTION:` headers or `KEY:` tags to find info fast.
> AI agents: actively update this document as you learn new things about the app.

---

## SECTION: Overview

KEY: app-type, tech-stack, description

Flux is a real-time encrypted chat application (similar to Discord) built as a desktop app.

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind CSS 3, Zustand 5 (state)
- **Desktop**: Tauri 2 (Rust-based native shell, custom titlebar, auto-updater)
- **Backend**: Rust, Axum 0.8, Tokio async runtime, SQLite via SQLx
- **Voice/Video**: LiveKit (WebRTC), Web Audio API for processing
- **Encryption**: ECDH P-256 key exchange, AES-256-GCM message encryption
- **Extras**: Spotify integration (Web Playback SDK), drag-drop channel reordering (dnd-kit)

---

## SECTION: Directory Structure

KEY: files, folders, layout, where-is

```
src/                          # React frontend
  components/                 # UI components (22+)
    ui/                       # Radix-based primitives (button, dialog, input, tooltip)
    ChannelSidebar.tsx        # Channel list, drag-drop reorder, category tree
    ChatView.tsx              # Message list, input, reactions, attachments, search
    DMChatView.tsx            # Direct message view
    VoiceChannelView.tsx      # Voice participants, screen share, audio controls
    GameChannelView.tsx       # Game/activity detection display
    SettingsModal.tsx         # User settings (audio, keybinds, profile, appearance)
    ServerSidebar.tsx         # Server icon list (left rail)
    MemberList.tsx            # Voice channel participant display
    MusicPanel.tsx            # Spotify playback controls + queue
    PopoutChatView.tsx        # Pop-out chat window
    PopoutScreenShareView.tsx # Pop-out screen share window
    CreateChannelModal.tsx    # New channel dialog
    ChannelSettingsModal.tsx  # Edit channel dialog
    ServerSettingsModal.tsx   # Edit server dialog
    AvatarCropModal.tsx       # Avatar upload/crop
  stores/                     # Zustand state stores
    auth.ts                   # Auth state, login/register/logout
    chat.ts                   # Servers, channels, messages, DMs, search (~38KB, largest)
    voice.ts                  # Voice connection, audio pipeline, screen share (~46KB)
    spotify.ts                # Spotify OAuth, SDK, playback, sessions (~27KB)
    crypto.ts                 # E2EE key management, encrypt/decrypt
    keybinds.ts               # Keyboard shortcut bindings
    ui.ts                     # UI preferences (sidebar position)
  lib/                        # Utilities
    api.ts                    # REST client (auto-injects auth token)
    ws.ts                     # WebSocket client (connect, reconnect, event routing)
    crypto.ts                 # Web Crypto API wrappers (ECDH, AES-GCM, HKDF)
    serverUrl.ts              # Resolves API base URL
    avatarColor.ts            # Deterministic avatar color from username
    notifications.ts          # Desktop notification helpers
    relativeTime.ts           # "5 minutes ago" formatting
    broadcast.ts              # BroadcastChannel API for popout window sync
    debug.ts                  # dbg(category, message, data) logging
    dtln/                     # DTLN noise filter (WASM-based)
  layouts/
    MainLayout.tsx            # App shell: server sidebar + channel sidebar + content area
  pages/
    LoginPage.tsx             # Login form
    RegisterPage.tsx          # Registration form
    SpotifyCallback.tsx       # Spotify OAuth callback handler
  hooks/
    useKeybindListener.ts     # Global keyboard shortcut listener
    useUpdater.ts             # Tauri auto-update checker
  types/
    shared.ts                 # TypeScript interfaces (~251 lines)
  styles/
    global.css                # All custom CSS (~120KB)
    tailwind.css              # Tailwind base import
  App.tsx                     # Root component, routing, window controls
  PopoutApp.tsx               # Root for pop-out windows
  main.tsx                    # React DOM entry point

crates/server/                # Rust backend
  src/
    main.rs                   # Axum server setup, route mounting, CORS
    config.rs                 # Env var config (HOST, PORT, DB, LiveKit, Spotify)
    models.rs                 # API response structs
    db/
      mod.rs                  # SQLite pool init, schema execution, WAL mode
      schema.sql              # All CREATE TABLE statements
    middleware/
      auth.rs                 # Bearer token extraction + validation
    routes/
      auth.rs                 # Sign up, sign in, sessions (Argon2 hashing)
      servers.rs              # Server CRUD, channel CRUD, member management
      messages.rs             # Message CRUD, search, reactions
      dms.rs                  # DM channel creation, DM messages
      voice.rs                # LiveKit token generation
      users.rs                # Profile CRUD, public key storage
      keys.rs                 # E2EE key wrapping/sharing
      files.rs                # File upload (multipart, 10MB limit) + serving
      spotify.rs              # Spotify OAuth, token refresh, sessions, queue
      whitelist.rs            # Email whitelist (admin feature)
    ws/
      gateway.rs              # WebSocket state: clients, subscriptions, voice participants
      handler.rs              # WS message routing (client→server events)
      events.rs               # Event type definitions (client + server events)

crates/shared/                # Shared Rust types (between server and Tauri)

src-tauri/                    # Tauri desktop config
  src/                        # Tauri Rust commands (game detection, global keys, etc.)
    global_keys.rs            # Win32 low-level keyboard hook for global PTT/PTM
  tauri.conf.json             # Window config, updater, app metadata

public/                       # Static assets
docker-compose.yml            # Docker: flux-server + livekit
Dockerfile                    # Multi-stage build
```

---

## SECTION: Database Schema

KEY: tables, database, sqlite, schema, models, columns

Schema file: `crates/server/src/db/schema.sql`

**user** — id (TEXT PK), email (UNIQUE), username, password_hash, image, public_key, ring_style, ring_spin, steam_id, created_at

**server** — id (TEXT PK), name, owner_id (FK user), invite_code, created_at

**channel** — id (TEXT PK), server_id (FK), name, type (text|voice|game|category), bitrate, parent_id (FK channel, for categories), position, created_at

**message** — id (TEXT PK), channel_id (FK), sender_id (FK user), ciphertext, mls_epoch (0=plain, 1=encrypted), created_at, edited_at

**reaction** — id, message_id (FK), user_id (FK), emoji, created_at

**dm_channel** — id (TEXT PK), user1_id, user2_id (ordered pair), created_at

**dm_message** — id (TEXT PK), dm_channel_id (FK), sender_id (FK), ciphertext, mls_epoch, created_at

**membership** — user_id + server_id (composite PK), role (owner|admin|member), joined_at

**listening_sessions** — id, voice_channel_id, host_user_id, current_track_uri, current_track_position_ms, is_playing, created_at, updated_at

**session_queue** — id, session_id (FK), track_uri, track_name, track_artist, track_album_art, duration_ms, position, added_by_user_id, created_at

**whitelist** — id, email, added_by, added_at

**attachment** — id, message_id (FK), filename, content_type, size, url, created_at

---

## SECTION: Authentication

KEY: auth, login, register, session, token, password, jwt, bearer

**Flow**: Email + password → Argon2 hash → Bearer token stored in localStorage (`flux-session-token`)

**Endpoints**:
- `POST /api/auth/sign-up/email` — { email, password, name, username } → { user, token }
- `POST /api/auth/sign-in/email` — { email, password } → { user, token }
- `GET /api/auth/get-session` — Bearer header → { user } (called on app load)
- `POST /api/auth/sign-out` — Clears session

**Frontend**: `useAuthStore` (stores/auth.ts) manages user state, auto-initializes on load.
**Backend**: `middleware/auth.rs` extracts Bearer token, validates, injects user into request.

**Whitelist**: Optional email whitelist restricts signups. Admin-only via `/api/whitelist` endpoints.

---

## SECTION: API Endpoints

KEY: rest, api, routes, endpoints, http

Base URL: `/api` (Vite proxies to localhost:3001 in dev; `VITE_SERVER_URL` in prod)

Auth token auto-injected by `lib/api.ts` from localStorage.

```
AUTH
  POST   /auth/sign-up/email
  POST   /auth/sign-in/email
  POST   /auth/sign-out
  GET    /auth/get-session

SERVERS
  GET    /servers
  GET    /servers/:serverId
  PATCH  /servers/:serverId
  DELETE /servers/:serverId/members/me

CHANNELS
  GET    /servers/:serverId/channels
  POST   /servers/:serverId/channels
  PATCH  /servers/:serverId/channels/:channelId
  DELETE /servers/:serverId/channels/:channelId
  PUT    /servers/:serverId/channels/reorder

MEMBERS
  GET    /servers/:serverId/members
  PATCH  /members/:userId/role

MESSAGES
  GET    /channels/:channelId/messages          (cursor-based, 50/page)
  GET    /channels/:channelId/messages/search
  GET    /messages/reactions

DMS
  GET    /dms
  POST   /dms                                   { userId }
  GET    /dms/:dmChannelId/messages
  GET    /dms/:dmChannelId/messages/search

USERS
  GET    /users/me
  PATCH  /users/me
  GET    /users/search
  PUT    /users/me/public-key
  GET    /users/:userId/public-key

E2EE KEYS
  POST   /servers/:serverId/keys
  GET    /servers/:serverId/keys/me
  POST   /servers/:serverId/keys/:userId

VOICE
  POST   /voice/token

FILES
  POST   /upload                                (multipart, 10MB max)
  GET    /files/:id/:filename
  GET    /link-preview?url=...

SPOTIFY
  GET    /spotify/auth-info
  POST   /spotify/init-auth
  GET    /spotify/callback
  POST   /spotify/callback
  POST   /spotify/unlink
  GET    /spotify/token
  GET    /spotify/search
  POST   /spotify/sessions
  GET    /spotify/sessions/channel/:voiceChannelId
  POST   /spotify/sessions/:sessionId/queue
  DELETE /spotify/sessions/:sessionId/queue/:itemId
  DELETE /spotify/sessions/:sessionId/end

WHITELIST
  GET    /whitelist
  POST   /whitelist
  DELETE /whitelist/:id
```

---

## SECTION: WebSocket Gateway

KEY: websocket, ws, realtime, events, gateway, live

Connection: `/gateway?token=<bearer_token>` (auto ws/wss based on page protocol)
Reconnect: exponential backoff 1s → 30s max. Heartbeat every 30s.
Implementation: `lib/ws.ts` (client), `crates/server/src/ws/` (server)

**Client → Server events**:
send_message, typing_start, typing_stop, join_channel, leave_channel,
voice_state_update, add_reaction, remove_reaction, edit_message, delete_message,
send_dm, join_dm, leave_dm, update_activity, share_server_key, request_server_key,
spotify_playback_control, voice_drink_update, update_status

**Server → Client events**:
message, typing, presence, member_joined, member_left, member_role_updated,
reaction_add, reaction_remove, message_edit, message_delete, channel_update,
profile_update, voice_state, activity_update, server_key_shared, server_key_requested,
spotify_queue_update, spotify_queue_remove, spotify_playback_sync,
dm_message, spotify_session_ended, error

**Server architecture**: GatewayState holds clients (Tokio MPSC channels), subscription maps (channel_id → Set<ClientId>), voice participants per channel. Broadcasts go only to subscribed clients.

**User Status/Presence**: Users have 5 statuses: online (green), idle (orange crescent moon), dnd (red), invisible (appears offline to others), offline (disconnected). Status stored in `user.status` DB column and `ConnectedClient.status` in gateway. Invisible users are broadcast as "offline" to others. Frontend tracks statuses in `userStatuses: Record<string, PresenceStatus>` alongside legacy `onlineUsers: Set<string>`. Auto-idle after 5 min of inactivity via `useIdleDetection` hook. DND suppresses desktop notifications and sounds.

---

## SECTION: Encryption

KEY: e2ee, encryption, crypto, keys, ecdh, aes, security

Implementation: `lib/crypto.ts` (Web Crypto API), `stores/crypto.ts` (Zustand)

**User key pair**: ECDH P-256, generated on first use, stored in IndexedDB. Public key uploaded to server as base64 JWK. Private key never leaves the client.

**Server group key**: One AES-256-GCM key per server. Created by server owner, wrapped with each member's ECDH public key, distributed via REST + WebSocket.

**DM key**: Derived via ECDH(myPrivate, theirPublic) → HKDF(SHA-256, salt=dmChannelId, info="flux-dm") → AES-256-GCM key.

**Message format**: AES-256-GCM encrypt → base64(iv || ciphertext || tag) stored in `ciphertext` column. `mls_epoch=0` means plaintext fallback (base64-encoded), `mls_epoch=1` means encrypted.

**Fallback**: If no key available, messages are base64-encoded plaintext (not encrypted).

---

## SECTION: Voice and Audio

KEY: voice, audio, livekit, webrtc, screen-share, microphone, speaker

Implementation: `stores/voice.ts` (~46KB), LiveKit React Components

**Connection**: LiveKit WebRTC. Token generated via `POST /api/voice/token`, connects to LiveKit server specified by `LIVEKIT_URL`.

**Audio pipeline** (Web Audio API):
MediaStreamSource → ChannelSplitter/Merger (mono→stereo) → BiquadFilter (high-pass) → BiquadFilter (low-pass) → AnalyserNode (level metering) → GainNode (per-user volume) → AudioDestination

**Processing options**: Echo cancellation, noise suppression, auto gain control, high/low-pass filters, noise gate (input sensitivity 0-100), DTLN WASM noise filter, DTX (discontinuous transmission).

**Audio levels**: Polled at 20fps for smooth UI animation.

**Screen sharing**: Resolution presets (480p30 → 1080p60 → Lossless). H.264 default (hardware accel), VP9 option for lossless. Degradation preferences configurable.

**Per-user volume**: Individual gain nodes per participant. Stored in `participantVolumes` map.

---

## SECTION: Spotify Integration

KEY: spotify, music, playback, queue, listening-session, oauth

Implementation: `stores/spotify.ts` (~27KB), `routes/spotify.rs`, `MusicPanel.tsx`

**OAuth**: PKCE flow. Client generates code_verifier → server initiates auth → Spotify consent → callback with code → server exchanges for tokens.

**Playback**: Spotify Web Playback SDK loaded async. Player connects with access token from server.

**Listening sessions**: Created when user joins voice channel. One session per voice channel, hosted by first user. Queue shared across participants via DB (session_queue table) + WebSocket sync.

**Features**: Search tracks, add/remove from queue, skip, volume control, synchronized playback across voice channel participants.

---

## SECTION: State Management

KEY: zustand, store, state, stores

All stores in `src/stores/`. Zustand with no middleware except persist (for ui.ts and keybinds.ts).

**useAuthStore** (auth.ts) — user object, loading, error. Auto-initializes on load.

**useChatStore** (chat.ts, ~38KB) — Largest store. Servers, channels, messages, DMs, search, file uploads, typing indicators, online users, activities. 3-level message cache: per-channel, per-server, per-DM for instant switching.

**useVoiceStore** (voice.ts, ~46KB) — Most complex store. LiveKit room, connection state, mute/deafen, audio settings (all processing options), per-user volumes, audio levels (20fps), screen sharing state, participants.

**useSpotifyStore** (spotify.ts, ~27KB) — Spotify account, SDK state, player, playback state, sessions, queue, search.

**useCryptoStore** (crypto.ts) — Key pair, public key, server keys, DM keys. Encrypt/decrypt actions.

**useKeybindsStore** (keybinds.ts) — Keyboard shortcut bindings. Persisted to localStorage.

**useUIStore** (ui.ts) — Settings modal open state, sidebar position (left|top|right|bottom). Persisted.

---

## SECTION: UI Component Architecture

KEY: components, layout, ui, react, rendering

**MainLayout.tsx**: App shell with resizable panes. ServerSidebar (64px, left rail) + ChannelSidebar (240px, resizable) + content area (flex-grow).

**Content area routing**: Based on active channel type — ChatView (text), VoiceChannelView (voice), GameChannelView (game), DMChatView (DMs).

**ChatView**: Message list with scroll pagination (50/page), per-message UI (avatar, content, reactions, edit/delete), typing indicators, unread dividers, file drop zone, @mention autocomplete, emoji picker.

**VoiceChannelView**: Participant list with audio level bars, per-user volume sliders, mute/deafen indicators, screen share display with pin/theatre mode.

**ChannelSidebar**: Tree structure with categories (parent_id), drag-drop reordering via dnd-kit, channel type icons, unread indicators.

**Popout windows**: BroadcastChannel API syncs state between main window and pop-outs (chat, screen share, music). See `lib/broadcast.ts`, `PopoutApp.tsx`.

**Modals**: Radix UI Dialog-based. Settings, create channel, channel settings, server settings, avatar crop.

---

## SECTION: Styling

KEY: css, tailwind, theme, styles, animations, avatar-ring

Tailwind CSS for utility classes. Custom CSS in `styles/global.css` (~120KB).

**Avatar ring styles**: default, chroma (RGB shifting), pulse (glow), wave, ember (red), frost (blue), neon, galaxy (gradient), none. Configured per-user via ring_style + ring_spin fields.

**Custom window controls**: Tauri frameless window with custom titlebar and minimize/maximize/close buttons.

**Resizable panes**: CSS Grid with drag handles for sidebar widths.

---

## SECTION: Environment Variables

KEY: env, config, environment, setup, dotenv

**Server** (.env for Rust backend):
```
HOST=0.0.0.0
PORT=3001
DATABASE_PATH=./flux.db
UPLOAD_DIR=./uploads
BETTER_AUTH_SECRET=<random-secret>
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
LIVEKIT_URL=wss://<instance>.livekit.cloud
SPOTIFY_CLIENT_ID=<optional>
SPOTIFY_CLIENT_SECRET=<optional>
SPOTIFY_REDIRECT_URI=http://localhost:3001/api/spotify/callback
```

**Client** (.env for Vite):
```
VITE_SERVER_URL=http://localhost:3001   # omit for same-origin
```

---

## SECTION: Build and Deployment

KEY: build, deploy, docker, production, development

**Dev**: `npm run dev` (Vite on :1420, proxies /api and /gateway to :3001). Tauri dev mode for desktop.

**Build**: `npm run build` (Vite → dist/), `cargo build --release -p flux-server` (backend binary).

**Docker**: `docker-compose up -d` runs flux-server (port 3001) + LiveKit (port 7880). Volumes for DB + uploads.

**Auto-update**: Tauri updater plugin checks GitHub releases. NSIS installer for Windows. Ed25519 signed.

---

## SECTION: Patterns and Conventions

KEY: patterns, conventions, architecture, decisions

- **Optimistic UI**: Messages/reactions update UI immediately, WebSocket confirms.
- **Cursor pagination**: Messages use cursor (last message ID), 50 per page.
- **Message caching**: 3-level cache (per-channel, per-server, per-DM) for instant channel switching.
- **Reconnect**: WebSocket auto-reconnects with exponential backoff (1s → 30s).
- **Encryption fallback**: If no key, messages stored as base64 plaintext (mls_epoch=0).
- **SQLite WAL mode**: Write-ahead logging for concurrent reads during writes.
- **Idempotent schema**: All CREATE TABLE use IF NOT EXISTS. Migrations via ALTER TABLE.
- **Path alias**: `@/*` maps to `./src/*` in TypeScript imports.
- **Component style**: Tailwind utility classes + global.css for complex animations.
- **IDs**: UUID v4 for most entities, Nanoid for some (invite codes).

---

## SECTION: Known Quirks and Gotchas

KEY: quirks, gotchas, bugs, watch-out, traps

- `global.css` is ~120KB — large file, changes here affect many things.
- `chat.ts` and `voice.ts` stores are very large (38KB and 46KB) — read carefully before modifying.
- Game channels use fake IDs starting with `__game_` — not persisted in DB.
- CORS mirrors request origin (permissive) — fine for desktop app, would need tightening for web deployment.
- WebSocket auth uses token in query string (visible in logs) — acceptable for desktop, less ideal for web.
- Spotify integration requires both client ID/secret AND a linked user account to function.
- The `mls_epoch` field name is a holdover — it's not actually MLS protocol, just 0=plain/1=encrypted.

---

## SECTION: Changelog

KEY: changelog, changes, updates, history

> AI agents: add entries here when you make significant changes to the codebase.

- **2026-02-17**: ai.md created. Initial documentation of full app architecture.
- **2026-02-17**: Global push-to-talk support. Added `src-tauri/src/global_keys.rs` — Win32 low-level hooks (`WH_KEYBOARD_LL` + `WH_MOUSE_LL`) that capture key/mouse press/release events system-wide, even when the app is not focused. `useKeybindListener.ts` updated to use Tauri events from the hooks for PTT/PTM actions, falling back to window-level events for non-Tauri environments. Hooks are non-consuming (input passes through to other apps). Activated when user joins voice with a PTT/PTM keybind set; deactivated on voice disconnect.
- **2026-02-17**: Mouse button keybind support. Keybinds now accept mouse buttons (Mouse 1–5, including thumb/side buttons) in addition to keyboard keys. Codes stored as `"Mouse0"`–`"Mouse4"` in keybinds store. ESC is the only key that cancels keybind recording; all other keyboard and mouse input sets the binding. Context menu suppressed when right-click is bound to an action.
- **2026-02-17**: Channel sidebar active indicator fix. Moved the `::before` pseudo-element from `.channel-sortable-active` to `.channel-sortable-active > .channel-item-wrapper::before` so the white vertical bar indicator only spans the channel row, not the connected voice members below it.
- **2026-02-17**: Zoom controls in titlebar. Added zoom in/out/reset buttons (magnifying glass icons from lucide-react) to the left of the min/max/close window controls. Uses Tauri's native `webviewWindow.setZoom()` API.
- **2026-02-17**: Channel name ellipsis. Channel names now truncate with ellipsis instead of wrapping to multiple lines when space is tight. Channel name wrapped in `.channel-item-name` span with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Works correctly when hover buttons (settings cog) appear.
- **2026-02-18**: User status system. 5 statuses: online, idle, dnd, invisible, offline. Backend: `status` column on user table, `UpdateStatus` WS event, `ConnectedClient.status` in gateway, invisible users broadcast as "offline". Frontend: `userStatuses` map in chat store (alongside legacy `onlineUsers`), status indicator dots on avatars in ServerSidebar/MemberList/DMSidebar/DMChatView/ChatView mentions, status selector dropdown in self UserCard popup, `useIdleDetection` hook (5 min auto-idle), DND notification/sound suppression in `lib/notifications.ts`. CSS: `.avatar-status-indicator` overlay, `.status-dot` variants for idle (crescent moon via box-shadow), dnd, invisible. Files: `db/mod.rs`, `routes/auth.rs`, `routes/users.rs`, `ws/events.rs`, `ws/gateway.rs`, `ws/handler.rs`, `types/shared.ts`, `stores/chat.ts`, `hooks/useIdleDetection.ts`, `lib/notifications.ts`, `components/MemberList.tsx`, `components/ServerSidebar.tsx`, `components/DMSidebar.tsx`, `components/DMChatView.tsx`, `components/ChatView.tsx`, `styles/global.css`.
