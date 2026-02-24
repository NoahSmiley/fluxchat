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
  components/                 # UI components (domain-grouped subdirectories)
    voice/                    # Voice/video domain
      VoiceChannelView.tsx    # Voice participants, screen share, audio controls
      VoiceUserRow.tsx        # Per-user row in voice channel (speaking indicator, volume)
      VoiceStatusBar.tsx      # Voice connection status bar (mute/deafen/disconnect)
      StatsOverlay.tsx        # WebRTC stats floating overlay
      RoomToasts.tsx          # Room knock/invite toast notifications
    chat/                     # Messaging domain
      ChatView.tsx            # Message list, input, reactions, attachments, search
      DMChatView.tsx          # Direct message view
      SearchBar.tsx           # Advanced message search bar with filter tag UI (from/in/has/mentions/dates)
      LinkEmbed.tsx           # URL link preview embed
      MessageAttachments.tsx  # File attachment display (images, downloads)
    sidebar/                  # Navigation sidebars
      ServerSidebar.tsx       # Server icon list (left rail)
      ChannelSidebar.tsx      # Channel list, drag-drop reorder, category tree
      SortableChannelItem.tsx # Drag-sortable channel/category row
      MemberList.tsx          # Server member list + UserCard popup
    modals/                   # Modal dialogs
      AvatarCropModal.tsx     # Avatar upload/crop
      ChannelSettingsModal.tsx # Edit channel dialog + DeleteConfirmDialog
      CreateChannelModal.tsx  # New channel dialog
    music/                    # Music/soundboard domain
      MusicPanel.tsx          # Spotify playback controls + queue
      MusicVisualizer.tsx     # WebGL kaleidoscopic shader visualizer (easter egg, extracted from MusicPanel)
      SoundboardPanel.tsx     # Voice channel soundboard grid (play, preview, favorite, master volume)
      SoundboardTab.tsx       # Server settings soundboard management (upload, waveform trim, delete)
    popout/                   # Pop-out windows
      PopoutChatView.tsx      # Pop-out chat window
      PopoutScreenShareView.tsx # Pop-out screen share window
    settings/                 # Settings tabs (pre-existing)
    ui/                       # Radix-based primitives (button, dialog, input, tooltip)
    AnimatedList.tsx          # Shared animated list component
    ContextMenu.tsx           # Reusable context menu (portal-based)
    EmojiPicker.tsx           # Full reusable emoji picker (standard Twemoji categories + custom per-server + favorites)
    EmojiTab.tsx              # Server settings emoji management (admin upload/delete custom emoji, list)
    FluxLogo.tsx              # App logo component
    SettingsModal.tsx         # User settings (audio, keybinds, profile, appearance)
    ServerSettingsPage.tsx    # Server settings page (overview, members, soundboard, emoji tabs)
  stores/                     # Zustand state stores
    auth.ts                   # Auth state, login/register/logout
    chat.ts                   # Servers, channels, messages, search
    dm.ts                     # DM state and actions (extracted from chat.ts)
    voice.ts                  # Voice connection, audio pipeline, screen share (~46KB, organized with section separators)
    spotify.ts                # Spotify OAuth, SDK, playback, sessions
    youtube.ts                # YouTube audio playback, search, queue (extracted from spotify.ts)
    crypto.ts                 # E2EE key management, encrypt/decrypt
    notifications.ts          # Per-channel/category/global notification settings, mute state (persisted)
    keybinds.ts               # Keyboard shortcut bindings
    ui.ts                     # UI preferences (sidebar position)
    chat-events.ts            # WebSocket event dispatching into chat/DM stores
    chat-types.ts             # ChatState interface, cache helpers, mention regexes
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
    audio/                    # Audio/voice utilities (grouped subdirectory)
      voice-pipeline.ts       # Web Audio API pipeline (create/destroy/rebuild per-participant)
      voice-analysis.ts       # Audio level polling, noise gate, local mic analyser
      voice-noise.ts          # Noise suppression model factory (create/destroy/switch)
      voice-effects.ts        # Sound effects (join/leave/mute/deafen tones)
      voice-constants.ts      # Audio magic numbers (lobby music, bitrate, poll interval)
      DryWetTrackProcessor.ts # Dry/wet mix wrapper for suppression strength control
      GainTrackProcessor.ts   # Mic input gain TrackProcessor
      rnnoise/                # RNNoise noise filter (WASM-based, 48kHz native)
      dtln/                   # DTLN noise filter (WASM-based)
      deepfilter/             # DeepFilterNet3 noise filter (Worker+Worklet, WASM)
      nsnet2/                 # NSNet2 noise filter
      speex/                  # Speex noise filter
    webrtcStats.ts            # WebRTC quality stats collection (bitrate, codec, loss, jitter, RTT)
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
  styles/                       # Custom CSS (split from global.css)
    base.css                  # Reset, CSS vars, scrollbar
    layout.css                # App shell, titlebar, auth, forms, buttons
    sidebar.css               # Server + channel sidebar, rooms, drag overlay
    chat.css                  # Messages, reactions, mentions, attachments, context menu
    search.css                # Search bar, filters, date picker
    modals.css                # Modals, confirm dialogs, channel/server settings
    voice.css                 # Voice controls, participants, status bar, rooms
    screen-share.css          # Screen share, streams, popouts
    settings.css              # Settings page, cards, toggles, ring styles, keybinds
    emoji.css                 # Emoji picker, tooltips, upload
    dm.css                    # DM chat, member list, user card, mentions
    music.css                 # Spotify/music panel, visualizer, queue
    soundboard.css            # Soundboard panel, buttons, waveform trim
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

**message** — id (TEXT PK), channel_id (FK), sender_id (FK user), content (plaintext), created_at, edited_at

**messages_fts** — FTS5 virtual table (porter stemming + unicode61 tokenizer). Columns: message_id, plaintext. Populated on message create/edit, cleaned on delete. Used for server-side full-text search on text channels.

**reaction** — id, message_id (FK), user_id (FK), emoji, created_at

**dm_channel** — id (TEXT PK), user1_id, user2_id (ordered pair), created_at

**dm_message** — id (TEXT PK), dm_channel_id (FK), sender_id (FK), ciphertext, mls_epoch, created_at

**membership** — user_id + server_id (composite PK), role (owner|admin|member), joined_at

**listening_sessions** — id, voice_channel_id, host_user_id, current_track_uri, current_track_position_ms, is_playing, created_at, updated_at

**session_queue** — id, session_id (FK), track_uri, track_name, track_artist, track_album_art, duration_ms, position, added_by_user_id, created_at

**whitelist** — id, email, added_by, added_at

**attachment** — id, message_id (FK), filename, content_type, size, url, created_at

**soundboard_sounds** — id (TEXT PK), server_id (FK server), name, emoji, audio_attachment_id (FK attachment), volume (REAL, 0.0–1.0), created_by (FK user), created_at

**soundboard_favorites** — user_id (FK user) + sound_id (FK soundboard_sounds) composite PK, created_at. Stores per-user favorited sounds; ON DELETE CASCADE on both FKs.

**custom_emojis** — id (TEXT PK), server_id (FK servers ON DELETE CASCADE), name (TEXT), attachment_id (FK attachments ON DELETE CASCADE), filename (TEXT, denormalized from attachment for fast serving), uploader_id (FK user), created_at. UNIQUE(server_id, name). `uploader_username` and `uploader_image` are NOT stored — derived live via JOIN to `user` table.

**standard_emoji_favorites** — user_id (FK user ON DELETE CASCADE) + emoji (TEXT, Unicode char) composite PK, created_at. Stores per-user favorited standard (Twemoji) emoji.

**custom_emoji_favorites** — user_id (FK user ON DELETE CASCADE) + emoji_id (FK custom_emojis ON DELETE CASCADE) composite PK, created_at. CASCADE on emoji_id means deleting a custom emoji auto-removes all user favorites for it.

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

SOUNDBOARD
  GET    /servers/:serverId/soundboard              (list sounds, includes favorited bool per user)
  POST   /servers/:serverId/soundboard              (admin/owner only)
  PATCH  /servers/:serverId/soundboard/:soundId     (admin/owner only)
  DELETE /servers/:serverId/soundboard/:soundId     (admin/owner only)
  POST   /servers/:serverId/soundboard/:soundId/favorite
  DELETE /servers/:serverId/soundboard/:soundId/favorite

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
spotify_playback_control, voice_drink_update, update_status, play_sound

**Server → Client events**:
message, typing, presence, member_joined, member_left, member_role_updated,
reaction_add, reaction_remove, message_edit, message_delete, channel_update,
profile_update, voice_state, activity_update, server_key_shared, server_key_requested,
spotify_queue_update, spotify_queue_remove, spotify_playback_sync,
dm_message, spotify_session_ended, soundboard_play, error

**Server architecture**: GatewayState holds clients (Tokio MPSC channels), subscription maps (channel_id → Set<ClientId>), voice participants per channel. Broadcasts go only to subscribed clients.

**User Status/Presence**: Users have 5 statuses: online (green), idle (orange crescent moon), dnd (red), invisible (appears offline to others), offline (disconnected). Status stored in `user.status` DB column and `ConnectedClient.status` in gateway. Invisible users are broadcast as "offline" to others. Frontend tracks statuses in `userStatuses: Record<string, PresenceStatus>` alongside legacy `onlineUsers: Set<string>`. Auto-idle after 5 min of inactivity via `useIdleDetection` hook. DND suppresses desktop notifications and sounds.

---

## SECTION: Encryption

KEY: e2ee, encryption, crypto, keys, ecdh, aes, security

Implementation: `lib/crypto.ts` (Web Crypto API), `stores/crypto.ts` (Zustand)

**User key pair**: ECDH P-256, generated on first use, stored in IndexedDB. Public key uploaded to server as base64 JWK. Private key never leaves the client.

**Server group key**: One AES-256-GCM key per server. Created by server owner, wrapped with each member's ECDH public key, distributed via REST + WebSocket. Used for **voice/video E2EE only** (not text messages).

**Text channel messages**: Stored as **plaintext** on the server in the `content` column. Not E2EE — encrypted in transit via TLS only. This enables server-side full-text search via FTS5.

**DM messages**: Fully E2EE. Key derived via ECDH(myPrivate, theirPublic) → HKDF(SHA-256, salt=dmChannelId, info="flux-dm") → AES-256-GCM key. Stored as `ciphertext` + `mls_epoch` in `dm_messages` table. Self-DMs supported (uses ECDH(myPrivate, myPublic) for key derivation).

**Voice/Video**: E2EE via LiveKit's `ExternalE2EEKeyProvider` using the server group key. The key is exported as base64 and set on the provider before connecting to the room.

**DM message format**: AES-256-GCM encrypt → base64(iv || ciphertext || tag) stored in `ciphertext` column. `mls_epoch=0` means plaintext fallback (base64-encoded), `mls_epoch=1` means encrypted.

**Search**: Text channels use server-side FTS5 (fast, tokenized, porter-stemmed). DMs use client-side decrypt-and-filter (fetch 500 messages, decrypt, substring match).

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

**useSpotifyStore** (spotify.ts) — Spotify account, SDK state, player, playback state, sessions, queue, search. Coordinates with YouTube store for mixed-source sessions.

**useYouTubeStore** (youtube.ts) — YouTube audio playback state (audio element, track info, progress, search results), YouTube search and queue actions. Extracted from spotify.ts.

**useCryptoStore** (crypto.ts) — Key pair, public key, server keys, DM keys. Encrypt/decrypt actions.

**useKeybindsStore** (keybinds.ts) — Keyboard shortcut bindings. Persisted to localStorage.

**useUIStore** (ui.ts) — Settings modal open state, sidebar position (left|top|right|bottom), app border style, showDummyUsers, highlightOwnMessages. Persisted to localStorage (`flux-ui`).

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

Tailwind CSS for utility classes. Custom CSS split into 13 files in `src/styles/` (base, layout, sidebar, chat, search, modals, voice, screen-share, settings, emoji, dm, music, soundboard). Imported in order from `main.tsx`.

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
- **Encryption**: Text channel messages are plaintext on the server (not E2EE). DMs are E2EE. Voice/video are E2EE via server group key.
- **SQLite WAL mode**: Write-ahead logging for concurrent reads during writes.
- **Idempotent schema**: All CREATE TABLE use IF NOT EXISTS. Migrations via ALTER TABLE.
- **Path alias**: `@/*` maps to `./src/*` in TypeScript imports.
- **Component style**: Tailwind utility classes + global.css for complex animations.
- **IDs**: UUID v4 for most entities, Nanoid for some (invite codes).

---

## SECTION: Known Quirks and Gotchas

KEY: quirks, gotchas, bugs, watch-out, traps

- CSS is split into 13 files in `src/styles/` (was single `global.css` ~120KB). Import order in `main.tsx` matters — later files override earlier ones. `.settings-input` is defined in both `settings.css` and `soundboard.css` (soundboard loads last, overrides). Many CSS classes are generated dynamically via template literals (e.g. `ring-style-${style}`, `app-border-${style}`, `sidebar-${position}`) — check for these patterns before removing CSS that appears unused.
- `chat.ts` and `voice.ts` stores are very large (38KB and 46KB) — read carefully before modifying.
- Game channels use fake IDs starting with `__game_` — not persisted in DB.
- CORS mirrors request origin (permissive) — fine for desktop app, would need tightening for web deployment.
- WebSocket auth uses token in query string (visible in logs) — acceptable for desktop, less ideal for web.
- Spotify integration requires both client ID/secret AND a linked user account to function.
- The `mls_epoch` field in `dm_messages` is a holdover name — it's not actually MLS protocol, just 0=plain/1=encrypted.
- Text channel messages use `content` (plaintext). DM messages use `ciphertext` + `mls_epoch` (E2EE). Don't confuse the two schemas.
- SQLite FTS5 requires `libsqlite3-sys` with `bundled` feature — system SQLite often lacks FTS5. Do NOT use `content=''` (contentless) FTS5 tables if you need to JOIN on column values.
- WebSocket `send()` silently drops messages when not connected — any early sends (before WS open) are lost. Always re-subscribe in `onConnect`.
- **z-index layering**: Channel sidebar is `z-index: 1001`, resize handle `1100`, user-card popup `1200`. Any `position: fixed` overlay that needs to cover the full viewport (modals, dialogs) must use `z-index ≥ 9000`. The `.modal-overlay` class is at `9000`. Tooltips (`.emoji-msg-tooltip`, `.reaction-tooltip`) are at `9999`.
- **`position: fixed` inside transformed ancestors**: If a parent element has CSS `transform`, `filter`, `will-change: transform`, or `contain: paint/layout`, `position: fixed` children are contained within that element rather than the viewport. Use `createPortal(…, document.body)` to escape. `offsetParent` is `null` for fixed-position elements — use `parentElement` instead.

---

## SECTION: Changelog

KEY: changelog, changes, updates, history

> AI agents: add entries here when you make significant changes to the codebase.

- **2026-02-17**: ai.md created. Initial documentation of full app architecture.
- **2026-02-17**: Global push-to-talk support. Added `src-tauri/src/global_keys.rs` — Win32 low-level hooks (`WH_KEYBOARD_LL` + `WH_MOUSE_LL`) that capture key/mouse press/release events system-wide, even when the app is not focused. `useKeybindListener.ts` updated to use Tauri events from the hooks for PTT/PTM actions, falling back to window-level events for non-Tauri environments. Hooks are non-consuming (input passes through to other apps). Activated when user joins voice with a PTT/PTM keybind set; deactivated on voice disconnect.
- **2026-02-17**: Mouse button keybind support. Keybinds now accept mouse buttons (Mouse 1–5, including thumb/side buttons) in addition to keyboard keys. Codes stored as `"Mouse0"`–`"Mouse4"` in keybinds store. ESC is the only key that cancels keybind recording; all other keyboard and mouse input sets the binding. Context menu suppressed when right-click is bound to an action.
- **2026-02-17**: Channel sidebar active indicator fix. Moved the `::before` pseudo-element from `.channel-sortable-active` to `.channel-sortable-active > .channel-item-wrapper::before` so the white vertical bar indicator only spans the channel row, not the connected voice members below it.
- **2026-02-17**: Zoom controls in titlebar. Added zoom in/out/reset buttons (magnifying glass icons from lucide-react) to the left of the min/max/close window controls. Uses Tauri's native `webviewWindow.setZoom()` API. Zoom range: 80%–150%. Zoom persisted to `localStorage` (`app-zoom`) and restored on mount. `Ctrl+scroll`, `Ctrl+-`, `Ctrl+=`, `Ctrl+0` intercepted via window event listeners and routed through `applyZoom` to keep React state in sync with the actual WebView zoom (prevents desync when mixing keyboard/scroll shortcuts with buttons). Zoom-out/in buttons disabled at min/max. File: `App.tsx` (`ZoomControls` component).
- **2026-02-17**: Channel name ellipsis. Channel names now truncate with ellipsis instead of wrapping to multiple lines when space is tight. Channel name wrapped in `.channel-item-name` span with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Works correctly when hover buttons (settings cog) appear.
- **2026-02-18**: Self-DMs. Users can DM themselves (notes to self). Removed self-filter from `search_users` in `routes/dms.rs`, removed `!isSelf` guard on Message button in UserCard (`MemberList.tsx`).
- **2026-02-18**: Plaintext text channels + server-side FTS search. Text channel messages are no longer E2EE — stored as plaintext in `messages.content` column (was `ciphertext` + `mls_epoch`). Server indexes all channel messages in `messages_fts` (FTS5, porter stemming, unicode61) for fast full-text search. DMs remain fully E2EE with `ciphertext`/`mls_epoch`. Voice/video remain E2EE via server group key + LiveKit ExternalE2EEKeyProvider. Search in text channels is now server-side FTS5 (was client-side decrypt-and-filter). Frontend sends/receives plaintext for channel messages; DM encryption path unchanged. DB must be wiped for this migration (no backwards compat). Files changed: schema.sql, models.rs, events.rs, handler.rs, messages.rs, shared.ts, chat.ts, ChatView.tsx, PopoutChatView.tsx.
- **2026-02-18**: FTS5 search fixes. (1) Removed `content=''` from FTS5 table definition — contentless tables can't return column values for JOINs. (2) Added prefix matching with `*` wildcard so "web" matches "webster". (3) Added `libsqlite3-sys = { version = "0.30", features = ["bundled"] }` to Cargo.toml — system SQLite may not have FTS5 compiled in; bundling guarantees FTS5 support. (4) Added error logging for FTS queries.
- **2026-02-18**: WS startup race condition fix. `gateway.send()` silently drops messages when WS is not connected. On app startup, `selectServer` sends `join_channel` before WS connects, so the server never knows the client is subscribed. Fixed by re-subscribing to the active channel/DM in `gateway.onConnect` handler in `chat.ts`.
- **2026-02-18**: User status system. 5 statuses: online, idle, dnd, invisible, offline. Backend: `status` column on user table, `UpdateStatus` WS event, `ConnectedClient.status` in gateway, invisible users broadcast as "offline". Frontend: `userStatuses` map in chat store (alongside legacy `onlineUsers`), status indicator dots on avatars in ServerSidebar/MemberList/DMSidebar/DMChatView/ChatView mentions, status selector dropdown in self UserCard popup, `useIdleDetection` hook (5 min auto-idle), DND notification/sound suppression in `lib/notifications.ts`. CSS: `.avatar-status-indicator` overlay, `.status-dot` variants for idle (crescent moon via box-shadow), dnd, invisible. Files: `db/mod.rs`, `routes/auth.rs`, `routes/users.rs`, `ws/events.rs`, `ws/gateway.rs`, `ws/handler.rs`, `types/shared.ts`, `stores/chat.ts`, `hooks/useIdleDetection.ts`, `lib/notifications.ts`, `components/MemberList.tsx`, `components/ServerSidebar.tsx`, `components/DMSidebar.tsx`, `components/DMChatView.tsx`, `components/ChatView.tsx`, `styles/global.css`.
- **2026-02-18**: OS-level idle detection. Replaced DOM-event-based idle detection with Win32 `GetLastInputInfo` via a new Tauri command `get_system_idle_ms`. Polls every 30s (background-safe) + `focus`/`visibilitychange` events for instant return-to-active. Timeout changed from 5 to 10 minutes (`IDLE_TIMEOUT_MS` constant). Voice activity also prevents idle: `lastSpokeAt` timestamp added to `useVoiceStore` — updated at 20fps when mic transmits non-silence; `effectiveIdleMs = min(osIdleMs, voiceIdleMs)`. Files: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/stores/voice.ts`, `src/hooks/useIdleDetection.ts`.
- **2026-02-18**: Date search filters. Added `before:`, `on:`, `after:` filter keywords to `SearchBar`. Dropdown shows a compact date picker with Year (stepper), Month (named select), Day (stepper) and an Apply button; pressing Enter also applies. Typing `before:2024-12-23` manually pre-fills the picker. Dates formatted as YYYY-MM-DD tags. Backend: new `before`, `on`, `after` query params in `SearchQuery`; date values validated as YYYY-MM-DD; `before` → `m.created_at < 'YYYY-MM-DD'`; `on` → `>= 'YYYY-MM-DD' AND < date(..., '+1 day')`; `after` → `>= date(..., '+1 day')`. `onBlur` on search input updated to check `relatedTarget` containment so picker interactions don't close the dropdown. Files: `SearchBar.tsx`, `api.ts`, `stores/chat.ts`, `messages.rs`, `ChatView.tsx`, `global.css`.
- **2026-02-18**: Advanced search filters for text channels. New `SearchBar` component (`src/components/SearchBar.tsx`) replaces the inline search form in ChatView. Supports 4 filter keywords with dropdown-driven tag UI: `from:` (filter by sender), `in:` (filter by text channel), `has:` (filter by content type: image/video/link/sound/file/event), `mentions:` (filter by @mentioned user). Typing a keyword (e.g. `from:`) adapts the dropdown to a picker; selecting a value locks it as a removable tag. Backend `search_server_messages` rewritten with `sqlx::QueryBuilder` for dynamic SQL — accepts new query params `sender_id`, `channel_id`, `has`, `mentions_username`; requires at least one filter or text query; `has:` filters use `attachments.content_type` MIME patterns except `has:link` which uses `LIKE '%http%'`; search results now include batch-fetched attachments. Files: `crates/server/src/routes/messages.rs`, `src/lib/api.ts`, `src/stores/chat.ts`, `src/components/SearchBar.tsx`, `src/components/ChatView.tsx`, `src/styles/global.css`.
- **2026-02-19**: Soundboard favorites, mini buttons, creator grouping, master volume slider. Added `soundboard_favorites` DB table (user_id + sound_id composite PK, CASCADE deletes). `list_sounds` query LEFT JOINs favorites so each sound carries a `favorited: boolean` per requesting user. New POST/DELETE `/servers/:serverId/soundboard/:soundId/favorite` endpoints. `SoundboardPanel` now shows two mini buttons inside each sound button (Volume2 left = local preview, Heart right = toggle favorite); mini buttons use `<div>` with `e.stopPropagation()` (nested `<button>` is invalid HTML) with optimistic UI + error rollback. Sounds grouped by creator: logged-in user's sounds pinned under Favorites in a combined top section (no border between them), then a divider, then other users sorted alphabetically by username; all sounds within each group sorted by name. Master volume slider at top of panel stores to `localStorage` (`soundboard-master-volume`); effective playback volume = `Math.min(1, sound.volume * masterVolume)`. Also fixed 500 on admin sound create/edit — `create_sound` and `update_sound` re-fetch queries were missing `favorited` column so sqlx couldn't deserialize; fixed by adding `FALSE AS favorited`. Sounds tab icon in VoiceChannelView changed from `Drum` to `Volume2`.
- **2026-02-19**: Lobby music easter egg. When alone in a voice channel for 30s, a lofi MP3 (`public/lobby-music.mp3`) fades in locally (not broadcast). Fades out over 2s when someone joins; stops immediately on disconnect. Easter egg unlock: triple-click the green "Connected" label in VoiceStatusBar → sets `flux-lobby-music-unlocked` in localStorage → reveals a "Lobby Music" toggle in Settings > Voice & Audio. Audio routed through Web Audio API GainNode for smooth fade-in (3s) / fade-out (2s) at 0.15 gain. Files: `stores/voice.ts` (checkLobbyMusic, startLobbyMusic, fadeOutLobbyMusic, stopLobbyMusic + hooks in ParticipantConnected/Disconnected/join/leave), `components/VoiceStatusBar.tsx` (triple-click trigger), `components/SettingsModal.tsx` (conditional toggle), `styles/global.css` (unlock flash animation), `public/lobby-music.mp3` (asset).
- **2026-02-19**: Soundboard feature. Server admins/owners can upload audio clips (MP3/WAV/OGG/WebM/AAC, max 10s) to a per-server soundboard. Longer files can be trimmed in-app using a canvas waveform + dual range handles; trimmed audio is rendered via `OfflineAudioContext` and encoded to WAV before upload. Each sound has a name plus optional emoji or small image (max 200KB). Playback: clicking a button sends WS `play_sound` event; server validates sender is in that voice channel (via `ConnectedClient.voice_channel_id`), looks up sound+filenames from DB, and broadcasts `soundboard_play` to ALL clients including sender (no exclusion) so playback is synchronized; receiving clients check `connectedChannelId === event.channelId` before playing. Master volume read from localStorage in the `soundboard_play` handler in `chat.ts`. Files: `schema.sql` (new `soundboard_sounds` table), `crates/server/src/routes/soundboard.rs` (list/create/delete), `routes/mod.rs` (register routes), `ws/events.rs` (`PlaySound` client event, `SoundboardPlay` server event), `ws/handler.rs` (PlaySound match arm), `types/shared.ts` (`SoundboardSound` interface, WS event types), `api.ts` (get/create/delete soundboard functions), `stores/chat.ts` (`soundboard_play` WS handler), `components/SoundboardTab.tsx` (server settings listing + add-sound form with waveform trim UI), `components/SoundboardPanel.tsx` (voice channel grid of buttons), `components/ServerSettingsPage.tsx` (new Soundboard tab), `components/VoiceChannelView.tsx` (new Sounds tab + `SoundboardPanel`), `styles/global.css` (soundboard/trim UI styles).
- **2026-02-19**: EmojiPicker UX and performance improvements. (1) **Lazy rendering** — replaced `requestIdleCallback` background precompute (which competed with interactions) with `LazySection` component using `IntersectionObserver` (root = scroll container, rootMargin 200px); only the first 1–2 sections' grids render on open (~100–200 DOM nodes instead of ~1800), subsequent grids render just before scrolling into view. `_twemojiCache` persists across picker opens so re-opening is instant. (2) **`:emoji_name:` tooltips** — standard emoji cells show `:id:` as native title (e.g. `:grinning:`) instead of raw Unicode char which was triggering the Windows system emoji tooltip. Built a module-level `_nativeToId` reverse map (native char → emoji id) for O(1) lookup. (3) **Favorites section always visible** — favorites header always renders; when no favorites exist shows "No favorites yet" message instead of hiding the entire section. (4) **Heart emoji CSS fix** — `.emoji-picker-section-header img` was applying `border-radius: 50%` and `object-fit: cover` to twemoji-generated `<img class="emoji">` tags, distorting the ❤️ icon. Split rule to `img:not(.emoji)` (avatar images) vs `.emoji` (twemoji, sized 14×14, no border-radius). (5) **Bottom padding** — added `padding-bottom: 8px` to `.emoji-picker-scroll`. (6) **Default collapsed state** — standard emoji categories now collapsed by default on first open; Favorites and custom uploader groups expanded by default. State stored in `localStorage` as JSON array under `emoji-picker-collapsed`. (7) **Deferred search** — search uses `useDeferredValue` so typing is instantly responsive; a spinner shows while the deferred value catches up; requires min 2 characters to prevent enormous single-char result sets. (8) **`startsWith` keyword matching** — keywords now match only from the start (`k.startsWith(q)`) instead of anywhere in the string (`k.includes(q)`), preventing false positives like "ha" matching `:ab:` via its "alphabet" keyword. Files: `src/components/EmojiPicker.tsx`, `src/styles/global.css`.
- **2026-02-19**: Enhanced emoji system. Replaced sparse 10-emoji reaction popup with a full Discord-style emoji system. (1) **Twemoji rendering** — all Unicode emoji in messages and reactions now render as Twemoji SVG images via `twemoji.parse()` + `dangerouslySetInnerHTML`; XSS-safe because content is HTML-escaped before Twemoji runs. Packages: `twemoji`, `@emoji-mart/data`. (2) **Custom per-server emoji** — admins/owners upload PNG/GIF/WebP images (max 256 KB) via Server Settings → Emojis tab (`EmojiTab.tsx`). Referenced in messages/reactions as `:name:` text (unique per server via DB UNIQUE constraint); resolved client-side to `<img>` tags using loaded `customEmojis` store state. `uploader_username`/`uploader_image` derived live via JOIN to avoid staleness. (3) **Full `EmojiPicker` component** — used in 3 places: reaction `+` button per message, Smile icon button in message input toolbar, soundboard emoji field. Layout: sticky search → sticky category nav row (heart for favorites, representative emoji per standard category, uploader avatar per custom section) → scrollable sections (Favorites, standard emoji categories, custom emoji by uploader). Logged-in user's custom section pinned first. (4) **Emoji favorites** — two DB tables: `standard_emoji_favorites(user_id, emoji TEXT)` for Unicode chars; `custom_emoji_favorites(user_id, emoji_id FK ON DELETE CASCADE)` for custom IDs (CASCADE auto-cleans favorites when emoji deleted). Optimistic UI with rollback. (5) **`lib/emoji.ts`** — `renderMessageContent(text, customEmojis, apiBase, memberUsernames?)` handles URLs as `<a>` links + @mention spans + custom emoji + Twemoji in one HTML pass. `renderEmoji(emoji, customEmojis, apiBase)` renders a single emoji value. Files: `schema.sql`, `routes/emojis.rs` (new), `routes/mod.rs`, `types/shared.ts`, `api.ts`, `stores/chat.ts` (`customEmojis` state + `fetchCustomEmojis` action), `lib/emoji.ts` (new), `EmojiPicker.tsx` (new), `EmojiTab.tsx` (new), `ServerSettingsPage.tsx` (Emojis tab), `ChatView.tsx`, `SoundboardTab.tsx`, `SoundboardPanel.tsx`, `global.css`.
- **2026-02-19**: EmojiPicker `placement="right"` — added `placement?: "above" | "right"` prop to `EmojiPicker`. The default `"above"` keeps the existing CSS (`position: absolute; bottom: 100%; right: 0`). `"right"` uses `position: fixed` computed via `useLayoutEffect` from the trigger wrapper's `getBoundingClientRect()`, bypassing `overflow: hidden` ancestors (needed in settings modals). Panel starts at `opacity: 0` to prevent flash before JS positioning; flips to left of trigger if no room on right; clamps to viewport edges. Used in `SoundboardTab` add/edit forms. Files: `EmojiPicker.tsx`, `SoundboardTab.tsx`.
- **2026-02-19**: Soundboard image icons removed; emoji rendered via JS library. Image attachments for soundboard sounds removed from the UI entirely. `SoundboardTab` no longer has image upload — only emoji picker. On settings page load, any existing sounds with `imageAttachmentId` are automatically PATCHed to `null` to clean up stale data. `SoundboardPanel.renderSound` and `SoundboardTab` list view now render sound emoji using `renderEmoji()` with `dangerouslySetInnerHTML` (Twemoji for standard, `<img>` for custom) instead of raw text. `api.ts`: `updateSoundboardSound` data type updated to allow `imageAttachmentId?: string | null`. Files: `SoundboardTab.tsx`, `SoundboardPanel.tsx`, `api.ts`.
- **2026-02-19**: ChatView typing lag fix. Three changes to eliminate per-keystroke re-renders: (1) Replaced `const [input, setInput] = useState("")` with `inputValueRef = useRef("")` (stores text without triggering renders) + `const [hasContent, setHasContent] = useState(false)` (only flips at empty↔non-empty boundary). Eliminates ~95%+ of ChatView re-renders while typing. (2) `messageData = useMemo(...)` caches `renderMessageContent` (twemoji.parse + regex), `isEmojiOnly`, and `extractUrls` per message. Dependencies are `[displayMessages, decryptedCache, customEmojis, memberUsernames]` — none change on keystrokes, so cache survives all typing. (3) `emojiTooltipActiveRef = useRef(false)` guards `setEmojiTooltip(null)` calls in `handleMsgMouseOver` and `onMouseLeave` — only calls `setState` when tooltip is actually visible, eliminating redundant scheduler work on every mouse movement. File: `ChatView.tsx`.
- **2026-02-19**: Soundboard button emoji click fix. Clicking a Twemoji `<img>` inside a soundboard button was not triggering the button's `onClick` — browsers can initiate a drag on image elements, absorbing the click. Fixed by adding `pointer-events: none; -webkit-user-drag: none` to `.soundboard-btn-icon img, .soundboard-btn-emoji img` in `global.css`. Clicks now pass through the image to the parent button. File: `global.css`.
- **2026-02-19**: Emoji upload drop zone centering. Added `text-align: center` to `.emoji-upload-drop` in `global.css` so the "Choose image" text centers horizontally within the 64px drop zone. File: `global.css`.
- **2026-02-19**: EmojiPicker `placement="auto"` for reaction picker. Added `"auto"` placement mode to `EmojiPicker` — uses `position: fixed` computed via `useLayoutEffect` from `getBoundingClientRect()`, prefers opening above trigger, falls back to below if insufficient space, clamped to viewport edges. Initial state starts off-screen fixed (`top: -9999`) to prevent scroll flash before JS positioning. Uses `el.parentElement` instead of `el.offsetParent` (which is null for fixed elements). Reaction picker in `ChatView` changed from default `"above"` to `"auto"`. Files: `EmojiPicker.tsx`, `ChatView.tsx`.
- **2026-02-19**: Reactions intermittent failure fix. Root cause: `handleMsgMouseOver` fired for Twemoji imgs inside the picker (bubbled from DOM child), causing `setEmojiTooltip` → ChatView re-render → new inline `onClose` reference → EmojiPicker dismiss effect constantly re-registered document click listener. Fix: (1) stable `handleReactionPickerClose`/`handleReactionPickerSelect` via `useCallback` so the dismiss effect never re-runs during normal renders; (2) guard in `handleMsgMouseOver` to `return` early if target is inside `.emoji-picker-panel` or `.reaction-chip`; (3) wired stable callbacks into EmojiPicker JSX. File: `ChatView.tsx`.
- **2026-02-20**: Highlight own messages setting. Added `highlightOwnMessages: boolean` (default `true`) to `useUIStore` — persisted to localStorage. CSS: replaced unconditional `.message.own { background }` with `.message:hover { background }` (always-on hover) and `.highlight-own .message.own { background }` (parent class gated). ChatView applies `highlight-own` class to messages-container when setting is on. SettingsModal: new "Messages" card in Appearance tab with a `ToggleSwitch`. Files: `stores/ui.ts`, `global.css`, `ChatView.tsx`, `SettingsModal.tsx`.
- **2026-02-20**: Reaction hover tooltip. Hovering a reaction chip shows a custom tooltip (matching emoji-msg-tooltip design) with large emoji image, `:emoji_name:` label, and "reacted by Alice, Bob, and N others" user list. `getEmojiLabel(emoji)` helper added to `lib/emoji.ts` — looks up native unicode chars in `_nativeToId` map, returns `:id:` string. `reactionTooltip` state + `formatReactors()` in ChatView. `onMouseEnter`/`onMouseLeave` on reaction chip buttons (replaces native `title`). Guard in `handleMsgMouseOver` blocks the old emoji tooltip from triggering for `.reaction-chip` descendants. CSS: `.reaction-tooltip` block. Files: `lib/emoji.ts`, `ChatView.tsx`, `global.css`.
- **2026-02-20**: Generalized rooms — removed lobby special-casing. All voice rooms are now equal; no auto-created persistent "Lobby". Backend: removed lobby auto-creation on server signup (`auth.rs`), removed lobby migration for existing servers (`db/mod.rs`), removed `is_persistent` delete/rename guards in `servers.rs`, added empty-room check (rooms can only be deleted when they have 0 voice participants via `gateway.voice_channel_participants()`). Frontend: `ChannelSidebar.tsx` — replaced "Join Voice" button with always-visible "Create Room" button that creates a new room and joins it; room labels show actual name instead of "Lobby". `VoiceChannelView.tsx` — `RoomSwitcherBar` simplified to flat list of all rooms (no persistent/temporary split); close button shown for creator or admin/owner only when room has 0 participants; voice join prompt now creates a new room instead of joining lobby; room auto-naming uses `Room ${rooms.length + 1}`. `chat.ts` — `room_deleted` handler falls back to a text channel instead of seeking the lobby; no voice redirect needed since server enforces empty-room deletion. `is_persistent` column remains in schema (always 0) for backwards compat. Files: `auth.rs`, `db/mod.rs`, `servers.rs`, `ChannelSidebar.tsx`, `VoiceChannelView.tsx`, `chat.ts`.
- **2026-02-20**: Delete message confirmation modal. Clicking the trash icon now sets `deletingMsgId` state instead of immediately calling `deleteMessage`. A confirmation modal renders via `createPortal(…, document.body)` — showing a truncated message preview, "This cannot be undone.", Cancel and Delete (`.btn-danger`) buttons. Portal to body required because `position: fixed` elements are trapped inside CSS stacking contexts; `modal-overlay` z-index bumped from `100` to `9000` (sidebar elements go up to z-index `1200`). Added `.btn-danger` CSS (red-tinted) and `.confirm-delete-modal`/`.confirm-delete-preview`/`.confirm-delete-desc` styles. Files: `ChatView.tsx`, `global.css`.
- **2026-02-20**: Global native context menu suppression. `App.tsx` registers a `document.addEventListener("contextmenu", e => e.preventDefault())` on mount so the browser/OS native right-click menu never appears anywhere in the app. File: `App.tsx`.
- **2026-02-20**: Server sidebar avatar context menu. Right-clicking a non-self member avatar in `ServerSidebar` shows a custom context menu with "Message" — same action as clicking the avatar and pressing Message in the user card. `avatarCtxMenu` state + `onContextMenu` handler added to real member avatar divs (dummy users excluded). File: `components/ServerSidebar.tsx`.
- **2026-02-20**: Custom context menus — chatbox, channels, categories, messages, members, emoji picker. Reusable `ContextMenu` component (`components/ContextMenu.tsx`) renders via `createPortal` to `document.body`. Dismisses on outside `mousedown` (capture), Escape, scroll. Corner-based positioning via `useLayoutEffect`. Supports checkbox items, separators, danger styling. Root div has `onClick stopPropagation` to prevent EmojiPicker dismiss-on-click from firing when clicking context menu items inside the picker. **Chatbox** (right-click message input): Paste, Spellcheck toggle, Show Send Button toggle. **Text channels** (right-click, admin/owner only): Edit channel (opens `ChannelSettingsModal`), Delete channel (opens `DeleteConfirmDialog` — exported from `ChannelSettingsModal.tsx`). **Categories** (right-click, all users): Collapse/Expand; admin/owner also sees Edit/Delete category. **Messages** (right-click on `.message` div): Edit message (own only), Add reaction, Copy text; contextual when right-clicking `<a>`: Open link + Copy link; contextual when right-clicking non-emoji `<img>`: Open image + Save image. **Member list** (right-click, non-self only): Message (opens DM). **Emoji picker cells** (right-click): Add to favorites / Remove from favorites — calls `addStandardFavorite`/`removeStandardFavorite`/`addCustomFavorite`/`removeCustomFavorite` API and updates `stdFavs`/`customFavIds` state + `favCache.data`. `spellcheck` and `showSendButton` booleans added to `useUIStore` (persisted). Files: `components/ContextMenu.tsx` (new), `components/ChannelSettingsModal.tsx` (export `DeleteConfirmDialog`), `components/ChannelSidebar.tsx`, `components/ChatView.tsx`, `components/MemberList.tsx`, `components/EmojiPicker.tsx`, `stores/ui.ts`, `styles/global.css`.
- **2026-02-21**: Multiple AI noise suppression models + WebRTC stats overlay. Replaced single `krispEnabled: boolean` toggle with `noiseSuppressionModel: NoiseSuppressionModel` (`"off" | "rnnoise" | "dtln" | "deepfilter"`) in `AudioSettings`. DTLN (16kHz, balanced) remains default. Added RNNoise (48kHz native, lightweight) via `@shiguredo/rnnoise-wasm` — WASM extracted to `public/rnnoise/rnnoise.wasm`, AudioWorklet at `public/rnnoise/rnnoise-worklet.js`, TrackProcessor at `src/lib/rnnoise/RnnoiseTrackProcessor.ts`. Added DeepFilterNet3 (best quality) with Worker+Worklet architecture — AudioWorklet sends frames to Web Worker for heavy WASM inference, TrackProcessor at `src/lib/deepfilter/DeepFilterTrackProcessor.ts`, assets in `public/deepfilter/`. Processor lifecycle refactored: generic `createNoiseProcessor(model)` / `getOrCreateNoiseProcessor(model)` / `destroyNoiseProcessor()` factory replaces DTLN-specific functions; models are lazy-imported via `import()`. Settings UI: "Noise Cancellation" toggle replaced with `<select>` dropdown (`.settings-select` CSS). **WebRTC stats**: `src/lib/webrtcStats.ts` collects audio bitrate/codec/packet loss/jitter/RTT + video bitrate/codec/resolution/fps via `RTCRtpSender.getStats()` / `RTCRtpReceiver.getStats()` with delta-based bitrate calculation. `StatsOverlay` component (floating, semi-transparent, color-coded thresholds) toggled via Activity icon in voice controls bar. 2s polling interval, starts/stops with overlay visibility. 12 new unit tests (model management + stats collection + overlay toggle), e2e tests updated for dropdown. Files: `stores/voice.ts`, `lib/webrtcStats.ts` (new), `lib/rnnoise/RnnoiseTrackProcessor.ts` (new), `lib/deepfilter/DeepFilterTrackProcessor.ts` (new), `components/StatsOverlay.tsx` (new), `components/SettingsModal.tsx`, `components/VoiceChannelView.tsx`, `public/rnnoise/*`, `public/deepfilter/*`, `styles/global.css`, `stores/__tests__/voice.test.ts`, `lib/__tests__/webrtcStats.test.ts` (new), `e2e/settings-audio.spec.ts`.
- **2026-02-21**: Channel sidebar UX fixes and unread indicator overhaul. **Unread/mention delivery fix**: `selectChannel` no longer sends `leave_channel` on channel switch (client stays subscribed for real-time events); `selectServer` now sends `join_channel` for every text channel after loading so the client receives WS messages from all channels; `onConnect` re-subscribes to all known text channels on reconnect (fallback to active channel if none loaded). This is required because the server only pushes `"message"` events to subscribed clients — previously the unread indicators never fired. **Unread semicircle**: `background` changed from `var(--text-muted)` (#555555, invisible) to `var(--text-primary)` (white). Both the active bar and the unread semicircle now use `left: calc(-8px - var(--ch-indent, 0px))` where `--ch-indent` is a CSS custom property set on the outer DnD div as `depth * 16px` — ensures both indicators always reach the sidebar left edge regardless of nesting depth. **Drag handle moved to right**: `channel-drag-handle` span moved after the settings button in both channel rows and category headers (was before the channel button/toggle). **Channel type icon padding**: `margin-left: 4px` added to `.channel-type-icon`. **Pinned intermediate categories** (collapsed parent with active child deeper than 1 level): `findActiveChild` replaced by `findActivePath` which returns the full ancestor path, marking intermediate categories as `pinned: true`. Pinned categories render with: chevron `visibility: hidden` (preserves layout height), `cursor: default` on toggle button, `onClick` suppressed, settings and drag handle hidden. `SortableChannelItem` receives `isPinned` prop derived from `node.pinned`. `.channel-category-header` gets `min-height: 28px` to prevent height collapse when settings button (28px) is hidden. `.channel-chevron-hidden { visibility: hidden }` CSS class added. Files: `stores/chat.ts`, `components/ChannelSidebar.tsx`, `styles/global.css`.
- **2026-02-21**: Channel sidebar drag, indent, context menu, mute/notification logic overhaul. **Drag-to-reorder**: removed `GripVertical` drag handle from channels and categories; `{...listeners}` moved to outer DnD div (gated on `isOwnerOrAdmin`, `!isPinned` for categories); `PointerSensor` activation changed from `distance: 5` to `delay: 500, tolerance: 5` — hold 500ms without moving to start drag, quick clicks still work. Nesting indent changed from `depth * 16px` to `depth * 12px`. **Channel sidebar background context menu**: right-clicking empty sidebar background (owner/admin only) shows a "Create channel" context menu item that opens `CreateChannelModal` at root. Category right-click (owner/admin) also gets "Create channel" that pre-fills `parentId`. `e.stopPropagation()` added to channel and category `onContextMenu` handlers to prevent bubbling to background handler. **Muted channel visual indicator**: `isMuted` prop added to `SortableChannelItem`; channels/categories with active mute render with `opacity: 0.45` via `.channel-muted` class; mute is inherited (child channel dims if its parent category is muted). **Notification/mute logic overhaul**: Notification settings now strictly control push notifications only. Muting prevents white unread circle + push notifications; @mention badge still shows unless "Mute @mentions" is also enabled. Specifically: `"message"` WS handler now gates the white circle on `!isAnyMuted` (channel or category muted), gates the red badge on `isMention && !isMentionMuted` (independent of channel mute), and always caches messages for instant channel loading. `stores/notifications.ts`: added `mutedMentionChannels` and `mutedMentionCategories` (persisted `Record<string, boolean>`) plus `setMuteChannelMentions`, `setMuteCategoryMentions`, `isChannelMentionMuted`, `isCategoryMentionMuted` actions/selectors. **"Mute @mentions" checkbox** added to the mute submenu in `ChannelSidebar` (always visible, persists independently of mute duration). **Mute channel/category items now directly clickable**: clicking "Mute channel"/"Muted" at the top level of the context menu mutes indefinitely / unmutes respectively (close menu); hovering still opens the time-duration submenu. `ContextMenu.tsx`: removed `hasSub` from the `onClick` guard so items can have both `onClick` and `submenu` simultaneously. Files: `components/ChannelSidebar.tsx`, `components/ContextMenu.tsx`, `stores/notifications.ts`, `stores/chat.ts`, `styles/global.css`.
- **2026-02-21**: Notification system overhaul + message indicators. **New `stores/notifications.ts`** — Zustand store persisted to `flux-notif-prefs`; manages per-channel notification settings (`all`/`only_mentions`/`none`/`default`), per-category settings (`all`/`only_mentions`/`none`), time-based channel/category mutes (unix ms timestamp, `-1`=indefinite), and muted user IDs. `getEffectiveChannelSetting(channelId, categoryId)` resolves channel→category→global default (`only_mentions`). **`lib/notifications.ts`**: Added `shouldNotifyChannel(channelId, senderId, content, categoryId?, authUsername?)` — checks DND, muted user, muted channel, muted category, effective setting, and @mention via word-boundary regex. **`stores/chat.ts`**: Added `mentionCounts: Record<string, number>` state; `markChannelRead(channelId)` action; updated `selectChannel` to also clear `mentionCounts` for channel; rewrote `"message"` WS handler to: skip unread tracking for muted senders, detect @mention, increment `mentionCounts`, call `shouldNotifyChannel` instead of unconditionally notifying (text channels now only notify for @mentions by default); updated `"dm_message"` WS handler to check if sender is muted before notifying; added lazy `notifStoreRef` alongside `authStoreRef`. **`components/ContextMenu.tsx`**: Added `submenu?: ContextMenuEntry[]` to `ContextMenuItem` (`onClick` now optional); submenu renders as second `createPortal` panel positioned adjacent to hovered item via `useLayoutEffect`; 150ms delay before closing so mouse can travel from item to submenu; dismiss handler updated to include submenu panel. **`components/ChannelSidebar.tsx`**: Text channel right-click now available to ALL users (was admin/owner only); new items: "Mark as read" (if unread), "Notification settings" submenu (4 radio options), "Mute channel" submenu (5 durations + unmute); category right-click: "Notification settings" submenu (3 options), "Mute category" submenu; admin/owner items still gated; replaced `channel-unread-dot` span with `channel-mention-badge` (red pill number badge); added `channel-item-has-unread` and `channel-item-has-mention` classes to `channel-item-wrapper` div for CSS-driven semicircle and badge. **`components/ServerSidebar.tsx`** and **`components/MemberList.tsx`**: Added "Mute user"/"Unmute user" to avatar/member context menus via `notifStore.muteUser/unmuteUser`. **`styles/global.css`**: Removed `.channel-unread-dot`; added `.channel-item-has-unread::before` (left-edge semicircle pill: `left: -8px; width: 3px; height: 8px; border-radius: 0 3px 3px 0`); added `.channel-mention-badge` (red pill, `background: #ed4245`); added `.context-menu-item.has-submenu::after` (`▶` arrow). Files: `stores/notifications.ts` (new), `lib/notifications.ts`, `stores/chat.ts`, `components/ContextMenu.tsx`, `components/ChannelSidebar.tsx`, `components/ServerSidebar.tsx`, `components/MemberList.tsx`, `styles/global.css`.
- **2026-02-21**: Room features — auto-cleanup, locked rooms, drag-to-invite, quick-move. Four enhancements to the room system: (1) **Auto-cleanup**: Rooms no longer delete instantly when the last person leaves. A 30s grace period (`schedule_room_cleanup` on `GatewayState`) uses `tokio::spawn` + `tokio::time::sleep`; rejoining within 30s cancels the timer (`cancel_room_cleanup`). `cleanup_timers: RwLock<HashMap<String, JoinHandle<()>>>` tracks pending deletions. (2) **Locked rooms**: `is_locked` column added to channels (INTEGER DEFAULT 0). Room creators can toggle lock via padlock icon in ChannelSidebar. Clicking a locked room (non-creator/non-admin) sends `room_knock` WS event instead of joining; creator/admins see a toast notification with Accept/Dismiss buttons. Accept calls `POST /servers/:serverId/rooms/:channelId/accept-knock` which sends `room_knock_accepted` to the knocker, triggering auto-join. `RoomLockToggled` event broadcasts lock state changes. (3) **Drag-to-invite**: Member list items (`MemberList.tsx`) are now `draggable` with `application/flux-member` dataTransfer. Room groups in ChannelSidebar accept drops — `onDragOver`/`onDrop` handlers call `POST /servers/:serverId/rooms/:channelId/invite`, which sends `room_invite` WS event to the target user. Target sees a toast with Join/Dismiss. (4) **Quick-move**: Admin/owner can right-click a user in a room's expanded participant list to open a context menu (portal to `document.body`) listing other rooms. Selecting one calls `POST /servers/:serverId/rooms/:channelId/move`, which sends `room_force_move` to the target user, auto-joining them to the new room. New file: `RoomToasts.tsx` (knock + invite toast notifications, auto-dismiss 15s). Backend: 3 new routes in `routes/mod.rs`, 6 new event variants in `events.rs`. Frontend: `roomKnocks`/`roomInvites` arrays in chat store. Test setup (`tests/common/mod.rs`) updated with channel room column migrations. Files: `gateway.rs`, `handler.rs`, `events.rs`, `models.rs`, `db/mod.rs`, `routes/servers.rs`, `routes/mod.rs`, `shared.ts`, `api.ts`, `chat.ts`, `ChannelSidebar.tsx`, `MemberList.tsx`, `RoomToasts.tsx` (new), `MainLayout.tsx`, `global.css`, `tests/common/mod.rs`.
- **2026-02-23**: Voice store cleanup (Tasks 2.1-2.4). (1) Extracted magic numbers (lobby music timings, default bitrate, audio level polling interval) from `stores/voice.ts` and `lib/voice-analysis.ts` into new `lib/voice-constants.ts`. (2) Deduplicated the `destroyNoiseProcessor() + setDryWetProcessor(null) + setGainTrackProcessor(null)` pattern (3 occurrences) into a single `cleanupAudioProcessors()` async helper. (3) Added `dbg()` logging to all 8 silent `catch {}` / `.catch(() => {})` blocks in voice.ts (localStorage, AudioContext close, mic track stop, Spotify leave, screen share constraints). (4) Encapsulated 4 module-level lobby music variables (`lobbyMusicTimer`, `lobbyMusicAudio`, `lobbyMusicGain`, `lobbyMusicCtx`) into a single `lobbyMusicState` object. All 16 voice tests pass. Files: `stores/voice.ts`, `lib/voice-analysis.ts`, `lib/voice-constants.ts` (new).
- **2026-02-23**: Chat system cleanup (Tasks 3.1-3.3). (1) Extracted 4 contentEditable helper functions (`getCharOffset`, `setCursorAtOffset`, `getDivPlainText`, `getTextBeforeCursor`) from `ChatView.tsx` into new `lib/contentEditable.ts`. (2) Replaced `any` types in `lib/api.ts`: auth functions now use `AuthResponse` interface, Spotify search uses `SpotifySearchResponse` (references `SpotifyTrack` from shared types); added TODO comment on JSON parse error catch. (3) Extracted inline mute-checking logic in `stores/chat-events.ts` into `isChannelOrCategoryMuted()` and `isMentionMuted()` helper functions. All 342 frontend tests pass. Files: `lib/contentEditable.ts` (new), `components/ChatView.tsx`, `lib/api.ts`, `stores/chat-events.ts`.
- **2026-02-23**: Dead code cleanup — removed dead migrations, vestigial columns. (1) Removed silently-failing ALTER TABLE RENAME COLUMN migrations in `db/mod.rs` (`messages.ciphertext→content`, `dm_messages.plaintext→ciphertext`) — columns already have the correct names in `schema.sql`. (2) Removed `is_persistent` column from channels table (`schema.sql`, `models.rs`, `shared.ts`), all INSERT/SELECT queries referencing it (`servers.rs`, `auth.rs`, `handler.rs`, `gateway.rs`, `main.rs`), the migration that added it (`db/mod.rs`), and the lobby cleanup migration. All rooms are now equal — no persistent/temporary distinction. (3) Removed soundboard `image_attachment_id` and `image_filename` columns from `schema.sql`, `soundboard.rs` (struct + all SQL queries), `events.rs` (SoundboardPlay event), `handler.rs` (play_sound WS handler), `shared.ts`, `api.ts`, and `SoundboardTab.tsx` (image cleanup logic). Soundboard images were replaced by emoji rendering. (4) Removed `persistent_room_not_cleaned_up` test from `room_cleanup_test.rs`. All 197 backend tests and 342 frontend tests pass.
- **2026-02-23**: Dead CSS selector audit (Task 5.1). Audited all 13 CSS files in `src/styles/` against TSX/TS source for unreferenced selectors. Removed: (1) `.voice-ctrl-btn.drink-btn` (drink button removed from voice controls) in `voice.css`. (2) `.voice-status-label.lobby-music-unlocked` and `@keyframes lobby-unlock-flash` (easter egg trigger removed from VoiceStatusBar) in `voice.css`. (3) `.room-lock-icon` (unused — `.room-lock-toggle` is the live class) in `voice.css`. (4) `.music-search-header` selector from compound vibe-mode rule in `music.css`. (5) `.room-switcher` and 10 related selectors (RoomSwitcherBar component removed from VoiceChannelView) in `sidebar.css`. (6) `.server-sidebar-user`, `.server-user-avatar-ring`, `.server-user-avatar`, `.server-user-avatar-img`, `.server-user-logout` and related selectors (server sidebar user section removed) in `sidebar.css`. Confirmed dynamically-generated classes (e.g. `app-border-${style}`, `ring-style-${style}`, `sidebar-${position}`, `sidebar-pos-${value}`) are alive via template literals. All 342 frontend tests pass. Files: `styles/voice.css`, `styles/music.css`, `styles/sidebar.css`.
- **2026-02-23**: Test gap coverage (Task 6.1). Added 52 new unit tests across 3 new test files for previously untested modules: (1) `lib/__tests__/contentEditable.test.ts` — 12 tests for `getDivPlainText` (empty div, text nodes, img alt text, nested elements) and `getCharOffset` (single node, multiple nodes, img counted as 1 char). `setCursorAtOffset` and `getTextBeforeCursor` skipped (require real browser Selection API). (2) `lib/__tests__/emoji.test.ts` — 24 tests for `getEmojiLabel` (passthrough :name:, native lookup, unknown chars), `renderEmoji` (custom img tags, unknown custom, native passthrough), `isEmojiOnly` (empty, standard, custom, mixed, maxCount), `renderMessageContent` (empty, HTML escaping, URLs, @mentions, @everyone/@here, custom emoji, combined). twemoji mocked. (3) `lib/__tests__/channel-tree.test.ts` — 16 tests for `buildTree` (empty, root-level, nesting, sort order, non-category parents, multiple categories), `flattenTree` (expanded, collapsed, active path pinning, deep pinned path, nonexistent active), `loadCollapsed`/`saveCollapsed` (empty, round-trip, corrupted JSON). Total frontend tests: 394 (up from 342). Files: `lib/__tests__/contentEditable.test.ts` (new), `lib/__tests__/emoji.test.ts` (new), `lib/__tests__/channel-tree.test.ts` (new).
- **2026-02-23**: Dependency audit (Tasks 7.1-7.2). **npm**: All 18 dependencies verified as actively used (including `@dnd-kit/utilities` via CSS import in SortableChannelItem, `@sapphi-red/web-noise-suppressor` via SpeexTrackProcessor, `@emoji-mart/data` via EmojiPicker+emoji.ts). `npm audit` reports 0 vulnerabilities. **Cargo**: Removed 2 unused dependencies from `crates/server/Cargo.toml`: `axum-extra` (typed-header + cookie features, not imported anywhere) and `nanoid` (not imported anywhere). All 197 backend tests pass after removal. Files: `crates/server/Cargo.toml`, `Cargo.lock`.
- **2026-02-23**: Extract YouTube store from spotify.ts (Task 1.1). All YouTube-related state and actions extracted from `stores/spotify.ts` into new `stores/youtube.ts`. YouTube store (`useYouTubeStore`) owns: audio element, track info, progress/duration, paused state, search results, searchLoading, searchError, and actions (searchYouTube, addYouTubeToQueue, playYouTube, pauseYouTube, stopYouTube, setYouTubeVolume, updateYouTubeActivity). Spotify store retains session/queue coordination and calls into YouTube store via `yt()` helper for cross-store operations (play/pause/skip/seek/volume/WS sync). Updated consumers: `MusicPanel.tsx` and `VoiceChannelView.tsx` now import YouTube state from `useYouTubeStore`. All 394 frontend tests pass. Files: `stores/youtube.ts` (new), `stores/spotify.ts`, `components/MusicPanel.tsx`, `components/VoiceChannelView.tsx`.
- **2026-02-23**: Extract DM store from chat.ts (Task 1.2). All DM-related state and actions extracted from `stores/chat.ts` into new `stores/dm.ts`. DM store (`useDMStore`) owns: `showingDMs`, `dmChannels`, `activeDMChannelId`, `dmMessages`, `dmHasMore`, `dmCursor`, `dmSearchQuery`, `dmSearchResults`, `dmError`, `loadingDMMessages`, and actions (`showDMs`, `loadDMChannels`, `selectDM`, `openDM`, `sendDM`, `clearDmError`, `retryEncryptionSetup`, `loadMoreDMMessages`, `searchDMMessages`, `clearDMSearch`). Chat store retains `decryptedCache` as shared resource (both DM and channel messages write to it). Cross-store coordination via lazy refs: `dm.ts` has `chatStoreRef` (typed as `UseBoundStore<StoreApi<ChatState>>` to avoid circular type references), `chat.ts` has `dmStoreRef`, `chat-events.ts` has `dmStoreRef`. `loadingDMMessages` is now a separate field from `loadingMessages`. `DMChannel` interface exported from `dm.ts`. `saveDMCache` signature in `chat-types.ts` updated to accept generic shape instead of `ChatState`. Updated consumers: `DMChatView.tsx`, `MainLayout.tsx`, `ServerSidebar.tsx`, `MemberList.tsx`, `VoiceUserRow.tsx`. Updated test mocks in `chat.test.ts` and `chat-rooms.test.ts`. Chat store reduced from ~677 to ~434 lines. All 394 frontend tests pass. Files: `stores/dm.ts` (new), `stores/chat.ts`, `stores/chat-types.ts`, `stores/chat-events.ts`, `components/DMChatView.tsx`, `layouts/MainLayout.tsx`, `components/ServerSidebar.tsx`, `components/MemberList.tsx`, `components/VoiceUserRow.tsx`, `stores/__tests__/chat.test.ts`, `stores/__tests__/chat-rooms.test.ts`.
- **2026-02-23**: Group audio files into lib/audio/ (Task 2.1). Moved all audio-related files from flat `src/lib/` into new `src/lib/audio/` subdirectory using `git mv` (preserves history). Files moved: `voice-pipeline.ts`, `voice-analysis.ts`, `voice-noise.ts`, `voice-effects.ts`, `voice-constants.ts`, `DryWetTrackProcessor.ts`, `GainTrackProcessor.ts`. Directories moved: `rnnoise/`, `nsnet2/`, `speex/`, `dtln/`, `deepfilter/`. Updated all import paths: `stores/voice.ts` (5 static imports + 5 dynamic `import()` calls), `lib/audio/voice-pipeline.ts` (debug + stores type import), `lib/audio/voice-analysis.ts` (debug import), `lib/audio/voice-noise.ts` (stores type import), `lib/__tests__/noise-suppression.test.ts` (6 imports), `lib/__tests__/gain-track-processor.test.ts` (1 import), `stores/__tests__/voice.test.ts` (1 mock path), `stores/__tests__/audio-settings.test.ts` (1 mock path). Internal relative imports within `audio/` (e.g. `./voice-pipeline.js`) unchanged since files remain co-located. All 394 frontend tests pass. Files: all files in `src/lib/audio/`, `stores/voice.ts`, test files.
- **2026-02-23**: Voice store section organization (Task 1.3). Analyzed coupling between screen share, audio settings, and core voice domains in `stores/voice.ts`. Determined splitting would create circular dependencies (10+ cross-references per domain to shared `room` state and `set()`). Instead, organized the file into clearly marked sections with `═══` separator headers. Sections: **Types & Constants** (interfaces, presets, default settings), **Audio Settings Persistence** (load/save from localStorage), **Audio Processor Helpers** (cleanup, nonce, adaptive bitrate), **WebRTC Stats Polling** (start/stop interval), **Lobby Music** (check/start/fadeOut/stop/gain), **Store Definition** with internal action groups: *Core Connection* (join/leave/mute/deafen/volume/drink), *Audio Settings & Pipeline Control* (updateAudioSetting/applyBitrate), *Screen Sharing* (toggle/pin/unpin/theatre/quality), *Lobby Music* (volume/stop), *WebRTC Stats* (toggle overlay), *Internal* (participant/screen share tracking), **WebSocket Event Handlers** (voice_state, reconnect), **BroadcastChannel Sync** (popout windows). Also cleaned up import ordering (grouped by category, removed interleaved type export). Pure refactor — no functionality changed. All 394 frontend tests pass. File: `stores/voice.ts`.
- **2026-02-24**: Extract MusicVisualizer component (Task 4.2). Extracted the inline `MusicVisualizer` sub-component from `MusicPanel.tsx` into its own file `src/components/music/MusicVisualizer.tsx`. Extracted code includes: WebGL shader source strings (VERT_SRC, FRAG_SRC with kaleidoscopic Julia fractal), `VisualizerParams` interface, 3 presets, `randomParams()` helper, and the full `MusicVisualizer` component with canvas rendering, WebGL2 init/cleanup, animation frame loop, and controls overlay (preset buttons, parameter sliders). Added `MusicVisualizerProps` exported interface. MusicPanel.tsx reduced from 660 to 385 lines. Cleaned up unused imports (`Shuffle`, `dbg`, `SpotifyTrack`, `YouTubeTrack` types). All 394 frontend tests pass. Files: `components/music/MusicVisualizer.tsx` (new, 258 lines), `components/music/MusicPanel.tsx`.
- **2026-02-24**: Reorganize components into domain subdirectories (Tasks 3.1-3.4). Moved 22 component files from flat `src/components/` into 6 domain-grouped subdirectories using `git mv` (preserves history). **voice/**: `VoiceChannelView.tsx`, `VoiceUserRow.tsx`, `VoiceStatusBar.tsx`, `StatsOverlay.tsx`, `RoomToasts.tsx`. **chat/**: `ChatView.tsx`, `DMChatView.tsx`, `SearchBar.tsx`, `LinkEmbed.tsx`, `MessageAttachments.tsx`. **sidebar/**: `ChannelSidebar.tsx`, `ServerSidebar.tsx`, `SortableChannelItem.tsx`, `MemberList.tsx`. **modals/**: `AvatarCropModal.tsx`, `ChannelSettingsModal.tsx`, `CreateChannelModal.tsx`. **music/**: `MusicPanel.tsx`, `SoundboardPanel.tsx`, `SoundboardTab.tsx`. **popout/**: `PopoutChatView.tsx`, `PopoutScreenShareView.tsx`. Files staying at top level (shared/generic): `AnimatedList.tsx`, `ContextMenu.tsx`, `EmojiPicker.tsx`, `EmojiTab.tsx`, `FluxLogo.tsx`, `SettingsModal.tsx`, `ServerSettingsPage.tsx`. Updated all import paths in 18 files: moved files (internal `../stores/` -> `../../stores/`, `../lib/` -> `../../lib/`, `../types/` -> `../../types/`), cross-group references (e.g. VoiceChannelView imports `../music/MusicPanel.js`), consumers (`MainLayout.tsx`, `PopoutApp.tsx`, `settings/ProfileTab.tsx`, `ServerSettingsPage.tsx`). All 394 frontend tests pass. Files: all listed above plus `layouts/MainLayout.tsx`, `PopoutApp.tsx`, `components/settings/ProfileTab.tsx`, `components/ServerSettingsPage.tsx`, `context.md`.
- **2026-02-24**: Extract VoiceChannelView sub-components (Task 4.1). Extracted 3 sub-component groups from `VoiceChannelView.tsx` into their own files under `src/components/voice/`: (1) `StreamTile.tsx` (130 lines) — `StreamTile` (attaches LiveKit video track to `<video>` element, pin/unpin/theatre/popout actions) and `DummyStreamTile` (placeholder tile for showDummyUsers mode), plus `applyMaxQuality` helper and exported `StreamTileProps`/`DummyStreamTileProps` interfaces. (2) `ParticipantTile.tsx` (30 lines) — wrapper div that subscribes to `speakingUserIds` for speaking class updates without parent re-render, with exported `ParticipantTileProps` interface. (3) `LobbyMusicBar.tsx` (46 lines) — lobby music easter egg progress bar with volume slider and stop button. `SpeakingAvatar` (27 lines) kept inline in VoiceChannelView.tsx. VoiceChannelView.tsx reduced from 649 to 466 lines. Cleaned up imports: removed `livekit-client` types, removed unused lucide icons (`ArrowUpRight`, `Pin`, `PinOff`, `Maximize2`, `Minimize2`, `Square`), removed `ReactNode` type. Pure refactor — no behavior changes. All 394 frontend tests pass, TypeScript compiles clean. Files: `components/voice/StreamTile.tsx` (new), `components/voice/ParticipantTile.tsx` (new), `components/voice/LobbyMusicBar.tsx` (new), `components/voice/VoiceChannelView.tsx`.
- **2026-02-24**: Remove dead incrementDrinkCount (Task 1.4). Removed the never-called `incrementDrinkCount` action from `stores/voice.ts` — it sent `voice_drink_update` WS event but was never invoked from any component. The `drinkCount` field on `VoiceUser` stays (part of WS protocol). All 394 frontend tests pass. File: `stores/voice.ts`.
- **2026-02-24**: Add Spotify store tests (Task 5.1). Created `stores/__tests__/spotify.test.ts` with 71 tests covering: initial state, volume control (5 tests), search state (10), searchTracks (6), queue management (9), session state transitions (12), WS event handling (10), playback controls (12), player lifecycle (3), activity updates (4). Mocks: `lib/api.js`, `lib/ws.js`, `lib/debug.js`, `lib/serverUrl.js`, cross-store deps (`auth.js`, `voice.js`). Total frontend tests: 519. File: `stores/__tests__/spotify.test.ts` (new).
- **2026-02-24**: Add notifications store tests (Task 5.2). Created `stores/__tests__/notifications.test.ts` with 53 tests covering: default values (8), setChannelSetting (4), setCategorySetting (3), setDefaultChannelSetting (2), channel muting (6), category muting (6), user muting (5), channel mention muting (4), category mention muting (3), getEffectiveChannelSetting cascade resolution (10), persistence via localStorage (2). Total frontend tests: 519. File: `stores/__tests__/notifications.test.ts` (new, 393 lines).
