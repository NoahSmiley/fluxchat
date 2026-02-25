mod broadcast;
mod voice;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

use crate::ws::events::ActivityInfo;

pub type ClientId = u64;

/// channel_id -> user_id -> (username, drink_count)
type VoiceParticipantMap = HashMap<String, HashMap<String, (String, i32)>>;

pub struct ConnectedClient {
    pub user_id: String,
    pub username: String,
    pub tx: mpsc::UnboundedSender<String>,
    pub subscribed_channels: HashSet<String>,
    pub subscribed_dms: HashSet<String>,
    pub voice_channel_id: Option<String>,
    pub activity: Option<ActivityInfo>,
    pub status: String,
}

pub struct GatewayState {
    next_id: RwLock<u64>,
    pub clients: RwLock<HashMap<ClientId, ConnectedClient>>,
    pub channel_subs: RwLock<HashMap<String, HashSet<ClientId>>>,
    pub dm_subs: RwLock<HashMap<String, HashSet<ClientId>>>,
    pub voice_participants: RwLock<VoiceParticipantMap>,
    pub cleanup_timers: RwLock<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl Default for GatewayState {
    fn default() -> Self {
        Self::new()
    }
}

impl GatewayState {
    pub fn new() -> Self {
        Self {
            next_id: RwLock::new(1),
            clients: RwLock::new(HashMap::new()),
            channel_subs: RwLock::new(HashMap::new()),
            dm_subs: RwLock::new(HashMap::new()),
            voice_participants: RwLock::new(HashMap::new()),
            cleanup_timers: RwLock::new(HashMap::new()),
        }
    }

    pub async fn next_client_id(&self) -> ClientId {
        let mut id = self.next_id.write().await;
        let current = *id;
        *id += 1;
        current
    }

    pub async fn register(
        &self,
        client_id: ClientId,
        user_id: String,
        username: String,
        tx: mpsc::UnboundedSender<String>,
        status: String,
    ) {
        let client = ConnectedClient {
            user_id,
            username,
            tx,
            subscribed_channels: HashSet::new(),
            subscribed_dms: HashSet::new(),
            voice_channel_id: None,
            activity: None,
            status,
        };
        self.clients.write().await.insert(client_id, client);
    }

    pub async fn unregister(&self, client_id: ClientId) -> Option<ConnectedClient> {
        let client = self.clients.write().await.remove(&client_id)?;

        let mut ch_subs = self.channel_subs.write().await;
        for channel_id in &client.subscribed_channels {
            if let Some(set) = ch_subs.get_mut(channel_id) {
                set.remove(&client_id);
                if set.is_empty() {
                    ch_subs.remove(channel_id);
                }
            }
        }

        let mut dm_subs = self.dm_subs.write().await;
        for dm_id in &client.subscribed_dms {
            if let Some(set) = dm_subs.get_mut(dm_id) {
                set.remove(&client_id);
                if set.is_empty() {
                    dm_subs.remove(dm_id);
                }
            }
        }

        if let Some(voice_channel) = &client.voice_channel_id {
            let mut vp = self.voice_participants.write().await;
            if let Some(participants) = vp.get_mut(voice_channel) {
                participants.remove(&client.user_id);
                if participants.is_empty() {
                    vp.remove(voice_channel);
                }
            }
        }

        Some(client)
    }

    pub async fn subscribe_channel(&self, client_id: ClientId, channel_id: &str) {
        self.channel_subs
            .write()
            .await
            .entry(channel_id.to_string())
            .or_default()
            .insert(client_id);

        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.subscribed_channels.insert(channel_id.to_string());
        }
    }

    pub async fn unsubscribe_channel(&self, client_id: ClientId, channel_id: &str) {
        let mut subs = self.channel_subs.write().await;
        if let Some(set) = subs.get_mut(channel_id) {
            set.remove(&client_id);
            if set.is_empty() {
                subs.remove(channel_id);
            }
        }

        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.subscribed_channels.remove(channel_id);
        }
    }

    pub async fn subscribe_dm(&self, client_id: ClientId, dm_channel_id: &str) {
        self.dm_subs
            .write()
            .await
            .entry(dm_channel_id.to_string())
            .or_default()
            .insert(client_id);

        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.subscribed_dms.insert(dm_channel_id.to_string());
        }
    }

    pub async fn is_user_subscribed_to_dm(&self, user_id: &str, dm_channel_id: &str) -> bool {
        let subs = self.dm_subs.read().await;
        let clients = self.clients.read().await;
        if let Some(subscriber_ids) = subs.get(dm_channel_id) {
            for &cid in subscriber_ids {
                if let Some(client) = clients.get(&cid) {
                    if client.user_id == user_id {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub async fn unsubscribe_dm(&self, client_id: ClientId, dm_channel_id: &str) {
        let mut subs = self.dm_subs.write().await;
        if let Some(set) = subs.get_mut(dm_channel_id) {
            set.remove(&client_id);
            if set.is_empty() {
                subs.remove(dm_channel_id);
            }
        }

        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.subscribed_dms.remove(dm_channel_id);
        }
    }

    pub async fn set_activity(&self, client_id: ClientId, activity: Option<ActivityInfo>) {
        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.activity = activity;
        }
    }

    pub async fn get_all_activities(&self) -> Vec<(String, ActivityInfo)> {
        let clients = self.clients.read().await;
        let mut seen = HashSet::new();
        let mut activities = Vec::new();
        for client in clients.values() {
            if let Some(ref activity) = client.activity {
                if seen.insert(client.user_id.clone()) {
                    activities.push((client.user_id.clone(), activity.clone()));
                }
            }
        }
        activities
    }

    pub async fn set_status(&self, client_id: ClientId, status: String) {
        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.status = status;
        }
    }

    pub async fn get_user_status(&self, user_id: &str) -> Option<String> {
        let clients = self.clients.read().await;
        for client in clients.values() {
            if client.user_id == user_id {
                return Some(client.status.clone());
            }
        }
        None
    }

    pub async fn online_user_statuses(&self) -> Vec<(String, String)> {
        let clients = self.clients.read().await;
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for client in clients.values() {
            if seen.insert(client.user_id.clone())
                && client.status != "invisible"
            {
                result.push((client.user_id.clone(), client.status.clone()));
            }
        }
        result
    }

    pub async fn schedule_room_cleanup(
        self: &Arc<Self>,
        channel_id: String,
        delay: std::time::Duration,
        db: sqlx::SqlitePool,
    ) {
        let mut timers = self.cleanup_timers.write().await;
        if let Some(handle) = timers.remove(&channel_id) {
            handle.abort();
        }
        let gw = Arc::clone(self);
        let cid = channel_id.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let participants = gw.voice_channel_participants(&cid).await;
            if !participants.is_empty() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let participants = gw.voice_channel_participants(&cid).await;
            if !participants.is_empty() {
                return;
            }
            let room_info = sqlx::query_as::<_, (i64, String)>(
                "SELECT is_room, server_id FROM channels WHERE id = ?",
            )
            .bind(&cid)
            .fetch_optional(&db)
            .await
            .ok()
            .flatten();

            if let Some((1, ref server_id)) = room_info {
                tracing::info!("Cleaning up empty temporary room {}", cid);
                sqlx::query("DELETE FROM channels WHERE id = ?")
                    .bind(&cid)
                    .execute(&db)
                    .await
                    .ok();
                gw.broadcast_all(
                    &crate::ws::events::ServerEvent::RoomDeleted {
                        channel_id: cid.clone(),
                        server_id: server_id.clone(),
                    },
                    None,
                )
                .await;
            }
            gw.cleanup_timers.write().await.remove(&cid);
        });
        timers.insert(channel_id, handle);
    }

    pub async fn cancel_room_cleanup(&self, channel_id: &str) {
        let mut timers = self.cleanup_timers.write().await;
        if let Some(handle) = timers.remove(channel_id) {
            handle.abort();
        }
    }
}
