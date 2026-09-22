use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use papernet_teacher::{app, AppState};
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;

fn state() -> (AppState, tempfile::TempDir) {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("papernet.sqlite");
    (AppState::open(&db).expect("open db"), dir)
}

async fn json_body(res: axum::response::Response) -> Value {
    let status = res.status();
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    if bytes.is_empty() {
        panic!("empty body status={status}");
    }
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "json {e} status={status} body={}",
            String::from_utf8_lossy(&bytes)
        )
    })
}

async fn send(
    state: AppState,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut b = Request::builder().method(method).uri(uri);
    if body.is_some() {
        b = b.header("content-type", "application/json");
    }
    for (k, v) in headers {
        b = b.header(*k, *v);
    }
    let res = app(state)
        .oneshot(
            b.body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    (res.status(), json_body(res).await)
}

async fn open(state: AppState, id: &str) {
    send(
        state,
        "POST",
        &format!("/api/v1/classrooms/{id}/open-claim"),
        &[],
        Some(json!({})),
    )
    .await;
}

async fn join_claimed(state: AppState) -> (String, Value) {
    let (_, v) = send(
        state,
        "POST",
        "/api/v1/classrooms/join",
        &[],
        Some(json!({"client_kind": "student-hosted"})),
    )
    .await;
    assert_eq!(v["data"]["status"], "claimed");
    (
        v["data"]["connection_id"].as_str().unwrap().to_string(),
        v["data"]["device"].clone(),
    )
}

async fn claim_all(state: AppState, id: &str, n: usize) -> Vec<(String, Value)> {
    open(state.clone(), id).await;
    let mut out = Vec::new();
    for _ in 0..n {
        out.push(join_claimed(state.clone()).await);
    }
    out
}

fn by_id<'a>(roles: &'a [(String, Value)], id: &str) -> &'a (String, Value) {
    roles
        .iter()
        .find(|(_, d)| d["id"] == id)
        .unwrap_or_else(|| panic!("missing {id}"))
}

async fn put_port(
    state: AppState,
    conn: &str,
    device_id: &str,
    port_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(
        state,
        "PUT",
        &format!("/api/v1/devices/{device_id}/ports/{port_id}"),
        &[("x-connection-id", conn)],
        Some(body),
    )
    .await
}

async fn wire_lan(state: AppState, roles: &[(String, Value)], pc_count: usize) {
    let (s_conn, _) = by_id(roles, "S1");
    for i in 1..=pc_count {
        let pc = format!("PC{i}");
        let pc_port = format!("{pc}/01");
        let sw_port = format!("S1/{i:02}");
        let ip = format!("192.168.1.{}", 10 + i);
        let (pc_conn, _) = by_id(roles, &pc);
        put_port(
            state.clone(),
            pc_conn,
            &pc,
            &pc_port,
            json!({"peer_port_id": sw_port, "ip": ip}),
        )
        .await;
        put_port(
            state.clone(),
            s_conn,
            "S1",
            &sw_port,
            json!({"peer_port_id": pc_port}),
        )
        .await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn ws_100_heartbeat_snapshot_opens() {
    let (state, _dir) = state();
    let pcs: Vec<Value> = (1..=100).map(|i| json!({"id": format!("PC{i}")})).collect();
    let (_, v) = send(
        state.clone(),
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "百人课",
            "inventory": {
                "pcs": pcs,
                "switches": [],
                "routers": [],
                "taps": []
            }
        })),
    )
    .await;
    let id = v["data"]["classroom_id"].as_str().unwrap().to_string();
    let roles = claim_all(state.clone(), &id, 100).await;
    assert_eq!(roles.len(), 100);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve)).await.unwrap();
    });

    let mut sockets = Vec::with_capacity(100);
    for (conn_id, _) in &roles {
        let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={conn_id}");
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
        let hello = ws.next().await.expect("hello").expect("ok");
        let hello_v: Value = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
        assert_eq!(hello_v["event"], "hello");
        ws.send(Message::Text(
            json!({"event": "heartbeat"}).to_string().into(),
        ))
        .await
        .unwrap();
        sockets.push(ws);
    }
    assert_eq!(sockets.len(), 100);

    let (st, snap) = send(
        state,
        "GET",
        &format!("/api/v1/classrooms/{id}/snapshot"),
        &[("x-client-kind", "teacher")],
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(snap["ok"], true);
    assert_eq!(snap["data"]["devices"].as_array().unwrap().len(), 100);
    assert_eq!(snap["data"]["online"], 100);
}

#[tokio::test(flavor = "multi_thread")]
async fn chat_10_paths_respond() {
    let (state, _dir) = state();
    let pcs: Vec<Value> = (1..=10).map(|i| json!({"id": format!("PC{i}")})).collect();
    let (_, v) = send(
        state.clone(),
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "十路文字",
            "inventory": {
                "pcs": pcs,
                "switches": [{"id": "S1", "port_count": 10}],
                "routers": [],
                "taps": []
            }
        })),
    )
    .await;
    let id = v["data"]["classroom_id"].as_str().unwrap().to_string();
    let roles = claim_all(state.clone(), &id, 11).await;
    wire_lan(state.clone(), &roles, 10).await;

    let mut futs = Vec::new();
    for i in 1..=10 {
        let to = if i == 10 { 1 } else { i + 1 };
        let to_ip = format!("192.168.1.{}", 10 + to);
        let conn = by_id(&roles, &format!("PC{i}")).0.clone();
        let state = state.clone();
        let id = id.clone();
        futs.push(async move {
            send(
                state,
                "POST",
                "/api/v1/chat",
                &[("x-connection-id", &conn), ("x-classroom-id", &id)],
                Some(json!({"to_ip": to_ip, "text": "你好"})),
            )
            .await
        });
    }
    let results = futures_util::future::join_all(futs).await;
    for (st, v) in results {
        assert_eq!(st, StatusCode::OK, "{v}");
        assert_eq!(v["data"]["text"], "你好");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn sim_4_frames_respond() {
    let (state, _dir) = state();
    let pcs: Vec<Value> = (1..=4).map(|i| json!({"id": format!("PC{i}")})).collect();
    let (_, v) = send(
        state.clone(),
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "四路模拟",
            "inventory": {
                "pcs": pcs,
                "switches": [{"id": "S1", "port_count": 4}],
                "routers": [],
                "taps": []
            }
        })),
    )
    .await;
    let id = v["data"]["classroom_id"].as_str().unwrap().to_string();
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_lan(state.clone(), &roles, 4).await;
    let (st, _) = send(
        state.clone(),
        "POST",
        &format!("/api/v1/classrooms/{id}/mode"),
        &[("x-client-kind", "teacher")],
        Some(json!({"mode": "simulation"})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let pairs = [(1, 2), (2, 1), (3, 4), (4, 3)];
    let mut futs = Vec::new();
    for (from, to) in pairs {
        let to_ip = format!("192.168.1.{}", 10 + to);
        let conn = by_id(&roles, &format!("PC{from}")).0.clone();
        let state = state.clone();
        let id = id.clone();
        futs.push(async move {
            send(
                state,
                "POST",
                "/api/v1/sim/send",
                &[("x-connection-id", &conn), ("x-classroom-id", &id)],
                Some(json!({"to_ip": to_ip, "text": "帧"})),
            )
            .await
        });
    }
    let results = futures_util::future::join_all(futs).await;
    for (st, v) in results {
        assert_eq!(st, StatusCode::OK, "{v}");
        assert_eq!(v["data"]["frame"]["at_device_id"], "S1");
        assert_eq!(v["data"]["frame"]["payload"], "帧");
    }
}
