pub const APP_NAME: &str = "Flux";

// Limits
pub const MAX_MESSAGE_LENGTH: usize = 4000;
pub const MAX_SERVER_NAME_LENGTH: usize = 100;
pub const MAX_CHANNEL_NAME_LENGTH: usize = 100;
pub const MAX_USERNAME_LENGTH: usize = 32;
pub const MIN_USERNAME_LENGTH: usize = 2;
pub const MIN_PASSWORD_LENGTH: usize = 8;

pub const MESSAGE_PAGE_SIZE: i64 = 50;

// WebSocket
pub const WS_HEARTBEAT_INTERVAL_MS: u64 = 30_000;
pub const WS_RECONNECT_BASE_DELAY_MS: u64 = 1_000;
pub const WS_RECONNECT_MAX_DELAY_MS: u64 = 30_000;
