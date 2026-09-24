//! Teacher server: HTTP API, WebSocket, classroom snapshot.

mod classroom;
mod db;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use papernet_shared::{
    new_classroom_id, ChatRequest, CreateClassroomRequest, ForwardRequest, JoinRequest, Mode,
    ModeRequest, PingRequest, PortPatch, SimSendRequest, TapAttachRequest, MSG_CLASSROOM_FULL,
    MSG_WAITING_OPEN,
};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use classroom::{Classroom, JoinOutcome, OpenClaimEvent};
use classroom::{AttachError, CommError, PortError, SimError, SimPush, UnbindError};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<Store>>,
    db: Arc<Mutex<Connection>>,
    hub: Arc<Mutex<Hub>>,
}

struct Store {
    classrooms: HashMap<String, Classroom>,
}

struct Hub {
    txs: HashMap<String, mpsc::UnboundedSender<WsOut>>,
}

enum WsOut {
    Event(Value),
    Close,
}

impl AppState {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = db::open(db_path)?;
        let classrooms = db::load_classrooms(&conn)?;
        db::clear_claim_bindings(&conn).map_err(|e| e.to_string())?;
        Ok(Self {
            inner: Arc::new(Mutex::new(Store { classrooms })),
            db: Arc::new(Mutex::new(conn)),
            hub: Arc::new(Mutex::new(Hub {
                txs: HashMap::new(),
            })),
        })
    }

    pub fn last_seen(&self, connection_id: &str) -> Option<i64> {
        let store = self.inner.lock().ok()?;
        for class in store.classrooms.values() {
            if let Some(c) = class.connections.get(connection_id) {
                return Some(c.last_seen);
            }
        }
        None
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/classrooms", post(create_classroom))
        .route("/api/v1/classrooms/join", post(join_classroom))
        .route(
            "/api/v1/classrooms/{id}/open-claim",
            post(open_claim),
        )
        .route("/api/v1/classrooms/{id}/snapshot", get(snapshot))
        .route("/api/v1/classrooms/{id}/end", post(end_classroom))
        .route(
            "/api/v1/classrooms/{id}/taps/{tap_id}/attach",
            post(attach_tap),
        )
        .route(
            "/api/v1/classrooms/{id}/devices/{device_id}/unbind",
            post(unbind_device),
        )
        .route(
            "/api/v1/devices/{device_id}/ports/{*port_id}",
            put(put_port),
        )
        .route("/api/v1/ports/peers", get(peer_ports))
        .route("/api/v1/chat", post(chat))
        .route("/api/v1/ping", post(ping))
        .route("/api/v1/classrooms/{id}/mode", post(set_mode))
        .route("/api/v1/sim/send", post(sim_send))
        .route(
            "/api/v1/sim/frames/{frame_id}/forward",
            post(forward_frame),
        )
        .route("/ws", get(ws_upgrade))
        .with_state(state)
}

pub async fn run() -> Result<(), String> {
    let bind = std::env::var("PAPERNET_BIND").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let data_dir = std::env::var("PAPERNET_DATA_DIR").unwrap_or_else(|_| "data".into());
    let db_path = PathBuf::from(data_dir).join("papernet.sqlite");
    let state = AppState::open(&db_path)?;
    let listener = TcpListener::bind(&bind)
        .await
        .map_err(|e| e.to_string())?;
    axum::serve(listener, app(state))
        .await
        .map_err(|e| e.to_string())
}

async fn health() -> Json<Value> {
    Json(json!({"ok": true, "data": {"status": "up"}}))
}

async fn create_classroom(
    State(state): State<AppState>,
    Json(body): Json<CreateClassroomRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let classroom_id = new_classroom_id();
    let created_at = now_ms();
    let class = Classroom::new(
        classroom_id.clone(),
        body.title,
        body.inventory,
        created_at,
    );
    {
        let mut db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::insert_classroom_snapshot(&mut db, &class).map_err(|e| internal(&e.to_string()))?;
    }
    {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        store.classrooms.insert(classroom_id.clone(), class);
    }
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"classroom_id": classroom_id}})),
    ))
}

async fn join_classroom(
    State(state): State<AppState>,
    Json(body): Json<JoinRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let (id, outcome) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = current_classroom_id(&store).ok_or_else(|| {
            not_found("NO_CLASSROOM", "当前没有课堂")
        })?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let outcome = class
            .join(body.client_kind, body.connection_id, body.nic_mac)
            .map_err(|e| bad_request("BAD_REQUEST", &e))?;
        (id, outcome)
    };
    persist_join(&state, &id, &outcome)?;
    emit_online(&state, &id);
    match outcome {
        JoinOutcome::WaitingOpen { connection_id } => Ok((
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "data": {
                    "status": "waiting_open",
                    "connection_id": connection_id,
                    "message": MSG_WAITING_OPEN,
                }
            })),
        )),
        JoinOutcome::Claimed {
            connection_id,
            device,
        } => Ok((
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "data": {
                    "status": "claimed",
                    "connection_id": connection_id,
                    "device": device,
                    "tap_attach": tap_attach_json(&state, &id),
                }
            })),
        )),
        JoinOutcome::Full => Err((
            StatusCode::CONFLICT,
            Json(json!({
                "ok": false,
                "data": {"status": "full"},
                "error": {
                    "code": "CLASSROOM_FULL",
                    "message": MSG_CLASSROOM_FULL,
                }
            })),
        )),
    }
}

async fn open_claim(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let (events, claim_state) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        let events = class.open_claim();
        (events, class.claim_state)
    };
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::update_claim_state(&db, &id, claim_state).map_err(|e| internal(&e.to_string()))?;
        let store = state.inner.lock().map_err(|_| internal("store lock"))?;
        if let Some(class) = store.classrooms.get(&id) {
            for event in &events {
                if let OpenClaimEvent::Granted { connection_id, .. } = event {
                    if let Some(device) = class
                        .connections
                        .get(connection_id)
                        .and_then(|c| c.device_id.as_ref())
                        .and_then(|did| class.devices.get(did))
                    {
                        db::update_device_claim(&db, &id, device)
                            .map_err(|e| internal(&e.to_string()))?;
                    }
                }
            }
        }
    }
    {
        let hub = state.hub.lock().map_err(|_| internal("hub lock"))?;
        for event in events {
            match event {
                OpenClaimEvent::Granted {
                    connection_id,
                    device,
                } => {
                    hub.send(
                        &connection_id,
                        WsOut::Event(json!({
                            "event": "claim.granted",
                            "device": device,
                        })),
                    );
                }
                OpenClaimEvent::Full { connection_id } => {
                    hub.send(
                        &connection_id,
                        WsOut::Event(json!({
                            "event": "claim.full",
                            "message": MSG_CLASSROOM_FULL,
                        })),
                    );
                    hub.send(&connection_id, WsOut::Close);
                }
            }
        }
    }
    emit_online(&state, &id);
    Ok((
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "data": {"claim_state": claim_state.as_str()}
        })),
    ))
}

async fn put_port(
    State(state): State<AppState>,
    AxumPath((device_id, port_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<PortPatch>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let connection_id = hdr(&headers, "x-connection-id")
        .ok_or_else(|| bad_request("BAD_REQUEST", "缺少 X-Connection-Id"))?;
    let (classroom_id, patch) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = classroom_from_headers(&store, &headers)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        let patch = class
            .configure_port(&connection_id, &device_id, &port_id, body)
            .map_err(port_err)?;
        (id, patch)
    };
    persist_topology(&state, &classroom_id)?;
    let event = json!({
        "event": "topology.updated",
        "ports": patch["ports"],
        "links": patch["links"],
        "mac_table": patch["mac_table"],
        "arp_table": patch["arp_table"],
    });
    if let Ok(hub) = state.hub.lock() {
        hub.broadcast(event.clone());
    }
    Ok((StatusCode::OK, Json(json!({"ok": true, "data": patch}))))
}

async fn snapshot(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if hdr(&headers, "x-client-kind").as_deref() != Some("teacher") {
        return Err(conflict("NOT_OWNER", "仅教师可查看快照"));
    }
    let store = state.inner.lock().map_err(|_| internal("store lock"))?;
    let class = store
        .classrooms
        .get(&id)
        .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": class.snapshot()})),
    ))
}

async fn end_classroom(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if hdr(&headers, "x-client-kind").as_deref() != Some("teacher") {
        return Err(conflict("NOT_OWNER", "仅教师可结束课堂"));
    }
    {
        let store = state.inner.lock().map_err(|_| internal("store lock"))?;
        if !store.classrooms.contains_key(&id) {
            return Err(not_found("NO_CLASSROOM", "课堂不存在"));
        }
    }
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::delete_classroom(&db, &id).map_err(|e| internal(&e.to_string()))?;
    }
    let conn_ids = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        match store.classrooms.remove(&id) {
            Some(class) => class.connections.keys().cloned().collect::<Vec<_>>(),
            None => Vec::new(),
        }
    };
    if let Ok(mut hub) = state.hub.lock() {
        for cid in &conn_ids {
            hub.send(cid, WsOut::Close);
            hub.txs.remove(cid);
        }
    }
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"ended": true}})),
    ))
}

async fn attach_tap(
    State(state): State<AppState>,
    AxumPath((id, tap_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<TapAttachRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if hdr(&headers, "x-client-kind").as_deref() != Some("teacher") {
        return Err(conflict("NOT_OWNER", "仅教师可放置特殊双口"));
    }
    let data = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class
            .attach_tap(&tap_id, &body.link.port_a, &body.link.port_b)
            .map_err(attach_err)?
    };
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        if let Some(link_id) = data["link_id"].as_str() {
            db::upsert_tap_attach(&db, &id, &tap_id, link_id)
                .map_err(|e| internal(&e.to_string()))?;
        }
    }
    let event = json!({"event": "topology.updated", "tap_attach": data});
    if let Ok(hub) = state.hub.lock() {
        hub.broadcast(event);
    }
    Ok((StatusCode::OK, Json(json!({"ok": true, "data": data}))))
}

async fn unbind_device(
    State(state): State<AppState>,
    AxumPath((id, device_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if hdr(&headers, "x-client-kind").as_deref() != Some("teacher") {
        return Err(conflict("NOT_OWNER", "仅教师可解除绑定"));
    }
    let (_released, claim_state, device) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        let released = class.unbind_device(&device_id).map_err(unbind_err)?;
        let device = class.devices.get(&device_id).cloned();
        (released, class.claim_state, device)
    };
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::update_claim_state(&db, &id, claim_state).map_err(|e| internal(&e.to_string()))?;
        if let Some(device) = device.as_ref() {
            db::update_device_claim(&db, &id, device).map_err(|e| internal(&e.to_string()))?;
        }
    }
    if let Ok(hub) = state.hub.lock() {
        hub.broadcast(json!({
            "event": "claim.released",
            "device_id": device_id,
            "message": MSG_WAITING_OPEN,
        }));
    }
    emit_online(&state, &id);
    Ok((
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "data": {
                "device_id": device_id,
                "claim_state": claim_state.as_str(),
            }
        })),
    ))
}

async fn peer_ports(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let store = state.inner.lock().map_err(|_| internal("store lock"))?;
    let id = classroom_from_headers(&store, &headers)
        .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
    let class = store
        .classrooms
        .get(&id)
        .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"ports": class.peer_candidates()}})),
    ))
}

async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let connection_id = hdr(&headers, "x-connection-id")
        .ok_or_else(|| bad_request("BAD_REQUEST", "缺少 X-Connection-Id"))?;
    if body.text.is_empty() {
        return Err(bad_request("BAD_REQUEST", "文字不能为空"));
    }
    let delivery = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = classroom_from_headers(&store, &headers)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class
            .send_chat(&connection_id, &body.to_ip, &body.text)
            .map_err(comm_err)?
    };
    let payload = json!({
        "from_ip": delivery.from_ip,
        "to_ip": delivery.to_ip,
        "text": delivery.text,
    });
    if let Ok(hub) = state.hub.lock() {
        hub.send(
            &delivery.from_connection_id,
            WsOut::Event(json!({"event": "chat.sent", "from_ip": delivery.from_ip, "to_ip": delivery.to_ip, "text": delivery.text})),
        );
        if let Some(to) = delivery.to_connection_id.as_deref() {
            hub.send(
                to,
                WsOut::Event(json!({"event": "chat.received", "from_ip": delivery.from_ip, "to_ip": delivery.to_ip, "text": delivery.text})),
            );
        }
    }
    Ok((StatusCode::OK, Json(json!({"ok": true, "data": payload}))))
}

async fn ping(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PingRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let connection_id = hdr(&headers, "x-connection-id")
        .ok_or_else(|| bad_request("BAD_REQUEST", "缺少 X-Connection-Id"))?;
    let detail = {
        let store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = classroom_from_headers(&store, &headers)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let class = store
            .classrooms
            .get(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class.ping(&connection_id, &body.to_ip).map_err(comm_err)?
    };
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"reachable": true, "detail": detail}})),
    ))
}

async fn set_mode(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<ModeRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if hdr(&headers, "x-client-kind").as_deref() != Some("teacher") {
        return Err(conflict("NOT_OWNER", "仅教师可切换模式"));
    }
    {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class.set_mode(body.mode);
    }
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::update_mode(&db, &id, body.mode).map_err(|e| internal(&e.to_string()))?;
    }
    let event = json!({"event": "mode.changed", "mode": body.mode.as_str()});
    if let Ok(hub) = state.hub.lock() {
        hub.broadcast(event);
    }
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"mode": body.mode.as_str()}})),
    ))
}

async fn sim_send(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SimSendRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let connection_id = hdr(&headers, "x-connection-id")
        .ok_or_else(|| bad_request("BAD_REQUEST", "缺少 X-Connection-Id"))?;
    let (frame, events) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = classroom_from_headers(&store, &headers)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class
            .sim_send(&connection_id, &body.to_ip, &body.text)
            .map_err(sim_err)?
    };
    emit_sim(&state, events);
    Ok((StatusCode::OK, Json(json!({"ok": true, "data": {"frame": frame}}))))
}

async fn forward_frame(
    State(state): State<AppState>,
    AxumPath(frame_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<ForwardRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let connection_id = hdr(&headers, "x-connection-id")
        .ok_or_else(|| bad_request("BAD_REQUEST", "缺少 X-Connection-Id"))?;
    let (frame, events) = {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        let id = classroom_from_headers(&store, &headers)
            .ok_or_else(|| not_found("NO_CLASSROOM", "当前没有课堂"))?;
        let class = store
            .classrooms
            .get_mut(&id)
            .ok_or_else(|| not_found("NO_CLASSROOM", "课堂不存在"))?;
        class
            .forward(&connection_id, &frame_id, &body.out_port_id)
            .map_err(sim_err)?
    };
    emit_sim(&state, events);
    Ok((StatusCode::OK, Json(json!({"ok": true, "data": {"frame": frame}}))))
}

fn emit_sim(state: &AppState, events: Vec<SimPush>) {
    if let Ok(hub) = state.hub.lock() {
        for e in events {
            hub.send(&e.connection_id, WsOut::Event(e.event));
        }
    }
}

fn persist_join(
    state: &AppState,
    classroom_id: &str,
    outcome: &JoinOutcome,
) -> Result<(), (StatusCode, Json<Value>)> {
    match outcome {
        JoinOutcome::WaitingOpen { .. } => return Ok(()),
        JoinOutcome::Full => {
            let db = state.db.lock().map_err(|_| internal("db lock"))?;
            db::update_claim_state(&db, classroom_id, papernet_shared::ClaimState::Full)
                .map_err(|e| internal(&e.to_string()))?;
            return Ok(());
        }
        JoinOutcome::Claimed { connection_id, .. } => {
            let db = state.db.lock().map_err(|_| internal("db lock"))?;
            let store = state.inner.lock().map_err(|_| internal("store lock"))?;
            let Some(class) = store.classrooms.get(classroom_id) else {
                return Ok(());
            };
            db::update_claim_state(&db, classroom_id, class.claim_state)
                .map_err(|e| internal(&e.to_string()))?;
            if let Some(device) = class
                .connections
                .get(connection_id)
                .and_then(|c| c.device_id.as_ref())
                .and_then(|did| class.devices.get(did))
            {
                db::update_device_claim(&db, classroom_id, device)
                    .map_err(|e| internal(&e.to_string()))?;
            }
            Ok(())
        }
    }
}

fn emit_online(state: &AppState, classroom_id: &str) {
    let count = {
        let Ok(store) = state.inner.lock() else {
            return;
        };
        match store.classrooms.get(classroom_id) {
            Some(c) => c.connections.len(),
            None => return,
        }
    };
    if let Ok(hub) = state.hub.lock() {
        hub.broadcast(json!({"event": "classroom.online", "count": count}));
    }
}

fn tap_attach_json(state: &AppState, classroom_id: &str) -> Value {
    let Ok(store) = state.inner.lock() else {
        return json!([]);
    };
    match store.classrooms.get(classroom_id) {
        Some(class) => json!(class
            .tap_attaches
            .iter()
            .map(|(tap_id, link_id)| json!({"tap_id": tap_id, "link_id": link_id}))
            .collect::<Vec<_>>()),
        None => json!([]),
    }
}

fn current_classroom_id(store: &Store) -> Option<String> {
    store
        .classrooms
        .values()
        .max_by_key(|c| c.created_at)
        .map(|c| c.classroom_id.clone())
}

impl Hub {
    fn send(&self, connection_id: &str, msg: WsOut) {
        if let Some(tx) = self.txs.get(connection_id) {
            let _ = tx.send(msg);
        }
    }
}

impl Hub {
    fn broadcast(&self, event: Value) {
        for tx in self.txs.values() {
            let _ = tx.send(WsOut::Event(event.clone()));
        }
    }
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    classroom_id: Option<String>,
    connection_id: Option<String>,
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, q, state))
}

async fn handle_socket(mut socket: WebSocket, q: WsQuery, state: AppState) {
    let mode = {
        let store = match state.inner.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        match q.classroom_id.as_deref() {
            Some(id) => store
                .classrooms
                .get(id)
                .map(|c| c.mode)
                .unwrap_or(Mode::Normal),
            None => Mode::Normal,
        }
    };
    let (tx, mut rx) = mpsc::unbounded_channel();
    if let Some(conn_id) = q.connection_id.clone() {
        if let Ok(mut hub) = state.hub.lock() {
            hub.txs.insert(conn_id, tx);
        }
    }
    let hello = json!({
        "event": "hello",
        "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "mode": mode.as_str(),
        "tap_attach": q
            .classroom_id
            .as_deref()
            .map(|id| tap_attach_json(&state, id))
            .unwrap_or_else(|| json!([])),
    });
    if socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        unregister(&state, q.connection_id.as_deref());
        return;
    }
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            if v.get("event").and_then(|e| e.as_str()) == Some("heartbeat") {
                                if let Some(conn_id) = q.connection_id.as_deref() {
                                    if let Ok(mut store) = state.inner.lock() {
                                        let cid = q
                                            .classroom_id
                                            .clone()
                                            .or_else(|| current_classroom_id(&store));
                                        if let Some(cid) = cid {
                                            if let Some(class) = store.classrooms.get_mut(&cid) {
                                                class.touch(conn_id);
                                            }
                                        }
                                    }
                                }
                                continue;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            out = rx.recv() => {
                match out {
                    Some(WsOut::Event(v)) => {
                        if socket.send(Message::Text(v.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Some(WsOut::Close) | None => break,
                    }
            }
        }
    }
    unregister(&state, q.connection_id.as_deref());
}

fn unregister(state: &AppState, connection_id: Option<&str>) {
    if let Some(id) = connection_id {
        if let Ok(mut hub) = state.hub.lock() {
            hub.txs.remove(id);
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn internal(msg: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"ok": false, "error": {"code": "INTERNAL", "message": msg}})),
    )
}

fn not_found(code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"ok": false, "error": {"code": code, "message": message}})),
    )
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"ok": false, "error": {"code": code, "message": message}})),
    )
}

fn conflict(code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::CONFLICT,
        Json(json!({"ok": false, "error": {"code": code, "message": message}})),
    )
}

fn hdr(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn classroom_from_headers(store: &Store, headers: &HeaderMap) -> Option<String> {
    if let Some(id) = hdr(headers, "x-classroom-id") {
        if store.classrooms.contains_key(&id) {
            return Some(id);
        }
    }
    current_classroom_id(store)
}

fn persist_topology(
    state: &AppState,
    classroom_id: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let db = state.db.lock().map_err(|_| internal("db lock"))?;
    let store = state.inner.lock().map_err(|_| internal("store lock"))?;
    let Some(class) = store.classrooms.get(classroom_id) else {
        return Ok(());
    };
    for device in class.devices.values() {
        for port in &device.ports {
            db::update_port(&db, classroom_id, port).map_err(|e| internal(&e.to_string()))?;
        }
    }
    db::replace_links(&db, classroom_id, &class.links).map_err(|e| internal(&e.to_string()))?;
    Ok(())
}

fn port_err(err: PortError) -> (StatusCode, Json<Value>) {
    match err {
        PortError::NotOwner => conflict("NOT_OWNER", "只能配置本角色端口"),
        PortError::MaskFixed => bad_request("MASK_FIXED", "子网掩码为 255.255.255.0"),
        PortError::BadIp => bad_request("BAD_IP", "IP 地址不正确"),
        PortError::UnknownDevice => not_found("NOT_FOUND", "设备不存在"),
        PortError::UnknownPort => not_found("NOT_FOUND", "端口不存在"),
        PortError::UnknownPeer => bad_request("BAD_REQUEST", "对端端口不存在"),
        PortError::PortBusy => conflict("PORT_BUSY", "端口已被占用"),
    }
}

fn attach_err(err: AttachError) -> (StatusCode, Json<Value>) {
    match err {
        AttachError::UnknownTap => not_found("NOT_FOUND", "特殊双口不存在"),
        AttachError::NotTap => bad_request("BAD_REQUEST", "该设备不是特殊双口"),
        AttachError::UnknownPort => bad_request("BAD_REQUEST", "端口不存在"),
        AttachError::LinkNotUp => conflict("LINK_NOT_UP", "目标链路未物理连通"),
    }
}

fn unbind_err(err: UnbindError) -> (StatusCode, Json<Value>) {
    match err {
        UnbindError::UnknownDevice => not_found("NOT_FOUND", "设备不存在"),
        UnbindError::NotClaimed => conflict("NOT_CLAIMED", "该设备尚未绑定"),
    }
}

fn comm_err(err: CommError) -> (StatusCode, Json<Value>) {
    match err {
        CommError::NeedNormal => conflict("NEED_NORMAL", "当前是模拟模式"),
        CommError::NotPc => conflict("NOT_OWNER", "仅 PC 可发送文字"),
        CommError::NotPcOrRouter => conflict("NOT_OWNER", "仅 PC 与路由器可 ping"),
        CommError::Unreachable => conflict("UNREACHABLE", "目标不可达"),
        CommError::BadIp => bad_request("BAD_IP", "IP 地址不正确"),
        CommError::UnknownConn => not_found("NOT_FOUND", "连接不存在"),
    }
}

fn sim_err(err: SimError) -> (StatusCode, Json<Value>) {
    match err {
        SimError::NeedSim => conflict("NEED_SIM", "请先进入模拟模式"),
        SimError::NotPc => conflict("NOT_OWNER", "仅 PC 可组帧发送"),
        SimError::Unreachable => conflict("UNREACHABLE", "目标不可达"),
        SimError::BadIp => bad_request("BAD_IP", "IP 地址不正确"),
        SimError::UnknownConn | SimError::UnknownFrame => {
            not_found("NOT_FOUND", "对象不存在")
        }
        SimError::WrongPort => conflict("WRONG_PORT", "端口不正确"),
        SimError::NotHolder | SimError::NotForwarder => {
            conflict("NOT_OWNER", "只能转发本机上的帧")
        }
        SimError::FrameLimit => conflict("FRAME_LIMIT", "同时在途帧已达上限"),
    }
}
