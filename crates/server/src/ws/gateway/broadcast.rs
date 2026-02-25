use super::{ClientId, GatewayState};
use crate::ws::events::ServerEvent;

impl GatewayState {
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
}
