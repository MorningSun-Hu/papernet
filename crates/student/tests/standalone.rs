use std::net::SocketAddr;
use std::time::Duration;

use papernet_student::{join_classroom, maintain_ws_timed, resolve_mac, ws_url, StudentConfig};
use papernet_teacher::{app, AppState};
use serde_json::json;
use tempfile::tempdir;
use tokio::net::TcpListener;

#[tokio::test]
async fn standalone_joins_with_nic_mac_and_keeps_ws() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("papernet.sqlite");
    let state = AppState::open(&db).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve)).await.unwrap();
    });

    let client = reqwest::Client::new();
    let base = format!("http://{addr}");
    let created: serde_json::Value = client
        .post(format!("{base}/api/v1/classrooms"))
        .json(&json!({
            "title": "独立端",
            "inventory": {
                "pcs": [{"id": "PC1"}],
                "switches": [],
                "routers": [],
                "taps": []
            }
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = created["data"]["classroom_id"].as_str().unwrap().to_string();
    client
        .post(format!("{base}/api/v1/classrooms/{id}/open-claim"))
        .json(&json!({}))
        .send()
        .await
        .unwrap();

    let mac = resolve_mac(Some("aa:bb:cc:dd:ee:10")).unwrap();
    let cfg = StudentConfig {
        teacher_base: base.clone(),
        nic_mac: Some(mac.clone()),
        connection_id: None,
    };
    let joined = join_classroom(&cfg, &mac).await.unwrap();
    assert_eq!(joined.status, "claimed");
    assert_eq!(joined.device.as_ref().unwrap()["mac"], mac);
    assert_eq!(joined.device.as_ref().unwrap()["id"], "PC1");
    let conn = joined.connection_id.expect("connection_id");
    let url = ws_url(&base, Some(&id), &conn);
    let events = maintain_ws_timed(&url, Duration::from_millis(40), Duration::from_millis(200))
        .await
        .unwrap();
    assert!(events.iter().any(|e| e["event"] == "hello"));
}
