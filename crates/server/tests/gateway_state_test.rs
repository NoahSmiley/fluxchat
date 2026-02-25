use flux_server::ws::events::{ActivityInfo, ServerEvent};
use flux_server::ws::gateway::GatewayState;
use tokio::sync::mpsc;

fn make_tx() -> (mpsc::UnboundedSender<String>, mpsc::UnboundedReceiver<String>) {
    mpsc::unbounded_channel()
}

#[tokio::test]
async fn send_to_user_by_user_id() {
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
        message: "hello".into(),
    };
    gw.send_to_user("u2", &event).await;

    assert!(rx1.try_recv().is_err());
    assert!(rx2.try_recv().is_ok());
}

#[tokio::test]
async fn voice_join() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.voice_join(cid, "vc1").await;

    let participants = gw.voice_channel_participants("vc1").await;
    assert_eq!(participants.len(), 1);
    assert_eq!(participants[0].user_id, "u1");
    assert_eq!(participants[0].username, "alice");
    assert_eq!(participants[0].drink_count, 0);
}

#[tokio::test]
async fn voice_join_leaves_previous_channel() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.voice_join(cid, "vc1").await;
    gw.voice_join(cid, "vc2").await;

    let p1 = gw.voice_channel_participants("vc1").await;
    let p2 = gw.voice_channel_participants("vc2").await;
    assert_eq!(p1.len(), 0);
    assert_eq!(p2.len(), 1);
    assert_eq!(p2[0].user_id, "u1");
}

#[tokio::test]
async fn voice_leave() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.voice_join(cid, "vc1").await;
    let left = gw.voice_leave(cid).await;

    assert_eq!(left, Some("vc1".into()));
    assert_eq!(gw.voice_channel_participants("vc1").await.len(), 0);
}

#[tokio::test]
async fn voice_channel_participants() {
    let gw = GatewayState::new();
    let (tx1, _rx1) = make_tx();
    let (tx2, _rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    gw.voice_join(cid1, "vc1").await;
    gw.voice_join(cid2, "vc1").await;

    let participants = gw.voice_channel_participants("vc1").await;
    assert_eq!(participants.len(), 2);
}

#[tokio::test]
async fn update_drink_count() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.voice_join(cid, "vc1").await;
    gw.update_drink_count("u1", "vc1", 5).await;

    let participants = gw.voice_channel_participants("vc1").await;
    assert_eq!(participants[0].drink_count, 5);
}

#[tokio::test]
async fn set_activity() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    let activity = ActivityInfo {
        name: "Spotify".into(),
        activity_type: "listening".into(),
        artist: Some("Artist".into()),
        album_art: None,
        duration_ms: Some(300000),
        progress_ms: Some(60000),
    };
    gw.set_activity(cid, Some(activity)).await;

    let activities = gw.get_all_activities().await;
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].0, "u1");
    assert_eq!(activities[0].1.name, "Spotify");
}

#[tokio::test]
async fn get_all_activities_returns_only_with_activity() {
    let gw = GatewayState::new();
    let (tx1, _rx1) = make_tx();
    let (tx2, _rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "online".into())
        .await;

    let activity = ActivityInfo {
        name: "Gaming".into(),
        activity_type: "playing".into(),
        artist: None,
        album_art: None,
        duration_ms: None,
        progress_ms: None,
    };
    gw.set_activity(cid1, Some(activity)).await;
    // cid2 has no activity

    let activities = gw.get_all_activities().await;
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].0, "u1");
}

#[tokio::test]
async fn set_status() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.set_status(cid, "dnd".into()).await;

    let status = gw.get_user_status("u1").await;
    assert_eq!(status, Some("dnd".into()));
}

#[tokio::test]
async fn get_user_status() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    let status = gw.get_user_status("u1").await;
    assert_eq!(status, Some("online".into()));

    let missing = gw.get_user_status("unknown").await;
    assert_eq!(missing, None);
}

#[tokio::test]
async fn online_user_statuses_excludes_invisible() {
    let gw = GatewayState::new();
    let (tx1, _rx1) = make_tx();
    let (tx2, _rx2) = make_tx();

    let cid1 = gw.next_client_id().await;
    let cid2 = gw.next_client_id().await;

    gw.register(cid1, "u1".into(), "alice".into(), tx1, "online".into())
        .await;
    gw.register(cid2, "u2".into(), "bob".into(), tx2, "invisible".into())
        .await;

    let statuses = gw.online_user_statuses().await;
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].0, "u1");
    assert_eq!(statuses[0].1, "online");
}

#[tokio::test]
async fn unregister_cleans_voice_and_subscriptions() {
    let gw = GatewayState::new();
    let (tx, _rx) = make_tx();
    let cid = gw.next_client_id().await;
    gw.register(cid, "u1".into(), "alice".into(), tx, "online".into())
        .await;

    gw.subscribe_channel(cid, "ch1").await;
    gw.subscribe_dm(cid, "dm1").await;
    gw.voice_join(cid, "vc1").await;

    gw.unregister(cid).await;

    assert!(gw.channel_subs.read().await.get("ch1").is_none());
    assert!(gw.dm_subs.read().await.get("dm1").is_none());
    assert_eq!(gw.voice_channel_participants("vc1").await.len(), 0);
    assert!(gw.clients.read().await.is_empty());
}
