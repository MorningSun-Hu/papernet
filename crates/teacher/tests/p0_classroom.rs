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

#[tokio::test]
async fn heartbeat_updates_last_seen() {
    let (state, _dir) = state();
    let res = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "心跳课",
                        "inventory": {
                            "routers": [],
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
    let created = json_body(res).await;
    let id = created["data"]["classroom_id"].as_str().unwrap().to_string();

    let join = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"client_kind": "student-hosted"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let joined = json_body(join).await;
    let conn_id = joined["data"]["connection_id"].as_str().unwrap().to_string();
    let t0 = state.last_seen(&conn_id).expect("last_seen after join");

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve)).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
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
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let t1 = state.last_seen(&conn_id).expect("last_seen after heartbeat");
    assert!(t1 > t0, "t1={t1} t0={t0}");
}

async fn create_one_pc(state: AppState) -> String {
    let res = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "结束课",
                        "inventory": {
                            "routers": [],
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
    v["data"]["classroom_id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn teacher_end_classroom_deletes_runtime_and_sqlite() {
    let (state, dir) = state();
    let id = create_one_pc(state.clone()).await;

    let ended = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/api/v1/classrooms/{id}/end"))
                .header("x-client-kind", "teacher")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ended.status(), StatusCode::OK);
    let body = json_body(ended).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["data"]["ended"], true);

    let snap = app(state.clone())
        .oneshot(
            Request::builder()
                .uri(&format!("/api/v1/classrooms/{id}/snapshot"))
                .header("x-client-kind", "teacher")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(snap.status(), StatusCode::NOT_FOUND);
    let snap_body = json_body(snap).await;
    assert_eq!(snap_body["error"]["code"], "NO_CLASSROOM");

    let join = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"client_kind": "student-hosted"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(join.status(), StatusCode::NOT_FOUND);

    let db_path = dir.path().join("papernet.sqlite");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM classroom WHERE classroom_id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);

    drop(state);
    let restored = AppState::open(&db_path).expect("reopen");
    let snap2 = app(restored)
        .oneshot(
            Request::builder()
                .uri(&format!("/api/v1/classrooms/{id}/snapshot"))
                .header("x-client-kind", "teacher")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(snap2.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn student_cannot_end_classroom() {
    let (state, _dir) = state();
    let id = create_one_pc(state.clone()).await;
    let res = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/api/v1/classrooms/{id}/end"))
                .header("x-client-kind", "student-hosted")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let v = json_body(res).await;
    assert_eq!(v["error"]["code"], "NOT_OWNER");
}

#[tokio::test]
async fn end_missing_classroom_is_404() {
    let (state, _dir) = state();
    let res = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms/c-missing/end")
                .header("x-client-kind", "teacher")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let v = json_body(res).await;
    assert_eq!(v["error"]["code"], "NO_CLASSROOM");
}

#[tokio::test]
async fn end_classroom_closes_student_ws() {
    let (state, _dir) = state();
    let id = create_one_pc(state.clone()).await;

    let join = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/classrooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"client_kind": "student-hosted"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let joined = json_body(join).await;
    let conn_id = joined["data"]["connection_id"].as_str().unwrap().to_string();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let serve = state.clone();
    tokio::spawn(async move {
        axum::serve(listener, app(serve)).await.unwrap();
    });

    let url = format!("ws://{addr}/ws?classroom_id={id}&connection_id={conn_id}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.expect("ws");
    let hello = ws.next().await.expect("hello").expect("ok");
    let hello_v: Value = serde_json::from_str(&hello.into_text().unwrap()).unwrap();
    assert_eq!(hello_v["event"], "hello");

    let ended = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/api/v1/classrooms/{id}/end"))
                .header("x-client-kind", "teacher")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ended.status(), StatusCode::OK);

    let close = ws.next().await;
    match close {
        None => {}
        Some(Ok(Message::Close(_))) => {}
        Some(Err(_)) => {}
        other => panic!("expected ws close, got {other:?}"),
    }
}
