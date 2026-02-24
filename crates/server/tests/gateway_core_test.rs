use flux_server::ws::events::{ActivityInfo, ServerEvent};
use flux_server::ws::gateway::GatewayState;
use tokio::sync::mpsc;

fn make_tx() -> (mpsc::UnboundedSender<String>, mpsc::UnboundedReceiver<String>) {
    mpsc::unbounded_channel()
}

#[tokio::test]
async fn register_and_unregister() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    assert!(gw.clients.read().await.contains_key(&cid));

    let removed = gw.unregister(cid).await;
    assert!(removed.is_some());
    assert!(!gw.clients.read().await.contains_key(&cid));
}

#[tokio::test]
async fn next_client_id_increments() {
    let gw = GatewayState::new();
    let id1 = gw.next_client_id().await;
    let id2 = gw.next_client_id().await;
    let id3 = gw.next_client_id().await;
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[tokio::test]
async fn subscribe_channel() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.subscribe_channel(cid, "ch1").await;

    let subs = gw.channel_subs.read().await;
    assert!(subs.get("ch1").unwrap().contains(&cid));

    let clients = gw.clients.read().await;
    assert!(clients.get(&cid).unwrap().subscribed_channels.contains("ch1"));
}

#[tokio::test]
async fn unsubscribe_channel() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.subscribe_channel(cid, "ch1").await;
    gw.unsubscribe_channel(cid, "ch1").await;

    let subs = gw.channel_subs.read().await;
    assert!(subs.get("ch1").is_none()); // Empty set removed
}

#[tokio::test]
async fn subscribe_dm() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.subscribe_dm(cid, "dm1").await;

    let subs = gw.dm_subs.read().await;
    assert!(subs.get("dm1").unwrap().contains(&cid));
}

#[tokio::test]
async fn unsubscribe_dm() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.subscribe_dm(cid, "dm1").await;
    gw.unsubscribe_dm(cid, "dm1").await;

    let subs = gw.dm_subs.read().await;
    assert!(subs.get("dm1").is_none());
}

#[tokio::test]
async fn broadcast_channel_sends_to_subscribers() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    gw.subscribe_channel(cid1, "ch1").await;
    gw.subscribe_channel(cid2, "ch1").await;

    let event = ServerEvent::Typing {
        channel_id: "ch1".into(),
        user_id: "u1".into(),
        active: true,
    };
    gw.broadcast_channel("ch1", &event, None).await;

    assert!(rx1.try_recv().is_ok());
    assert!(rx2.try_recv().is_ok());
}

#[tokio::test]
async fn broadcast_channel_excludes_sender() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    gw.subscribe_channel(cid1, "ch1").await;
    gw.subscribe_channel(cid2, "ch1").await;

    let event = ServerEvent::Typing {
        channel_id: "ch1".into(),
        user_id: "u1".into(),
        active: true,
    };
    gw.broadcast_channel("ch1", &event, Some(cid1)).await;

    assert!(rx1.try_recv().is_err()); // excluded
    assert!(rx2.try_recv().is_ok()); // received
}

#[tokio::test]
async fn broadcast_channel_ignores_non_subscribers() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    gw.subscribe_channel(cid1, "ch1").await;
    // cid2 is NOT subscribed

    let event = ServerEvent::Typing {
        channel_id: "ch1".into(),
        user_id: "u1".into(),
        active: true,
    };
    gw.broadcast_channel("ch1", &event, None).await;

    assert!(rx1.try_recv().is_ok());
    assert!(rx2.try_recv().is_err()); // not subscribed
}

#[tokio::test]
async fn broadcast_dm_sends_to_subscribers() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    gw.subscribe_dm(cid1, "dm1").await;
    gw.subscribe_dm(cid2, "dm1").await;

    let event = ServerEvent::Presence {
        user_id: "u1".into(),
        status: "online".into(),
    };
    gw.broadcast_dm("dm1", &event).await;

    assert!(rx1.try_recv().is_ok());
    assert!(rx2.try_recv().is_ok());
}

#[tokio::test]
async fn broadcast_all_sends_to_everyone() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    let event = ServerEvent::Presence {
        user_id: "u1".into(),
        status: "online".into(),
    };
    gw.broadcast_all(&event, None).await;

    assert!(rx1.try_recv().is_ok());
    assert!(rx2.try_recv().is_ok());
}

#[tokio::test]
async fn broadcast_all_excludes_specified() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    let event = ServerEvent::Presence {
        user_id: "u1".into(),
        status: "online".into(),
    };
    gw.broadcast_all(&event, Some(cid1)).await;

    assert!(rx1.try_recv().is_err());
    assert!(rx2.try_recv().is_ok());
}

#[tokio::test]
async fn send_to_specific_client() {
    let gw = GatewayState::new();
    let (tx1, mut rx1) = make_tx();
    let (tx2, mut rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    let event = ServerEvent::Error {
        message: "test".into(),
    };
    gw.send_to(cid1, &event).await;

    assert!(rx1.try_recv().is_ok());
    assert!(rx2.try_recv().is_err());
}
