use std::collections::{HashMap, HashSet};
use tokio::sync::{mpsc, RwLock};

use crate::models::VoiceParticipant;
use crate::ws::events::{ActivityInfo, ServerEvent};

pub type ClientId = u64;

pub struct ConnectedClient {
    pub user_id: String,
    pub username: String,
    pub tx: mpsc::UnboundedSender<String>,
    pub subscribed_channels: HashSet<String>,
    pub subscribed_dms: HashSet<String>,
    pub voice_channel_id: Option<String>,
    pub activity: Option<ActivityInfo>,
}

pub struct GatewayState {
    next_id: RwLock<u64>,
    pub clients: RwLock<HashMap<ClientId, ConnectedClient>>,
    pub channel_subs: RwLock<HashMap<String, HashSet<ClientId>>>,
    pub dm_subs: RwLock<HashMap<String, HashSet<ClientId>>>,
    pub voice_participants: RwLock<HashMap<String, HashMap<String, String>>>,
}

impl GatewayState {
    pub fn new() -> Self {
        Self {
            next_id: RwLock::new(1),
            clients: RwLock::new(HashMap::new()),
            channel_subs: RwLock::new(HashMap::new()),
            dm_subs: RwLock::new(HashMap::new()),
            voice_participants: RwLock::new(HashMap::new()),
        }
    }

    pub async fn next_client_id(&self) -> ClientId {
        let mut id = self.next_id.write().await;
        let current = *id;
        *id += 1;
        current
    }

    /// Register a new client connection
    pub async fn register(
        &self,
        client_id: ClientId,
        user_id: String,
        username: String,
        tx: mpsc::UnboundedSender<String>,
    ) {
        let client = ConnectedClient {
            user_id,
            username,
            tx,
            subscribed_channels: HashSet::new(),
            subscribed_dms: HashSet::new(),
            voice_channel_id: None,
            activity: None,
        };
        self.clients.write().await.insert(client_id, client);
    }

    /// Unregister a client and clean up all subscriptions
    pub async fn unregister(&self, client_id: ClientId) -> Option<ConnectedClient> {
        let client = self.clients.write().await.remove(&client_id)?;

        // Remove from channel subscriptions
        let mut ch_subs = self.channel_subs.write().await;
        for channel_id in &client.subscribed_channels {
            if let Some(set) = ch_subs.get_mut(channel_id) {
                set.remove(&client_id);
                if set.is_empty() {
                    ch_subs.remove(channel_id);
                }
            }
        }

        // Remove from DM subscriptions
        let mut dm_subs = self.dm_subs.write().await;
        for dm_id in &client.subscribed_dms {
            if let Some(set) = dm_subs.get_mut(dm_id) {
                set.remove(&client_id);
                if set.is_empty() {
                    dm_subs.remove(dm_id);
                }
            }
        }

        // Remove from voice participants
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

    /// Subscribe a client to a channel
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

    /// Unsubscribe a client from a channel
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

    /// Subscribe a client to a DM channel
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

    /// Unsubscribe a client from a DM channel
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

    /// Broadcast event to all subscribers of a channel
    pub async fn broadcast_channel(&self, channel_id: &str, event: &ServerEvent, exclude: Option<ClientId>) {
        let msg = match serde_json::to_string(event) {
            Ok(m) => m,
            Err(_) => return,
        };

        let subs = self.channel_subs.read().await;
        let clients = self.clients.read().await;

        if let Some(subscriber_ids) = subs.get(channel_id) {
            for &cid in subscriber_ids {
                if Some(cid) == exclude {
                    continue;
                }
                if let Some(client) = clients.get(&cid) {
                    let _ = client.tx.send(msg.clone());
                }
            }
        }
    }

    /// Broadcast event to all subscribers of a DM channel
    pub async fn broadcast_dm(&self, dm_channel_id: &str, event: &ServerEvent) {
        let msg = match serde_json::to_string(event) {
            Ok(m) => m,
            Err(_) => return,
        };

        let subs = self.dm_subs.read().await;
        let clients = self.clients.read().await;

        if let Some(subscriber_ids) = subs.get(dm_channel_id) {
            for &cid in subscriber_ids {
                if let Some(client) = clients.get(&cid) {
                    let _ = client.tx.send(msg.clone());
                }
            }
        }
    }

    /// Broadcast event to ALL connected clients
    pub async fn broadcast_all(&self, event: &ServerEvent, exclude: Option<ClientId>) {
        let msg = match serde_json::to_string(event) {
            Ok(m) => m,
            Err(_) => return,
        };

        let clients = self.clients.read().await;
        for (&cid, client) in clients.iter() {
            if Some(cid) == exclude {
                continue;
            }
            let _ = client.tx.send(msg.clone());
        }
    }

    /// Send event to a specific client
    pub async fn send_to(&self, client_id: ClientId, event: &ServerEvent) {
        let msg = match serde_json::to_string(event) {
            Ok(m) => m,
            Err(_) => return,
        };

        let clients = self.clients.read().await;
        if let Some(client) = clients.get(&client_id) {
            let _ = client.tx.send(msg);
        }
    }

    /// Send to a user by user_id (finds their client)
    pub async fn send_to_user(&self, user_id: &str, event: &ServerEvent) {
        let msg = match serde_json::to_string(event) {
            Ok(m) => m,
            Err(_) => return,
        };

        let clients = self.clients.read().await;
        for client in clients.values() {
            if client.user_id == user_id {
                let _ = client.tx.send(msg.clone());
            }
        }
    }

    /// Get all online user IDs
    pub async fn online_user_ids(&self) -> Vec<String> {
        let clients = self.clients.read().await;
        let mut seen = HashSet::new();
        let mut ids = Vec::new();
        for client in clients.values() {
            if seen.insert(client.user_id.clone()) {
                ids.push(client.user_id.clone());
            }
        }
        ids
    }

    /// Get all voice channel states
    pub async fn all_voice_states(&self) -> Vec<(String, Vec<VoiceParticipant>)> {
        let vp = self.voice_participants.read().await;
        vp.iter()
            .map(|(channel_id, participants)| {
                let parts: Vec<VoiceParticipant> = participants
                    .iter()
                    .map(|(uid, uname)| VoiceParticipant {
                        user_id: uid.clone(),
                        username: uname.clone(),
                    })
                    .collect();
                (channel_id.clone(), parts)
            })
            .collect()
    }

    /// Update voice state for a user
    pub async fn voice_join(&self, client_id: ClientId, channel_id: &str) {
        let mut clients = self.clients.write().await;
        let mut vp = self.voice_participants.write().await;

        if let Some(client) = clients.get_mut(&client_id) {
            // Leave previous voice channel
            if let Some(prev) = client.voice_channel_id.take() {
                if let Some(participants) = vp.get_mut(&prev) {
                    participants.remove(&client.user_id);
                    if participants.is_empty() {
                        vp.remove(&prev);
                    }
                }
            }

            // Join new voice channel
            client.voice_channel_id = Some(channel_id.to_string());
            vp.entry(channel_id.to_string())
                .or_default()
                .insert(client.user_id.clone(), client.username.clone());
        }
    }

    /// Remove user from voice channel
    pub async fn voice_leave(&self, client_id: ClientId) -> Option<String> {
        let mut clients = self.clients.write().await;
        let mut vp = self.voice_participants.write().await;

        if let Some(client) = clients.get_mut(&client_id) {
            if let Some(channel_id) = client.voice_channel_id.take() {
                if let Some(participants) = vp.get_mut(&channel_id) {
                    participants.remove(&client.user_id);
                    if participants.is_empty() {
                        vp.remove(&channel_id);
                    }
                }
                return Some(channel_id);
            }
        }
        None
    }

    /// Get participants for a specific voice channel
    pub async fn voice_channel_participants(&self, channel_id: &str) -> Vec<VoiceParticipant> {
        let vp = self.voice_participants.read().await;
        vp.get(channel_id)
            .map(|participants| {
                participants
                    .iter()
                    .map(|(uid, uname)| VoiceParticipant {
                        user_id: uid.clone(),
                        username: uname.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Update a client's activity status
    pub async fn set_activity(&self, client_id: ClientId, activity: Option<ActivityInfo>) {
        if let Some(client) = self.clients.write().await.get_mut(&client_id) {
            client.activity = activity;
        }
    }

    /// Get all current activities (user_id → ActivityInfo) for online users
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
}
