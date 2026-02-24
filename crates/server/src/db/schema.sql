-- Auth tables (Better Auth compatible column names)
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expiresAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "account" (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

-- E2EE tables
CREATE TABLE IF NOT EXISTS "devices" (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    display_name TEXT,
    signing_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS "key_packages" (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES "devices"(id) ON DELETE CASCADE,
    key_package TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Application tables
CREATE TABLE IF NOT EXISTS "servers" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES "user"(id),
    invite_code TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "channels" (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES "servers"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    bitrate INTEGER,
    parent_id TEXT REFERENCES "channels"(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "messages" (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES "channels"(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES "user"(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    edited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS "memberships" (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES "servers"(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    role_updated_at TEXT,
    PRIMARY KEY (user_id, server_id)
);

-- Email whitelist (gates registration)
CREATE TABLE IF NOT EXISTS "email_whitelist" (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    added_by TEXT NOT NULL REFERENCES "user"(id),
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "reactions" (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES "messages"(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

CREATE TABLE IF NOT EXISTS "dm_channels" (
    id TEXT PRIMARY KEY,
    user1_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    user2_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_channels_users ON dm_channels(user1_id, user2_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_channels_pair ON dm_channels(user1_id, user2_id);

CREATE TABLE IF NOT EXISTS "dm_messages" (
    id TEXT PRIMARY KEY,
    dm_channel_id TEXT NOT NULL REFERENCES "dm_channels"(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES "user"(id),
    ciphertext TEXT NOT NULL,
    mls_epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_channel_time ON dm_messages(dm_channel_id, created_at);

-- Attachments
CREATE TABLE IF NOT EXISTS "attachments" (
    id TEXT PRIMARY KEY,
    message_id TEXT REFERENCES "messages"(id) ON DELETE CASCADE,
    uploader_id TEXT NOT NULL REFERENCES "user"(id),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

-- Link preview cache
CREATE TABLE IF NOT EXISTS "link_previews" (
    url TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    image TEXT,
    domain TEXT,
    fetched_at TEXT NOT NULL
);

-- Soundboard
CREATE TABLE IF NOT EXISTS "soundboard_sounds" (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES "servers"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT,
    audio_attachment_id TEXT NOT NULL REFERENCES "attachments"(id) ON DELETE CASCADE,
    image_attachment_id TEXT REFERENCES "attachments"(id) ON DELETE SET NULL,
    volume REAL NOT NULL DEFAULT 1.0,
    created_by TEXT NOT NULL REFERENCES "user"(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soundboard_server ON soundboard_sounds(server_id);

CREATE TABLE IF NOT EXISTS "soundboard_favorites" (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    sound_id TEXT NOT NULL REFERENCES soundboard_sounds(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, sound_id)
);

-- Custom emoji
CREATE TABLE IF NOT EXISTS "custom_emojis" (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES "servers"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    attachment_id TEXT NOT NULL REFERENCES "attachments"(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    uploader_id TEXT NOT NULL REFERENCES "user"(id),
    created_at TEXT NOT NULL,
    UNIQUE(server_id, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id);

CREATE TABLE IF NOT EXISTS "standard_emoji_favorites" (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, emoji)
);

CREATE TABLE IF NOT EXISTS "custom_emoji_favorites" (
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    emoji_id TEXT NOT NULL REFERENCES custom_emojis(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, emoji_id)
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id,
    plaintext,
    tokenize='porter unicode61'
);

-- E2EE: server encryption keys (group key wrapped per-member)
CREATE TABLE IF NOT EXISTS "server_keys" (
    server_id TEXT NOT NULL REFERENCES "servers"(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    encrypted_key TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id)
);
