//! Shared models and classroom protocol for PaperNet.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

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
}
