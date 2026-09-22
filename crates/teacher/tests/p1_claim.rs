use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use papernet_shared::{is_unicast_mac, MSG_CLASSROOM_FULL, MSG_WAITING_OPEN};
use papernet_teacher::{app, AppState};
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::net::TcpListener;
use tower::ServiceExt;

fn state() -> (AppState, tempfile::TempDir) {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("papernet.sqlite");
    let state = AppState::open(&db).expect("open db");
    (state, dir)
}

async fn json_body(res: axum::response::Response) -> Value {
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    serde_json::from_slice(&bytes).expect("json")
}

async fn post(state: AppState, uri: &str, body: Value) -> (StatusCode, Value) {
    let res = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    (res.status(), json_body(res).await)
}

async fn create_with_pcs(state: AppState, n: usize) -> String {
    let pcs: Vec<Value> = (1..=n)
        .map(|i| json!({"id": format!("PC{i}")}))
        .collect();
    let (_, v) = post(
        state,
        "/api/v1/classrooms",
        json!({
            "title": "八年级1班",
            "inventory": {
                "routers": [],
                "switches": [],
                "pcs": pcs,
                "taps": []
            }
        }),
    )
    .await;
    v["data"]["classroom_id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn inventory_writes_device_and_port_ids() {
    let (state, dir) = state();
    let (_, v) = post(
        state,
        "/api/v1/classrooms",
        json!({
            "title": "定员",
            "inventory": {
                "routers": [{"id": "R1", "port_count": 2, "ports": [
                    {"id": "R1/01", "ip": "192.168.1.1"}
                ]}],
                "switches": [{"id": "S3", "port_count": 1}],
                "pcs": [{"id": "PC1"}],
                "taps": [{"id": "TAP1"}]
            }
        }),
    )
    .await;
    let id = v["data"]["classroom_id"].as_str().unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("papernet.sqlite")).unwrap();
    let mut stmt = conn
        .prepare("SELECT port_id FROM port WHERE classroom_id = ?1 ORDER BY port_id")
        .unwrap();
    let ports: Vec<String> = stmt
        .query_map([id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(ports.contains(&"R1/01".to_string()));
    assert!(ports.contains(&"R1/02".to_string()));
    assert!(ports.contains(&"S3/01".to_string()));
    assert!(ports.contains(&"PC1/01".to_string()));
    let ip: String = conn
        .query_row(
            "SELECT ip FROM port WHERE classroom_id = ?1 AND port_id = 'R1/01'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ip, "192.168.1.1");
}

#[tokio::test]
async fn join_before_open_returns_waiting_open() {
    let (state, _dir) = state();
    create_with_pcs(state.clone(), 2).await;
    let (status, v) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["data"]["status"], "waiting_open");
    assert_eq!(v["data"]["message"], MSG_WAITING_OPEN);
    assert!(v["data"]["connection_id"].as_str().is_some());
    assert!(v.get("join_code").is_none());
    assert!(v["data"].get("join_code").is_none());
}

#[tokio::test]
async fn third_join_after_two_pcs_uses_exact_full_message() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 2).await;
    let (st, _) = post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    for _ in 0..2 {
        let (status, v) = post(
            state.clone(),
            "/api/v1/classrooms/join",
            json!({"client_kind": "student-hosted"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(v["data"]["status"], "claimed");
    }
    let (status, v) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(v["data"]["status"], "full");
    assert_eq!(v["error"]["message"], MSG_CLASSROOM_FULL);
    assert_eq!(v["error"]["message"], "本课设备已领完，请看教师屏");
}

#[tokio::test]
async fn two_connections_never_share_device_id() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 2).await;
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let (_, a) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let (_, b) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let da = a["data"]["device"]["id"].as_str().unwrap();
    let db = b["data"]["device"]["id"].as_str().unwrap();
    assert_ne!(da, db);
}

#[tokio::test]
async fn waiting_then_open_claim_becomes_claimed() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    let (_, waiting) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    assert_eq!(waiting["data"]["status"], "waiting_open");
    let conn_id = waiting["data"]["connection_id"].as_str().unwrap().to_string();
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let (status, v) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted", "connection_id": conn_id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["data"]["status"], "claimed");
    assert_eq!(v["data"]["connection_id"], conn_id);
    assert_eq!(v["data"]["device"]["id"], "PC1");
}

#[tokio::test]
async fn claimed_survives_disconnect_and_reconnect() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });

    let (_, claimed) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let conn_id = claimed["data"]["connection_id"].as_str().unwrap().to_string();
    let device_id = claimed["data"]["device"]["id"].as_str().unwrap().to_string();

    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={conn_id}");
    let (ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    drop(ws);

    let (_, again) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted", "connection_id": conn_id}),
    )
    .await;
    assert_eq!(again["data"]["status"], "claimed");
    assert_eq!(again["data"]["device"]["id"], device_id);

    let (status, full) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(full["error"]["message"], MSG_CLASSROOM_FULL);
}

#[tokio::test]
async fn hosted_pc_gets_generated_unicast_mac() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let (_, v) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let mac = v["data"]["device"]["mac"].as_str().unwrap();
    assert!(is_unicast_mac(mac));
}

#[tokio::test]
async fn standalone_pc_uses_nic_mac() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let nic = "aa:bb:cc:dd:ee:10";
    let (_, v) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-standalone", "nic_mac": nic}),
    )
    .await;
    assert_eq!(v["data"]["device"]["mac"], nic);
}

#[tokio::test]
async fn open_claim_pushes_granted_to_waiting_ws() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    let (_, waiting) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let conn_id = waiting["data"]["connection_id"].as_str().unwrap().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });

    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={conn_id}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    let hello = ws.next().await.expect("hello").expect("ok");
    let hello_v: Value = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert_eq!(hello_v["event"], "hello");
    post(
        state,
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;

    let granted = ws.next().await.expect("granted").expect("ok");
    let v: Value = serde_json::from_str(&granted.into_text().unwrap()).unwrap();
    assert_eq!(v["event"], "claim.granted");
    assert_eq!(v["device"]["id"], "PC1");
}

#[tokio::test]
async fn join_pushes_classroom_online() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 2).await;
    let (_, waiting) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let conn_id = waiting["data"]["connection_id"].as_str().unwrap().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });

    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={conn_id}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    let hello = ws.next().await.expect("hello").expect("ok");
    let hello_v: Value = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert_eq!(hello_v["event"], "hello");

    post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;

    let online = ws.next().await.expect("online").expect("ok");
    let v: Value = serde_json::from_str(&online.into_text().unwrap()).unwrap();
    assert_eq!(v["event"], "classroom.online");
    assert_eq!(v["count"], 2);
}

#[tokio::test]
async fn open_claim_pushes_full_to_extra_waiter() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 1).await;
    let (_, a) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let (_, b) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let a_id = a["data"]["connection_id"].as_str().unwrap().to_string();
    let b_id = b["data"]["connection_id"].as_str().unwrap().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });

    let a_url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={a_id}");
    let b_url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={b_id}");
    let (mut a_ws, _) = tokio_tungstenite::connect_async(&a_url).await.expect("ws a");
    let (mut b_ws, _) = tokio_tungstenite::connect_async(&b_url).await.expect("ws b");
    let a_hello: Value =
        serde_json::from_str(&a_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    let b_hello: Value =
        serde_json::from_str(&b_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(a_hello["event"], "hello");
    assert_eq!(b_hello["event"], "hello");

    post(
        state,
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;

    let a_ev: Value =
        serde_json::from_str(&a_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    let b_ev: Value =
        serde_json::from_str(&b_ws.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
    let events = [a_ev, b_ev];
    let granted = events.iter().filter(|v| v["event"] == "claim.granted").count();
    let full = events.iter().find(|v| v["event"] == "claim.full").expect("full");
    assert_eq!(granted, 1);
    assert_eq!(full["message"], MSG_CLASSROOM_FULL);
    assert_eq!(full["message"], "本课设备已领完，请看教师屏");
}

#[tokio::test]
async fn standalone_and_hosted_share_pool() {
    let (state, _dir) = state();
    let id = create_with_pcs(state.clone(), 2).await;
    post(
        state.clone(),
        &format!("/api/v1/classrooms/{id}/open-claim"),
        json!({}),
    )
    .await;
    let nic = "aa:bb:cc:dd:ee:10";
    let (_, standalone) = post(
        state.clone(),
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-standalone", "nic_mac": nic}),
    )
    .await;
    let (_, hosted) = post(
        state,
        "/api/v1/classrooms/join",
        json!({"client_kind": "student-hosted"}),
    )
    .await;
    let sa_id = standalone["data"]["device"]["id"].as_str().unwrap();
    let ho_id = hosted["data"]["device"]["id"].as_str().unwrap();
    assert_ne!(sa_id, ho_id);
    assert_eq!(standalone["data"]["device"]["mac"], nic);
    let hosted_mac = hosted["data"]["device"]["mac"].as_str().unwrap();
    assert_ne!(hosted_mac, nic);
    assert!(is_unicast_mac(hosted_mac));
}
