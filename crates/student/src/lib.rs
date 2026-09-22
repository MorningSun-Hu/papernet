//! Standalone student: collect NIC MAC, join the classroom, keep WebSocket.

use std::fs;
use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use papernet_shared::{
    is_unicast_mac, ClientKind, JoinRequest, MSG_CLASSROOM_FULL, MSG_WAITING_OPEN,
};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
pub struct StudentConfig {
    pub teacher_base: String,
    pub nic_mac: Option<String>,
    pub connection_id: Option<String>,
}

impl StudentConfig {
    pub fn from_env() -> Self {
        Self {
            teacher_base: std::env::var("PAPERNET_TEACHER_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
            nic_mac: std::env::var("PAPERNET_NIC_MAC")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            connection_id: std::env::var("PAPERNET_CONNECTION_ID")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        }
    }
}

fn skip_iface(name: &str) -> bool {
    name == "lo"
        || name.starts_with("lo:")
        || name.starts_with("docker")
        || name.starts_with("veth")
        || name.starts_with("br-")
        || name.starts_with("virbr")
}

pub fn collect_nic_mac_from(sys_class_net: &Path) -> Result<String, String> {
    let mut ents: Vec<_> = fs::read_dir(sys_class_net)
        .map_err(|e| format!("读取网卡目录失败: {e}"))?
        .filter_map(|e| e.ok())
        .collect();
    ents.sort_by_key(|e| e.file_name());
    for ent in ents {
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if skip_iface(&name) {
            continue;
        }
        let raw = match fs::read_to_string(ent.path().join("address")) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mac = raw.trim().to_lowercase();
        if mac == "00:00:00:00:00:00" {
            continue;
        }
        if is_unicast_mac(&mac) {
            return Ok(mac);
        }
    }
    Err("未找到本机单播网卡 MAC，可用 PAPERNET_NIC_MAC 指定".into())
}

pub fn collect_nic_mac() -> Result<String, String> {
    collect_nic_mac_from(Path::new("/sys/class/net"))
}

pub fn resolve_mac(override_mac: Option<&str>) -> Result<String, String> {
    if let Some(m) = override_mac {
        let mac = m.trim().to_lowercase();
        if is_unicast_mac(&mac) && mac != "00:00:00:00:00:00" {
            return Ok(mac);
        }
        return Err("nic_mac 不是单播 MAC".into());
    }
    collect_nic_mac()
}

#[derive(Debug, Clone)]
pub struct JoinResult {
    pub ok: bool,
    pub status: String,
    pub connection_id: Option<String>,
    pub device: Option<Value>,
    pub message: Option<String>,
}

pub async fn join_classroom(cfg: &StudentConfig, mac: &str) -> Result<JoinResult, String> {
    let base = cfg.teacher_base.trim_end_matches('/');
    let url = format!("{base}/api/v1/classrooms/join");
    let body = JoinRequest {
        client_kind: ClientKind::StudentStandalone,
        connection_id: cfg.connection_id.clone(),
        nic_mac: Some(mac.to_string()),
    };
    let res = reqwest::Client::new()
        .post(&url)
        .header("X-Client-Kind", ClientKind::StudentStandalone.as_str())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("join 请求失败: {e}"))?;
    let v: Value = res
        .json()
        .await
        .map_err(|e| format!("join 响应不是 JSON: {e}"))?;
    if v["ok"].as_bool() != Some(true) {
        return Ok(JoinResult {
            ok: false,
            status: v["data"]["status"].as_str().unwrap_or("full").to_string(),
            connection_id: None,
            device: None,
            message: v["error"]["message"].as_str().map(str::to_string),
        });
    }
    let data = &v["data"];
    Ok(JoinResult {
        ok: true,
        status: data["status"].as_str().unwrap_or("").to_string(),
        connection_id: data["connection_id"].as_str().map(str::to_string),
        device: data.get("device").cloned().filter(|d| !d.is_null()),
        message: data["message"].as_str().map(str::to_string),
    })
}

pub fn ws_url(http_base: &str, classroom_id: Option<&str>, connection_id: &str) -> String {
    let base = http_base.trim_end_matches('/');
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{base}")
    };
    match classroom_id {
        Some(cid) if !cid.is_empty() => {
            format!("{ws}/ws?classroom_id={cid}&connection_id={connection_id}")
        }
        _ => format!("{ws}/ws?connection_id={connection_id}"),
    }
}

pub async fn maintain_ws(url: &str, interval: Duration) -> Result<(), String> {
    drive_ws(url, interval, None).await.map(|_| ())
}

pub async fn maintain_ws_timed(
    url: &str,
    interval: Duration,
    run_for: Duration,
) -> Result<Vec<Value>, String> {
    drive_ws(url, interval, Some(run_for)).await
}

async fn drive_ws(
    url: &str,
    interval: Duration,
    run_for: Option<Duration>,
) -> Result<Vec<Value>, String> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .map_err(|e| format!("ws 连接失败: {e}"))?;
    let mut events = Vec::new();
    let mut tick = tokio::time::interval(interval);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let deadline = async {
        match run_for {
            Some(d) => tokio::time::sleep(d).await,
            None => std::future::pending::<()>().await,
        }
    };
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => {
                let _ = ws.close(None).await;
                return Ok(events);
            }
            incoming = ws.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&text) {
                            let is_full = v.get("event").and_then(|e| e.as_str()) == Some("claim.full");
                            events.push(v);
                            if is_full {
                                return Ok(events);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(events),
                    Some(Err(e)) => return Err(format!("ws: {e}")),
                    _ => {}
                }
            }
            _ = tick.tick() => {
                ws.send(Message::Text(
                    json!({"event": "heartbeat"}).to_string().into(),
                ))
                .await
                .map_err(|e| format!("heartbeat: {e}"))?;
            }
        }
    }
}

pub async fn run() -> Result<(), String> {
    let cfg = StudentConfig::from_env();
    let mac = resolve_mac(cfg.nic_mac.as_deref())?;
    eprintln!(
        "papernet-student {} nic_mac={mac}",
        papernet_shared::version()
    );
    let joined = join_classroom(&cfg, &mac).await?;
    match joined.status.as_str() {
        "full" => {
            eprintln!(
                "{}",
                joined.message.as_deref().unwrap_or(MSG_CLASSROOM_FULL)
            );
            return Ok(());
        }
        "waiting_open" => {
            eprintln!(
                "{}",
                joined.message.as_deref().unwrap_or(MSG_WAITING_OPEN)
            );
        }
        "claimed" => {
            let id = joined
                .device
                .as_ref()
                .and_then(|d| d["id"].as_str())
                .unwrap_or("?");
            eprintln!("claimed device={id}");
        }
        other => eprintln!("join status={other}"),
    }
    let conn = joined
        .connection_id
        .ok_or_else(|| "join 未返回 connection_id".to_string())?;
    let url = ws_url(&cfg.teacher_base, None, &conn);
    maintain_ws(&url, HEARTBEAT_INTERVAL).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn collect_skips_lo_and_zero() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("lo")).unwrap();
        fs::write(dir.path().join("lo/address"), "00:00:00:00:00:00\n").unwrap();
        fs::create_dir(dir.path().join("eth0")).unwrap();
        fs::write(dir.path().join("eth0/address"), "aa:bb:cc:dd:ee:10\n").unwrap();
        assert_eq!(
            collect_nic_mac_from(dir.path()).unwrap(),
            "aa:bb:cc:dd:ee:10"
        );
    }

    #[test]
    fn resolve_mac_rejects_multicast() {
        assert!(resolve_mac(Some("01:00:00:00:00:01")).is_err());
    }

    #[test]
    fn ws_url_maps_http() {
        assert_eq!(
            ws_url("http://127.0.0.1:8080", Some("c-1"), "n-1"),
            "ws://127.0.0.1:8080/ws?classroom_id=c-1&connection_id=n-1"
        );
    }
}
