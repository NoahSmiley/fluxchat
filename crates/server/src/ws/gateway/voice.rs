use super::{ClientId, GatewayState, VoiceParticipantData};
use crate::models::VoiceParticipant;

impl GatewayState {
    pub async fn all_voice_states(&self) -> Vec<(String, Vec<VoiceParticipant>)> {
        let vp = self.voice_participants.read().await;
        vp.iter()
            .map(|(channel_id, participants)| {
                let parts: Vec<VoiceParticipant> = participants
                    .iter()
                    .map(|(uid, data)| VoiceParticipant {
                        user_id: uid.clone(),
                        username: data.username.clone(),
                        drink_count: data.drink_count,
                        intro_sound_url: None,
                        exit_sound_url: None,
                    })
                    .collect();
                (channel_id.clone(), parts)
            })
            .collect()
    }

    pub async fn voice_join(
        &self,
        client_id: ClientId,
        channel_id: &str,
        intro_sound_url: Option<String>,
        exit_sound_url: Option<String>,
    ) {
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
                .insert(client.user_id.clone(), VoiceParticipantData {
                    username: client.username.clone(),
                    drink_count: 0,
                    intro_sound_url,
                    exit_sound_url,
                });
        }
    }

    /// Returns (channel_id, participant_data) of the leaving user.
    pub async fn voice_leave(&self, client_id: ClientId) -> Option<(String, VoiceParticipantData)> {
        let mut clients = self.clients.write().await;
        let mut vp = self.voice_participants.write().await;

        if let Some(client) = clients.get_mut(&client_id) {
            if let Some(channel_id) = client.voice_channel_id.take() {
                let mut data = None;
                if let Some(participants) = vp.get_mut(&channel_id) {
                    data = participants.remove(&client.user_id);
                    if participants.is_empty() {
                        vp.remove(&channel_id);
                    }
                }
                return Some((channel_id, data.unwrap_or(VoiceParticipantData {
                    username: client.username.clone(),
                    drink_count: 0,
                    intro_sound_url: None,
                    exit_sound_url: None,
                })));
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
                    .map(|(uid, data)| VoiceParticipant {
                        user_id: uid.clone(),
                        username: data.username.clone(),
                        drink_count: data.drink_count,
                        intro_sound_url: None,
                        exit_sound_url: None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Force-clear all voice participants for a channel (used when admin deletes a room
    /// that has stale participant entries from disconnected clients).
    pub async fn clear_voice_channel(&self, channel_id: &str) {
        let mut vp = self.voice_participants.write().await;
        vp.remove(channel_id);

        // Also clear voice_channel_id from any clients that still reference this channel
        let mut clients = self.clients.write().await;
        for client in clients.values_mut() {
            if client.voice_channel_id.as_deref() == Some(channel_id) {
                client.voice_channel_id = None;
            }
        }
    }

    pub async fn update_drink_count(&self, user_id: &str, channel_id: &str, drink_count: i32) {
        let mut vp = self.voice_participants.write().await;
        if let Some(participants) = vp.get_mut(channel_id) {
            if let Some(entry) = participants.get_mut(user_id) {
                entry.drink_count = drink_count;
            }
        }
    }
}
