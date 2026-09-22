use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use papernet_teacher::{app, AppState};
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::net::TcpListener;
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

async fn create_scene(state: AppState) -> String {
    let (_, v) = send(
        state,
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "互通课",
            "inventory": {
                "routers": [{"id": "R1", "port_count": 2, "ports": [
                    {"id": "R1/01", "ip": "192.168.1.1"},
                    {"id": "R1/02", "ip": "192.168.2.1"}
                ]}],
                "switches": [
                    {"id": "S1", "port_count": 2},
                    {"id": "S2", "port_count": 2}
                ],
                "pcs": [{"id": "PCA"}, {"id": "PCB"}]
            }
        })),
    )
    .await;
    v["data"]["classroom_id"].as_str().unwrap().to_string()
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

async fn wire_scene(
    state: AppState,
    roles: &[(String, Value)],
    pca_gw: &str,
) {
    let (pca_conn, _) = by_id(roles, "PCA");
    let (pcb_conn, _) = by_id(roles, "PCB");
    let (s1_conn, _) = by_id(roles, "S1");
    let (s2_conn, _) = by_id(roles, "S2");
    let (r_conn, _) = by_id(roles, "R1");
    put_port(
        state.clone(),
        pca_conn,
        "PCA",
        "PCA/01",
        json!({"peer_port_id": "S1/01", "ip": "192.168.1.10", "gateway": pca_gw}),
    )
    .await;
    put_port(
        state.clone(),
        s1_conn,
        "S1",
        "S1/01",
        json!({"peer_port_id": "PCA/01"}),
    )
    .await;
    put_port(
        state.clone(),
        s1_conn,
        "S1",
        "S1/02",
        json!({"peer_port_id": "R1/01"}),
    )
    .await;
    put_port(
        state.clone(),
        r_conn,
        "R1",
        "R1/01",
        json!({"peer_port_id": "S1/02"}),
    )
    .await;
    put_port(
        state.clone(),
        r_conn,
        "R1",
        "R1/02",
        json!({"peer_port_id": "S2/01"}),
    )
    .await;
    put_port(
        state.clone(),
        s2_conn,
        "S2",
        "S2/01",
        json!({"peer_port_id": "R1/02"}),
    )
    .await;
    put_port(
        state.clone(),
        s2_conn,
        "S2",
        "S2/02",
        json!({"peer_port_id": "PCB/01"}),
    )
    .await;
    put_port(
        state,
        pcb_conn,
        "PCB",
        "PCB/01",
        json!({"peer_port_id": "S2/02", "ip": "192.168.2.10", "gateway": "192.168.2.1"}),
    )
    .await;
}

#[tokio::test]
async fn correct_gateway_chat_delivers() {
    let (state, _dir) = state();
    let id = create_scene(state.clone()).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles, "192.168.1.1").await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (pcb_conn, _) = by_id(&roles, "PCB");

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });

    let pca_url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={pca_conn}");
    let pcb_url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={pcb_conn}");
    let (mut pca_ws, _) = tokio_tungstenite::connect_async(&pca_url).await.unwrap();
    let (mut pcb_ws, _) = tokio_tungstenite::connect_async(&pcb_url).await.unwrap();
    assert!(pca_ws
        .next()
        .await
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap()
        .contains("hello"));
    assert!(pcb_ws
        .next()
        .await
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap()
        .contains("hello"));

    let (st, v) = send(
        state,
        "POST",
        "/api/v1/chat",
        &[("x-connection-id", pca_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.2.10", "text": "你好"})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["data"]["text"], "你好");

    let sent = pca_ws.next().await.unwrap().unwrap().into_text().unwrap();
    let sent_v: Value = serde_json::from_str(&sent).unwrap();
    assert_eq!(sent_v["event"], "chat.sent");
    assert_eq!(sent_v["text"], "你好");

    let recv = pcb_ws.next().await.unwrap().unwrap().into_text().unwrap();
    let recv_v: Value = serde_json::from_str(&recv).unwrap();
    assert_eq!(recv_v["event"], "chat.received");
    assert_eq!(recv_v["from_ip"], "192.168.1.10");
    assert_eq!(recv_v["to_ip"], "192.168.2.10");
}

#[tokio::test]
async fn wrong_gateway_ping_fails() {
    let (state, _dir) = state();
    let id = create_scene(state.clone()).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles, "192.168.1.99").await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (st, v) = send(
        state,
        "POST",
        "/api/v1/ping",
        &[("x-connection-id", pca_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.2.10"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["error"]["code"], "UNREACHABLE");
}

#[tokio::test]
async fn correct_gateway_ping_succeeds() {
    let (state, _dir) = state();
    let id = create_scene(state.clone()).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles, "192.168.1.1").await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (st, v) = send(
        state,
        "POST",
        "/api/v1/ping",
        &[("x-connection-id", pca_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.2.10"})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["data"]["reachable"], true);
    let detail = v["data"]["detail"].as_str().unwrap();
    assert!(detail.contains("192.168.2.10"));
}

#[tokio::test]
async fn wrong_gateway_chat_fails() {
    let (state, _dir) = state();
    let id = create_scene(state.clone()).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles, "192.168.1.99").await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (st, v) = send(
        state,
        "POST",
        "/api/v1/chat",
        &[("x-connection-id", pca_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.2.10", "text": "你好"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["error"]["code"], "UNREACHABLE");
}

#[tokio::test]
async fn same_segment_two_pcs_via_switch() {
    let (state, _dir) = state();
    let (_, v) = send(
        state.clone(),
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "同网段",
            "inventory": {
                "switches": [{"id": "S1", "port_count": 2}],
                "pcs": [{"id": "PC1"}, {"id": "PC2"}]
            }
        })),
    )
    .await;
    let id = v["data"]["classroom_id"].as_str().unwrap().to_string();
    let roles = claim_all(state.clone(), &id, 3).await;
    let (pc1_conn, _) = by_id(&roles, "PC1");
    let (pc2_conn, _) = by_id(&roles, "PC2");
    let (s_conn, _) = by_id(&roles, "S1");
    put_port(
        state.clone(),
        pc1_conn,
        "PC1",
        "PC1/01",
        json!({"peer_port_id": "S1/01", "ip": "192.168.1.10"}),
    )
    .await;
    put_port(
        state.clone(),
        s_conn,
        "S1",
        "S1/01",
        json!({"peer_port_id": "PC1/01"}),
    )
    .await;
    put_port(
        state.clone(),
        s_conn,
        "S1",
        "S1/02",
        json!({"peer_port_id": "PC2/01"}),
    )
    .await;
    put_port(
        state.clone(),
        pc2_conn,
        "PC2",
        "PC2/01",
        json!({"peer_port_id": "S1/02", "ip": "192.168.1.11"}),
    )
    .await;
    let (st, v) = send(
        state,
        "POST",
        "/api/v1/chat",
        &[("x-connection-id", pc1_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.1.11", "text": "同网段"})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["data"]["to_ip"], "192.168.1.11");
}

#[tokio::test]
async fn router_chat_is_rejected() {
    let (state, _dir) = state();
    let id = create_scene(state.clone()).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles, "192.168.1.1").await;
    let (r_conn, _) = by_id(&roles, "R1");
    let (st, v) = send(
        state,
        "POST",
        "/api/v1/chat",
        &[("x-connection-id", r_conn), ("x-classroom-id", &id)],
        Some(json!({"to_ip": "192.168.2.10", "text": "你好"})),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["error"]["code"], "NOT_OWNER");
}
