use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use papernet_shared::MASK_C;
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
            "json {e} status={} body={}",
            status,
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
            b.body(Body::from(
                body.map(|v| v.to_string()).unwrap_or_default(),
            ))
            .unwrap(),
        )
        .await
        .unwrap();
    (res.status(), json_body(res).await)
}

async fn create_lab(state: AppState) -> String {
    let (_, v) = send(
        state,
        "POST",
        "/api/v1/classrooms",
        &[],
        Some(json!({
            "title": "拓扑课",
            "inventory": {
                "routers": [{"id": "R1", "port_count": 2, "ports": [
                    {"id": "R1/01", "ip": "192.168.1.1"}
                ]}],
                "switches": [{"id": "S1", "port_count": 2}],
                "pcs": [{"id": "PC1"}],
                "taps": [{"id": "TAP1"}]
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

async fn claim_roles(state: AppState, id: &str) -> Vec<(String, Value)> {
    open(state.clone(), id).await;
    let mut out = Vec::new();
    for _ in 0..4 {
        out.push(join_claimed(state.clone()).await);
    }
    out
}

fn by_kind<'a>(roles: &'a [(String, Value)], kind: &str) -> &'a (String, Value) {
    roles
        .iter()
        .find(|(_, d)| d["kind"] == kind)
        .unwrap_or_else(|| panic!("missing {kind}"))
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

async fn teacher_snapshot(state: AppState, id: &str) -> Value {
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

#[tokio::test]
async fn one_sided_peer_keeps_link_down() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, pc) = by_kind(&roles, "pc");
    let pc_id = pc["id"].as_str().unwrap();
    put_port(
        state.clone(),
        pc_conn,
        pc_id,
        "PC1/01",
        json!({"peer_port_id": "S1/01"}),
    )
    .await;
    let snap = teacher_snapshot(state, &id).await;
    let link = snap["links"].as_array().unwrap().iter().find(|l| {
        l["port_a"] == "PC1/01" || l["port_b"] == "PC1/01"
    }).expect("link");
    assert_eq!(link["physically_up"], false);
}

#[tokio::test]
async fn mutual_peer_fills_switch_mac_table() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, pc) = by_kind(&roles, "pc");
    let (sw_conn, sw) = by_kind(&roles, "switch");
    let pc_mac = pc["mac"].as_str().unwrap().to_string();
    put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"peer_port_id": "S1/01", "ip": "192.168.1.10"}),
    )
    .await;
    put_port(
        state.clone(),
        sw_conn,
        sw["id"].as_str().unwrap(),
        "S1/01",
        json!({"peer_port_id": "PC1/01"}),
    )
    .await;
    let snap = teacher_snapshot(state, &id).await;
    let mac = snap["mac_table"].as_array().unwrap().iter().find(|e| {
        e["switch_id"] == "S1" && e["port_id"] == "S1/01"
    }).expect("mac");
    assert_eq!(mac["mac"], pc_mac);
    let up = snap["links"].as_array().unwrap().iter().any(|l| {
        l["physically_up"] == true
            && (l["port_a"] == "PC1/01" || l["port_b"] == "PC1/01")
    });
    assert!(up);
}

#[tokio::test]
async fn pc_gateway_arp_when_link_is_up() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, pc) = by_kind(&roles, "pc");
    let (sw_conn, sw) = by_kind(&roles, "switch");
    let (r_conn, r) = by_kind(&roles, "router");
    put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"peer_port_id": "S1/01", "ip": "192.168.1.10", "gateway": "192.168.1.1"}),
    )
    .await;
    put_port(
        state.clone(),
        sw_conn,
        sw["id"].as_str().unwrap(),
        "S1/01",
        json!({"peer_port_id": "PC1/01"}),
    )
    .await;
    put_port(
        state.clone(),
        sw_conn,
        sw["id"].as_str().unwrap(),
        "S1/02",
        json!({"peer_port_id": "R1/01"}),
    )
    .await;
    put_port(
        state.clone(),
        r_conn,
        r["id"].as_str().unwrap(),
        "R1/01",
        json!({"peer_port_id": "S1/02"}),
    )
    .await;
    let snap = teacher_snapshot(state, &id).await;
    let arp = snap["arp_table"].as_array().unwrap().iter().find(|e| {
        e["device_id"] == "PC1" && e["ip"] == "192.168.1.1"
    }).expect("gateway arp");
    assert!(arp["mac"].as_str().unwrap().contains(':'));
}

#[tokio::test]
async fn peers_exclude_tap_ports() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let (st, v) = send(
        state,
        "GET",
        "/api/v1/ports/peers",
        &[("x-classroom-id", &id)],
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let ports: Vec<&str> = v["data"]["ports"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert!(ports.contains(&"PC1/01"));
    assert!(ports.contains(&"S1/01"));
    assert!(ports.contains(&"R1/01"));
    assert!(!ports.iter().any(|p| p.starts_with("TAP")));
}

#[tokio::test]
async fn mask_is_always_c_class() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, pc) = by_kind(&roles, "pc");
    let (st, v) = put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"ip": "192.168.1.10", "mask": "255.255.0.0"}),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"]["code"], "MASK_FIXED");
    let (st, v) = put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"ip": "192.168.1.10", "peer_port_id": "S1/01"}),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["data"]["ports"][0]["mask"], MASK_C);
}

#[tokio::test]
async fn other_role_cannot_write_port() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, _) = by_kind(&roles, "pc");
    let (st, v) = put_port(
        state,
        pc_conn,
        "S1",
        "S1/01",
        json!({"peer_port_id": "PC1/01"}),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    assert_eq!(v["error"]["code"], "NOT_OWNER");
}

#[tokio::test]
async fn tap_attach_on_up_link_and_ws_patch_under_4kb() {
    let (state, _dir) = state();
    let id = create_lab(state.clone()).await;
    let roles = claim_roles(state.clone(), &id).await;
    let (pc_conn, pc) = by_kind(&roles, "pc");
    let (sw_conn, sw) = by_kind(&roles, "switch");
    put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"peer_port_id": "S1/01"}),
    )
    .await;
    put_port(
        state.clone(),
        sw_conn,
        sw["id"].as_str().unwrap(),
        "S1/01",
        json!({"peer_port_id": "PC1/01"}),
    )
    .await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve_state)).await.unwrap();
    });
    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={pc_conn}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let hello = ws.next().await.unwrap().unwrap();
    assert!(hello.into_text().unwrap().contains("hello"));

    put_port(
        state.clone(),
        pc_conn,
        pc["id"].as_str().unwrap(),
        "PC1/01",
        json!({"ip": "192.168.1.10", "peer_port_id": "S1/01"}),
    )
    .await;
    let msg = ws.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    assert!(text.len() < 4096);
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["event"], "topology.updated");

    let (st, v) = send(
        state.clone(),
        "POST",
        &format!("/api/v1/classrooms/{id}/taps/TAP1/attach"),
        &[("x-client-kind", "teacher")],
        Some(json!({"link": {"port_a": "PC1/01", "port_b": "S1/01"}})),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["data"]["tap_id"], "TAP1");
}

#[tokio::test]
async fn restart_restores_inventory_and_clears_claims() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("papernet.sqlite");
    let id;
    {
        let state = AppState::open(&db).expect("open");
        id = create_lab(state.clone()).await;
        let roles = claim_roles(state.clone(), &id).await;
        let (pc_conn, pc) = by_kind(&roles, "pc");
        let (sw_conn, sw) = by_kind(&roles, "switch");
        put_port(
            state.clone(),
            pc_conn,
            pc["id"].as_str().unwrap(),
            "PC1/01",
            json!({"peer_port_id": "S1/01", "ip": "192.168.1.10"}),
        )
        .await;
        put_port(
            state.clone(),
            sw_conn,
            sw["id"].as_str().unwrap(),
            "S1/01",
            json!({"peer_port_id": "PC1/01"}),
        )
        .await;
        let snap = teacher_snapshot(state.clone(), &id).await;
        let up = snap["links"].as_array().unwrap().iter().any(|l| {
            l["physically_up"] == true
                && (l["port_a"] == "PC1/01" || l["port_b"] == "PC1/01")
        });
        assert!(up);
    }
    let state = AppState::open(&db).expect("reopen");
    let snap = teacher_snapshot(state.clone(), &id).await;
    let devices = snap["devices"].as_array().expect("devices");
    assert_eq!(devices.len(), 4);
    for d in devices {
        assert!(d["claimed_connection_id"].is_null());
    }
    let r1_01 = devices
        .iter()
        .find(|d| d["id"] == "R1")
        .unwrap()["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "R1/01")
        .unwrap();
    assert_eq!(r1_01["ip"], "192.168.1.1");
    let pc_port = devices
        .iter()
        .find(|d| d["id"] == "PC1")
        .unwrap()["ports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "PC1/01")
        .unwrap();
    assert_eq!(pc_port["peer_port_id"], "S1/01");
    assert_eq!(pc_port["ip"], "192.168.1.10");
    let up = snap["links"].as_array().unwrap().iter().any(|l| {
        l["physically_up"] == true && (l["port_a"] == "PC1/01" || l["port_b"] == "PC1/01")
    });
    assert!(up);
    let (_, claimed) = join_claimed(state).await;
    assert!(claimed["id"].as_str().is_some());
}
