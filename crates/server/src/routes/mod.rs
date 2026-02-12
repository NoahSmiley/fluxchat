pub mod auth;
pub mod dms;
pub mod files;
pub mod keys;
pub mod messages;
pub mod servers;
pub mod spotify;
pub mod users;
pub mod voice;

use crate::ws;
use crate::AppState;
use axum::{routing::{get, post, patch, delete}, Router};
use std::sync::Arc;

pub fn build_router(state: Arc<AppState>) -> Router {
    let auth_routes = Router::new()
        .route("/sign-up/email", post(auth::sign_up))
        .route("/sign-in/email", post(auth::sign_in))
        .route("/sign-out", post(auth::sign_out))
        .route("/get-session", get(auth::get_session));

    let api_routes = Router::new()
        // Servers
        .route("/servers", post(servers::create_server))
        .route("/servers", get(servers::list_servers))
        .route("/servers/join", post(servers::join_server))
        .route("/servers/{serverId}", get(servers::get_server))
        .route("/servers/{serverId}", patch(servers::update_server))
        .route("/servers/{serverId}", delete(servers::delete_server))
        .route("/servers/{serverId}/members/me", delete(servers::leave_server))
        .route("/servers/{serverId}/channels", get(servers::list_channels))
        .route("/servers/{serverId}/channels", post(servers::create_channel))
        .route("/servers/{serverId}/channels/{channelId}", patch(servers::update_channel))
        .route("/servers/{serverId}/channels/{channelId}", delete(servers::delete_channel))
        .route("/servers/{serverId}/members", get(servers::list_members))
        // Messages
        .route("/channels/{channelId}/messages", get(messages::list_messages))
        .route("/channels/{channelId}/messages/search", get(messages::search_messages))
        .route("/messages/reactions", get(messages::get_reactions))
        // DMs
        .route("/dms", get(dms::list_dms))
        .route("/dms", post(dms::create_dm))
        .route("/dms/{dmChannelId}/messages", get(dms::list_dm_messages))
        .route("/dms/{dmChannelId}/messages/search", get(dms::search_dm_messages))
        .route("/users/search", get(dms::search_users))
        // Users
        .route("/users/me", get(users::get_me))
        .route("/users/me", patch(users::update_me))
        // E2EE Keys
        .route("/users/me/public-key", axum::routing::put(keys::set_public_key))
        .route("/users/{userId}/public-key", get(keys::get_public_key))
        .route("/servers/{serverId}/keys", post(keys::store_server_key))
        .route("/servers/{serverId}/keys/me", get(keys::get_my_server_key))
        .route("/servers/{serverId}/keys/{userId}", post(keys::share_server_key))
        // Voice
        .route("/voice/token", post(voice::get_token))
        // Files
        .route("/upload", post(files::upload))
        .route("/files/{id}/{filename}", get(files::serve_file))
        .route("/link-preview", get(files::link_preview))
        // Spotify
        .route("/spotify/auth-info", get(spotify::get_auth_info))
        .route("/spotify/init-auth", post(spotify::init_auth))
        .route("/spotify/callback", get(spotify::spotify_callback_get))
        .route("/spotify/callback", post(spotify::spotify_callback_post))
        .route("/spotify/unlink", post(spotify::unlink_spotify))
        .route("/spotify/token", get(spotify::get_token))
        .route("/spotify/search", get(spotify::search_tracks))
        .route("/spotify/sessions", post(spotify::create_session))
        .route("/spotify/sessions/channel/{voiceChannelId}", get(spotify::get_session))
        .route("/spotify/sessions/{sessionId}/queue", post(spotify::add_to_queue))
        .route("/spotify/sessions/{sessionId}/end", delete(spotify::delete_session));

    Router::new()
        .nest("/api/auth", auth_routes)
        .nest("/api", api_routes)
        .route("/gateway", get(ws::handler::ws_handler))
        .with_state(state)
}
