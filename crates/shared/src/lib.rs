//! Shared models and classroom protocol for PaperNet.

mod topo;
mod reach;
mod frame;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use topo::{
    is_physically_up, link_id_for, mask_is_fixed, parse_ipv4, rebuild_arp_table, rebuild_links,
    rebuild_mac_table, same_c_class, ArpEntry, LinkView, MacEntry, PortRef,
};
pub use reach::is_reachable;
pub use frame::{
    frame_macs, rewrite_router_macs, router_out_port, switch_out_port, SimFrame,
};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

static ID_SEQ: AtomicU64 = AtomicU64::new(1);

/// Short classroom id, unique in-process and across restarts on the same clock.
pub fn new_classroom_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("c-{nanos:x}-{seq:x}")
}

pub fn new_connection_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("n-{nanos:x}-{seq:x}")
}

pub fn new_frame_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("f-{nanos:x}-{seq:x}")
}

pub const MASK_C: &str = "255.255.255.0";
pub const MSG_WAITING_OPEN: &str = "请等待教师确定本课设备";
pub const MSG_CLASSROOM_FULL: &str = "本课设备已领完，请看教师屏";

static MAC_SEQ: AtomicU64 = AtomicU64::new(1);

/// Locally administered unicast MAC, colon-separated lowercase hex.
pub fn new_unicast_mac() -> String {
    let n = MAC_SEQ.fetch_add(1, Ordering::Relaxed);
    format!(
        "02:00:{:02x}:{:02x}:{:02x}:{:02x}",
        (n >> 24) & 0xff,
        (n >> 16) & 0xff,
        (n >> 8) & 0xff,
        n & 0xff
    )
}

pub fn parse_mac(s: &str) -> Option<[u8; 6]> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 6 {
        return None;
    }
    let mut out = [0u8; 6];
    for (i, p) in parts.iter().enumerate() {
        if p.len() != 2 {
            return None;
        }
        out[i] = u8::from_str_radix(p, 16).ok()?;
    }
    Some(out)
}

pub fn is_unicast_mac(s: &str) -> bool {
    parse_mac(s).is_some_and(|b| b[0] & 1 == 0)
}

pub fn port_id(device_id: &str, index: u32) -> String {
    format!("{device_id}/{index:02}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimState {
    Draft,
    Open,
    Full,
}

impl ClaimState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Open => "open",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Normal,
    Simulation,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Simulation => "simulation",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    Router,
    Switch,
    Pc,
    Tap,
}

impl DeviceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Router => "router",
            Self::Switch => "switch",
            Self::Pc => "pc",
            Self::Tap => "tap",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientKind {
    #[serde(rename = "teacher")]
    Teacher,
    #[serde(rename = "student-standalone")]
    StudentStandalone,
    #[serde(rename = "student-hosted")]
    StudentHosted,
}

impl ClientKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Teacher => "teacher",
            Self::StudentStandalone => "student-standalone",
            Self::StudentHosted => "student-hosted",
        }
    }

    pub fn is_student(self) -> bool {
        matches!(self, Self::StudentStandalone | Self::StudentHosted)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Inventory {
    #[serde(default)]
    pub routers: Vec<RouterSpec>,
    #[serde(default)]
    pub switches: Vec<SwitchSpec>,
    #[serde(default)]
    pub pcs: Vec<PcSpec>,
    #[serde(default)]
    pub taps: Vec<TapSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterSpec {
    pub id: String,
    pub port_count: u32,
    #[serde(default)]
    pub ports: Vec<PortSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchSpec {
    pub id: String,
    pub port_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PcSpec {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapSpec {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortSpec {
    pub id: String,
    #[serde(default)]
    pub ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateClassroomRequest {
    pub title: String,
    #[serde(default)]
    pub inventory: Inventory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    pub client_kind: ClientKind,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub nic_mac: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortPatch {
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub peer_port_id: Option<String>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub mask: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapAttachRequest {
    pub link: TapAttachLink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapAttachLink {
    pub port_a: String,
    pub port_b: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub to_ip: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingRequest {
    pub to_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeRequest {
    pub mode: Mode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimSendRequest {
    pub to_ip: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRequest {
    pub out_port_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterializedPort {
    pub id: String,
    pub ip: Option<String>,
    pub mask: String,
    pub gateway: Option<String>,
    pub peer_port_id: Option<String>,
    pub mac: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterializedDevice {
    pub id: String,
    pub kind: DeviceKind,
    pub mac: Option<String>,
    pub ports: Vec<MaterializedPort>,
}

fn numbered_ports(device_id: &str, count: u32, with_mac: bool) -> Vec<MaterializedPort> {
    (1..=count)
        .map(|i| MaterializedPort {
            id: port_id(device_id, i),
            ip: None,
            mask: MASK_C.to_string(),
            gateway: None,
            peer_port_id: None,
            mac: if with_mac {
                Some(new_unicast_mac())
            } else {
                None
            },
        })
        .collect()
}

/// Expand teacher inventory into devices and ports (`R1/01`, `S3/01`).
pub fn materialize_inventory(inv: &Inventory) -> Vec<MaterializedDevice> {
    let mut out = Vec::new();
    for spec in &inv.routers {
        let count = spec.port_count.max(spec.ports.len() as u32);
        let mut ports = numbered_ports(&spec.id, count, true);
        for preset in &spec.ports {
            if let Some(port) = ports.iter_mut().find(|p| p.id == preset.id) {
                port.ip = preset.ip.clone();
            }
        }
        out.push(MaterializedDevice {
            id: spec.id.clone(),
            kind: DeviceKind::Router,
            mac: None,
            ports,
        });
    }
    for spec in &inv.switches {
        out.push(MaterializedDevice {
            id: spec.id.clone(),
            kind: DeviceKind::Switch,
            mac: None,
            ports: numbered_ports(&spec.id, spec.port_count, false),
        });
    }
    for spec in &inv.pcs {
        out.push(MaterializedDevice {
            id: spec.id.clone(),
            kind: DeviceKind::Pc,
            mac: None,
            ports: numbered_ports(&spec.id, 1, false),
        });
    }
    for spec in &inv.taps {
        out.push(MaterializedDevice {
            id: spec.id.clone(),
            kind: DeviceKind::Tap,
            mac: None,
            ports: numbered_ports(&spec.id, 2, false),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn classroom_ids_are_unique() {
        let ids: HashSet<_> = (0..64).map(|_| new_classroom_id()).collect();
        assert_eq!(ids.len(), 64);
        assert!(ids.iter().all(|id| id.starts_with("c-")));
    }

    #[test]
    fn port_ids_use_device_slash_two_digits() {
        assert_eq!(port_id("R1", 1), "R1/01");
        assert_eq!(port_id("S3", 1), "S3/01");
        assert_eq!(port_id("R1", 12), "R1/12");
    }

    #[test]
    fn materialize_writes_router_preset_ip() {
        let inv = Inventory {
            routers: vec![RouterSpec {
                id: "R1".into(),
                port_count: 2,
                ports: vec![PortSpec {
                    id: "R1/01".into(),
                    ip: Some("192.168.1.1".into()),
                }],
            }],
            ..Default::default()
        };
        let devices = materialize_inventory(&inv);
        assert_eq!(devices[0].ports[0].id, "R1/01");
        assert_eq!(devices[0].ports[0].ip.as_deref(), Some("192.168.1.1"));
        assert_eq!(devices[0].ports[1].id, "R1/02");
        assert!(devices[0].ports[0].mac.is_some());
    }

    #[test]
    fn generated_mac_is_unicast() {
        let mac = new_unicast_mac();
        assert!(is_unicast_mac(&mac));
        let b = parse_mac(&mac).unwrap();
        assert_eq!(b[0] & 1, 0);
        assert_eq!(b[0] & 2, 2);
    }
}
