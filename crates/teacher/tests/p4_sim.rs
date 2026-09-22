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
        panic!("json {e} status={status} body={}", String::from_utf8_lossy(&bytes))
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

async fn create_scene(state: AppState, with_tap: bool) -> String {
    let mut inventory = json!({
        "routers": [{"id": "R1", "port_count": 2, "ports": [
            {"id": "R1/01", "ip": "192.168.1.1"},
            {"id": "R1/02", "ip": "192.168.2.1"}
        ]}],
        "switches": [
            {"id": "S1", "port_count": 2},
            {"id": "S2", "port_count": 2}
        ],
        "pcs": [{"id": "PCA"}, {"id": "PCB"}]
    });
    if with_tap {
        inventory["taps"] = json!([{"id": "TAP1"}]);
    }
    let (_, v) = send(
        state,
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({"title": "模拟课", "inventory": inventory})),
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

async fn wire_scene(state: AppState, roles: &[(String, Value)]) {
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
        json!({"peer_port_id": "S1/01", "ip": "192.168.1.10", "gateway": "192.168.1.1"}),
    )
    .await;
    put_port(state.clone(), s1_conn, "S1", "S1/01", json!({"peer_port_id": "PCA/01"})).await;
    put_port(state.clone(), s1_conn, "S1", "S1/02", json!({"peer_port_id": "R1/01"})).await;
    put_port(state.clone(), r_conn, "R1", "R1/01", json!({"peer_port_id": "S1/02"})).await;
    put_port(state.clone(), r_conn, "R1", "R1/02", json!({"peer_port_id": "S2/01"})).await;
    put_port(state.clone(), s2_conn, "S2", "S2/01", json!({"peer_port_id": "R1/02"})).await;
    put_port(state.clone(), s2_conn, "S2", "S2/02", json!({"peer_port_id": "PCB/01"})).await;
    put_port(
        state,
        pcb_conn,
        "PCB",
        "PCB/01",
        json!({"peer_port_id": "S2/02", "ip": "192.168.2.10", "gateway": "192.168.2.1"}),
    )
    .await;
}

async fn set_sim(state: AppState, id: &str) {
    let (st, _) = send(
        state,
        "POST",
        &format!("/api/v1/classrooms/{id}/mode"),
        &[("x-client-kind", "teacher")],
        Some(json!({"mode": "simulation"})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

async fn snapshot(state: AppState, id: &str) -> Value {
    let (st, v) = send(
        state,
        "GET",
        &format!("/api/v1/classrooms/{id}/snapshot"),
        &[("x-client-kind", "teacher")],
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    v["data"].clone()
}

async fn sim_send(state: AppState, id: &str, conn: &str, to_ip: &str, text: &str) -> (StatusCode, Value) {
    send(
        state,
        "POST",
        "/api/v1/sim/send",
        &[("x-connection-id", conn), ("x-classroom-id", id)],
        Some(json!({"to_ip": to_ip, "text": text})),
    )
    .await
}

async fn forward(
    state: AppState,
    id: &str,
    conn: &str,
    frame_id: &str,
    out_port: &str,
) -> (StatusCode, Value) {
    send(
        state,
        "POST",
        &format!("/api/v1/sim/frames/{frame_id}/forward"),
        &[("x-connection-id", conn), ("x-classroom-id", id)],
        Some(json!({"out_port_id": out_port})),
    )
    .await
}

fn frame_at(snap: &Value, frame_id: &str) -> Value {
    snap["frames"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["frame_id"] == frame_id)
        .cloned()
        .expect("frame")
}

#[tokio::test]
async fn switch_wrong_port_keeps_frame() {
    let (state, _dir) = state();
    let id = create_scene(state.clone(), false).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles).await;
    set_sim(state.clone(), &id).await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (s1_conn, _) = by_id(&roles, "S1");
    let (st, v) = sim_send(state.clone(), &id, pca_conn, "192.168.2.10", "你好").await;
    assert_eq!(st, StatusCode::OK);
    let frame_id = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    assert_eq!(v["data"]["frame"]["at_device_id"], "S1");
    let (st, v) = forward(state.clone(), &id, s1_conn, &frame_id, "S1/01").await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["error"]["code"], "WRONG_PORT");
    let snap = snapshot(state, &id).await;
    let f = frame_at(&snap, &frame_id);
    assert_eq!(f["at_device_id"], "S1");
    assert_eq!(f["payload"], "你好");
}

#[tokio::test]
async fn router_correct_port_rewrites_mac() {
    let (state, _dir) = state();
    let id = create_scene(state.clone(), false).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles).await;
    set_sim(state.clone(), &id).await;
    let pcb_mac = by_id(&roles, "PCB").1["mac"].as_str().unwrap().to_string();
    let r1_02_mac = by_id(&roles, "R1").1["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "R1/02")
        .unwrap()["mac"]
        .as_str()
        .unwrap()
        .to_string();
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (s1_conn, _) = by_id(&roles, "S1");
    let (r_conn, _) = by_id(&roles, "R1");
    let (_, v) = sim_send(state.clone(), &id, pca_conn, "192.168.2.10", "你好").await;
    let frame_id = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    let (st, _) = forward(state.clone(), &id, s1_conn, &frame_id, "S1/02").await;
    assert_eq!(st, StatusCode::OK);
    let (st, v) = forward(state, &id, r_conn, &frame_id, "R1/02").await;
    assert_eq!(st, StatusCode::OK);
    let frame = &v["data"]["frame"];
    assert_eq!(frame["at_device_id"], "S2");
    assert_eq!(frame["dst_mac"], pcb_mac);
    assert_eq!(frame["src_mac"], r1_02_mac);
    assert_eq!(frame["src_ip"], "192.168.1.10");
    assert_eq!(frame["dst_ip"], "192.168.2.10");
    assert_eq!(frame["payload"], "你好");
}

#[tokio::test]
async fn tap_log_counts_passes() {
    let (state, _dir) = state();
    let id = create_scene(state.clone(), true).await;
    let roles = claim_all(state.clone(), &id, 6).await;
    wire_scene(state.clone(), &roles).await;
    let (st, _) = send(
        state.clone(),
        "POST",
        &format!("/api/v1/classrooms/{id}/taps/TAP1/attach"),
        &[("x-client-kind", "teacher")],
        Some(json!({"link": {"port_a": "PCA/01", "port_b": "S1/01"}})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    set_sim(state.clone(), &id).await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (s1_conn, _) = by_id(&roles, "S1");
    let (r_conn, _) = by_id(&roles, "R1");
    let (s2_conn, _) = by_id(&roles, "S2");
    let (_, v) = sim_send(state.clone(), &id, pca_conn, "192.168.2.10", "你好").await;
    let frame_id = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    assert_eq!(v["data"]["frame"]["at_device_id"], "S1");
    forward(state.clone(), &id, s1_conn, &frame_id, "S1/02").await;
    forward(state.clone(), &id, r_conn, &frame_id, "R1/02").await;
    forward(state.clone(), &id, s2_conn, &frame_id, "S2/02").await;
    let snap = snapshot(state.clone(), &id).await;
    assert_eq!(snap["tap_log"].as_array().unwrap().len(), 1);

    let (pcb_conn, _) = by_id(&roles, "PCB");
    let (_, v) = sim_send(state.clone(), &id, pcb_conn, "192.168.1.10", "收到").await;
    let back = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    forward(state.clone(), &id, s2_conn, &back, "S2/01").await;
    forward(state.clone(), &id, r_conn, &back, "R1/01").await;
    forward(state.clone(), &id, s1_conn, &back, "S1/01").await;
    let snap = snapshot(state, &id).await;
    assert_eq!(snap["tap_log"].as_array().unwrap().len(), 2);
    assert_eq!(frame_at(&snap, &back)["at_device_id"], "PCA");
    assert_eq!(frame_at(&snap, &back)["status"], "delivered");
}

#[tokio::test]
async fn reply_frame_returns_to_source() {
    let (state, _dir) = state();
    let id = create_scene(state.clone(), false).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles).await;
    set_sim(state.clone(), &id).await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (pcb_conn, _) = by_id(&roles, "PCB");
    let (s1_conn, _) = by_id(&roles, "S1");
    let (s2_conn, _) = by_id(&roles, "S2");
    let (r_conn, _) = by_id(&roles, "R1");
    let (_, v) = sim_send(state.clone(), &id, pca_conn, "192.168.2.10", "你好").await;
    let fid = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    forward(state.clone(), &id, s1_conn, &fid, "S1/02").await;
    forward(state.clone(), &id, r_conn, &fid, "R1/02").await;
    forward(state.clone(), &id, s2_conn, &fid, "S2/02").await;
    let snap = snapshot(state.clone(), &id).await;
    assert_eq!(frame_at(&snap, &fid)["at_device_id"], "PCB");
    assert_eq!(frame_at(&snap, &fid)["status"], "delivered");

    let (_, v) = sim_send(state.clone(), &id, pcb_conn, "192.168.1.10", "收到").await;
    let back = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    forward(state.clone(), &id, s2_conn, &back, "S2/01").await;
    forward(state.clone(), &id, r_conn, &back, "R1/01").await;
    let (st, _) = forward(state.clone(), &id, s1_conn, &back, "S1/01").await;
    assert_eq!(st, StatusCode::OK);
    let snap = snapshot(state, &id).await;
    let f = frame_at(&snap, &back);
    assert_eq!(f["at_device_id"], "PCA");
    assert_eq!(f["status"], "delivered");
    assert_eq!(f["payload"], "收到");
}

#[tokio::test]
async fn correct_port_pushes_frame_arrived() {
    let (state, _dir) = state();
    let id = create_scene(state.clone(), false).await;
    let roles = claim_all(state.clone(), &id, 5).await;
    wire_scene(state.clone(), &roles).await;
    set_sim(state.clone(), &id).await;
    let (pca_conn, _) = by_id(&roles, "PCA");
    let (s1_conn, _) = by_id(&roles, "S1");
    let (r_conn, _) = by_id(&roles, "R1");

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve)).await.unwrap();
    });

    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={r_conn}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    let hello = ws.next().await.expect("hello").expect("ok");
    let hello_v: Value = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert_eq!(hello_v["event"], "hello");

    let (_, v) = sim_send(state.clone(), &id, pca_conn, "192.168.2.10", "你好").await;
    let frame_id = v["data"]["frame"]["frame_id"].as_str().unwrap().to_string();
    let (st, _) = forward(state, &id, s1_conn, &frame_id, "S1/02").await;
    assert_eq!(st, StatusCode::OK);

    let arrived = ws.next().await.expect("arrived").expect("ok");
    let ev: Value = serde_json::from_str(&arrived.into_text().unwrap()).unwrap();
    assert_eq!(ev["event"], "frame.arrived");
    assert_eq!(ev["at_device_id"], "R1");
    assert_eq!(ev["frame"]["frame_id"], frame_id);
    assert_eq!(ev["frame"]["payload"], "你好");
}
