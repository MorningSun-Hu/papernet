//! Teacher server: HTTP API, WebSocket, classroom snapshot.

mod db;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use papernet_shared::{
    new_classroom_id, ClaimState, CreateClassroomRequest, Inventory, Mode,
};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<Store>>,
    db: Arc<Mutex<Connection>>,
}

struct Store {
    classrooms: HashMap<String, Classroom>,
}

#[allow(dead_code)]
struct Classroom {
    classroom_id: String,
    title: String,
    claim_state: ClaimState,
    mode: Mode,
    created_at: i64,
    inventory: Inventory,
}

impl AppState {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = db::open(db_path)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(Store {
                classrooms: HashMap::new(),
            })),
            db: Arc::new(Mutex::new(conn)),
        })
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/classrooms", post(create_classroom))
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
    {
        let db = state.db.lock().map_err(|_| internal("db lock"))?;
        db::insert_classroom(
            &db,
            &classroom_id,
            &body.title,
            ClaimState::Draft,
            Mode::Normal.as_str(),
            created_at,
        )
        .map_err(|e| internal(&e.to_string()))?;
    }
    {
        let mut store = state.inner.lock().map_err(|_| internal("store lock"))?;
        store.classrooms.insert(
            classroom_id.clone(),
            Classroom {
                classroom_id: classroom_id.clone(),
                title: body.title,
                claim_state: ClaimState::Draft,
                mode: Mode::Normal,
                created_at,
                inventory: body.inventory,
            },
        );
    }
    Ok((
        StatusCode::OK,
        Json(json!({"ok": true, "data": {"classroom_id": classroom_id}})),
    ))
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
    let _ = q.connection_id;
    let hello = json!({
        "event": "hello",
        "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "mode": mode.as_str(),
    });
    if socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if v.get("event").and_then(|e| e.as_str()) == Some("heartbeat") {
                        continue;
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
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
