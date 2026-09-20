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
    let state = AppState::open(&db).expect("open db");
    (state, dir)
}

async fn json_body(res: axum::response::Response) -> Value {
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    serde_json::from_slice(&bytes).expect("json")
}

#[tokio::test]
async fn health_returns_up() {
    let (state, _dir) = state();
    let res = app(state)
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json_body(res).await;
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["status"], "up");
}

#[tokio::test]
async fn create_classroom_returns_id_without_join_code() {
    let (state, dir) = state();
    let res = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "八年级1班",
                        "inventory": {
                            "routers": [{"id": "R1", "port_count": 2}],
                            "switches": [],
                            "pcs": [{"id": "PC1"}],
                            "taps": []
                        }
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json_body(res).await;
    assert_eq!(v["ok"], true);
    let id = v["data"]["classroom_id"].as_str().expect("classroom_id");
    assert!(id.starts_with("c-"));
    assert!(v["data"].get("join_code").is_none());
    assert!(v.get("join_code").is_none());

    let db_path = dir.path().join("papernet.sqlite");
    let conn = rusqlite::Connection::open(db_path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM classroom WHERE classroom_id = ?1", [id], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn ws_sends_hello_after_connect() {
    let (state, _dir) = state();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app(state)).await.unwrap();
    });

    let url = format!("ws://{addr}/ws?classroom_id=c-missing&connection_id=conn-1");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    let msg = ws.next().await.expect("frame").expect("ok");
    let text = msg.into_text().expect("text");
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["event"], "hello");
    assert_eq!(v["mode"], "normal");
    assert!(v["ts"].as_str().is_some());
}
