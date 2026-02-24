pub mod auth;
pub mod dms;
pub mod emojis;
pub mod files;
pub mod keys;
pub mod messages;
pub mod servers;
pub mod soundboard;
pub mod spotify;
pub mod users;
pub mod voice;
pub mod whitelist;
pub mod youtube;

use crate::ws;
use crate::AppState;
use axum::{extract::{DefaultBodyLimit, Path}, response::IntoResponse, routing::{get, post, patch, delete, put}, Router};
use std::sync::Arc;

pub fn build_router(state: Arc<AppState>) -> Router {
    let auth_routes = Router::new()
        .route("/sign-up/email", post(auth::sign_up))
        .route("/sign-in/email", post(auth::sign_in))
        .route("/sign-out", post(auth::sign_out))
        .route("/get-session", get(auth::get_session));

    let api_routes = Router::new()
        // Servers
        .route("/servers", get(servers::list_servers))
        .route("/servers/{serverId}", get(servers::get_server))
        .route("/servers/{serverId}", patch(servers::update_server))
        .route("/servers/{serverId}/members/me", delete(servers::leave_server))
        .route("/servers/{serverId}/channels", get(servers::list_channels))
        .route("/servers/{serverId}/channels", post(servers::create_channel))
        .route("/servers/{serverId}/channels/{channelId}", patch(servers::update_channel))
        .route("/servers/{serverId}/channels/{channelId}", delete(servers::delete_channel))
        .route("/servers/{serverId}/channels/reorder", put(servers::reorder_channels))
        .route("/servers/{serverId}/rooms/{channelId}/accept-knock", post(servers::accept_knock))
        .route("/servers/{serverId}/rooms/{channelId}/invite", post(servers::invite_to_room))
        .route("/servers/{serverId}/rooms/{channelId}/move", post(servers::move_user))
        .route("/servers/{serverId}/members", get(servers::list_members))
        // Role management
        .route("/members/{userId}/role", patch(servers::update_member_role))
        // Email whitelist
        .route("/whitelist", get(whitelist::list_whitelist))
        .route("/whitelist", post(whitelist::add_to_whitelist))
        .route("/whitelist/{id}", delete(whitelist::remove_from_whitelist))
        // Messages
        .route("/channels/{channelId}/messages", get(messages::list_messages))
        .route("/channels/{channelId}/messages/search", get(messages::search_messages))
        .route("/servers/{serverId}/messages/search", get(messages::search_server_messages))
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
        .route("/spotify/sessions/{sessionId}/queue/{itemId}", delete(spotify::remove_from_queue))
        .route("/spotify/sessions/{sessionId}/end", delete(spotify::delete_session))
        // YouTube
        .route("/youtube/search", get(youtube::search))
        .route("/youtube/audio/{videoId}", get(youtube::stream_audio))
        // Soundboard
        .route("/servers/{serverId}/soundboard", get(soundboard::list_sounds))
        .route("/servers/{serverId}/soundboard", post(soundboard::create_sound))
        .route("/servers/{serverId}/soundboard/{soundId}", patch(soundboard::update_sound).delete(soundboard::delete_sound))
        .route("/servers/{serverId}/soundboard/{soundId}/favorite", post(soundboard::favorite_sound).delete(soundboard::unfavorite_sound))
        // Custom emoji
        .route("/servers/{serverId}/emojis", get(emojis::list_emojis).post(emojis::create_emoji))
        .route("/servers/{serverId}/emojis/{emojiId}", delete(emojis::delete_emoji))
        .route("/me/emoji-favorites", get(emojis::list_emoji_favorites))
        .route("/me/emoji-favorites/standard", post(emojis::add_standard_favorite).delete(emojis::remove_standard_favorite))
        .route("/me/emoji-favorites/custom/{emojiId}", post(emojis::add_custom_favorite).delete(emojis::remove_custom_favorite));

    Router::new()
        .nest("/api/auth", auth_routes)
        .nest("/api", api_routes)
        .route("/gateway", get(ws::handler::ws_handler))
        // Proxy DeepFilter model CDN to avoid CORS in Tauri production builds
        .route("/deepfilter-cdn/{*path}", get(proxy_deepfilter_cdn))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024)) // 10 MB for GIF avatars
        .with_state(state)
}

/// Proxy requests to cdn.mezon.ai for DeepFilter model files (avoids CORS in Tauri)
async fn proxy_deepfilter_cdn(
    Path(path): Path<String>,
) -> impl axum::response::IntoResponse {
    let url = format!(
        "https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/{}",
        path
    );
    let upstream = match reqwest::get(&url).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("DeepFilter CDN proxy failed: {}", e);
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                "Failed to fetch model",
            )
                .into_response();
        }
    };
    let status =
        axum::http::StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(axum::http::StatusCode::OK);
    let mut headers = axum::http::HeaderMap::new();
    if let Some(ct) = upstream.headers().get(axum::http::header::CONTENT_TYPE) {
        headers.insert(axum::http::header::CONTENT_TYPE, ct.clone());
    }
    if let Some(cl) = upstream.headers().get(axum::http::header::CONTENT_LENGTH) {
        headers.insert(axum::http::header::CONTENT_LENGTH, cl.clone());
    }
    let body = axum::body::Body::from_stream(upstream.bytes_stream());
    (status, headers, body).into_response()
}
