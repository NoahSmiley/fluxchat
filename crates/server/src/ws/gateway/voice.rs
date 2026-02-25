use super::{ClientId, GatewayState};
use crate::models::VoiceParticipant;

impl GatewayState {
    pub async fn all_voice_states(&self) -> Vec<(String, Vec<VoiceParticipant>)> {
        let vp = self.voice_participants.read().await;
        vp.iter()
            .map(|(channel_id, participants)| {
                let parts: Vec<VoiceParticipant> = participants
                    .iter()
                    .map(|(uid, (uname, drinks))| VoiceParticipant {
                        user_id: uid.clone(),
                        username: uname.clone(),
                        drink_count: *drinks,
                    })
                    .collect();
                (channel_id.clone(), parts)
            })
            .collect()
    }

    pub async fn voice_join(&self, client_id: ClientId, channel_id: &str) {
        let mut clients = self.clients.write().await;
        let mut vp = self.voice_participants.write().await;

        if let Some(client) = clients.get_mut(&client_id) {
            if let Some(prev) = client.voice_channel_id.take() {
                if let Some(participants) = vp.get_mut(&prev) {
                    participants.remove(&client.user_id);
                    if participants.is_empty() {
                        vp.remove(&prev);
                    }
                }
            }

            client.voice_channel_id = Some(channel_id.to_string());
            vp.entry(channel_id.to_string())
                .or_default()
                .insert(client.user_id.clone(), (client.username.clone(), 0));
        }
    }

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

    pub async fn voice_channel_participants(&self, channel_id: &str) -> Vec<VoiceParticipant> {
        let vp = self.voice_participants.read().await;
        vp.get(channel_id)
            .map(|participants| {
                participants
                    .iter()
                    .map(|(uid, (uname, drinks))| VoiceParticipant {
                        user_id: uid.clone(),
                        username: uname.clone(),
                        drink_count: *drinks,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn update_drink_count(&self, user_id: &str, channel_id: &str, drink_count: i32) {
        let mut vp = self.voice_participants.write().await;
        if let Some(participants) = vp.get_mut(channel_id) {
            if let Some(entry) = participants.get_mut(user_id) {
                entry.1 = drink_count;
            }
        }
    }
}

