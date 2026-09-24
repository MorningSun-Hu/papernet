use std::collections::{HashMap, VecDeque};

use papernet_shared::{
    frame_macs, is_reachable, is_unicast_mac, link_id_for, mask_is_fixed, materialize_inventory,
    new_frame_id, new_unicast_mac, parse_ipv4, rebuild_arp_table, rebuild_links, rebuild_mac_table,
    rewrite_router_macs, router_out_port, switch_out_port, ArpEntry, ClaimState, ClientKind,
    DeviceKind, Inventory, LinkView, MacEntry, MaterializedDevice, Mode, PortPatch, PortRef,
    SimFrame, MASK_C,
};
use serde_json::{json, Value};

pub const MAX_INFLIGHT_FRAMES: usize = 256;

pub struct Classroom {
    pub classroom_id: String,
    pub title: String,
    pub claim_state: ClaimState,
    pub mode: Mode,
    pub created_at: i64,
    #[allow(dead_code)]
    pub inventory: Inventory,
    pub devices: HashMap<String, Device>,
    pub connections: HashMap<String, Conn>,
    pub links: Vec<LinkView>,
    pub mac_table: Vec<MacEntry>,
    pub arp_table: Vec<ArpEntry>,
    pub tap_attaches: HashMap<String, String>,
    pub chat_log: VecDeque<ChatMsg>,
    pub frames: HashMap<String, SimFrame>,
    pub tap_log: VecDeque<TapLogEntry>,
}

#[derive(Clone)]
pub struct Device {
    pub id: String,
    pub kind: DeviceKind,
    pub mac: Option<String>,
    pub claimed_connection_id: Option<String>,
    pub ports: Vec<Port>,
}

#[derive(Clone)]
pub struct Port {
    pub id: String,
    pub ip: Option<String>,
    pub mask: String,
    pub gateway: Option<String>,
    pub peer_port_id: Option<String>,
    pub mac: Option<String>,
}

pub struct Conn {
    pub connection_id: String,
    pub client_kind: ClientKind,
    pub device_id: Option<String>,
    pub nic_mac: Option<String>,
    pub last_seen: i64,
}

pub enum JoinOutcome {
    WaitingOpen { connection_id: String },
    Claimed { connection_id: String, device: Value },
    Full,
}

pub enum OpenClaimEvent {
    Granted { connection_id: String, device: Value },
    Full { connection_id: String },
}

pub enum PortError {
    NotOwner,
    MaskFixed,
    BadIp,
    UnknownDevice,
    UnknownPort,
    UnknownPeer,
    PortBusy,
}

#[derive(Debug)]
pub enum AttachError {
    UnknownTap,
    NotTap,
    UnknownPort,
    LinkNotUp,
}

#[derive(Debug)]
pub enum UnbindError {
    UnknownDevice,
    NotClaimed,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct ChatMsg {
    pub from_ip: String,
    pub to_ip: String,
    pub text: String,
    pub delivered: bool,
}

#[derive(Debug)]
pub struct ChatDelivery {
    pub from_ip: String,
    pub to_ip: String,
    pub text: String,
    pub from_connection_id: String,
    pub to_connection_id: Option<String>,
}

#[derive(Debug)]
pub enum CommError {
    NeedNormal,
    NotPc,
    NotPcOrRouter,
    Unreachable,
    BadIp,
    UnknownConn,
}

#[derive(Debug, Clone)]
pub struct TapLogEntry {
    pub tap_id: String,
    pub frame: Value,
    pub at: i64,
}

#[derive(Debug, Clone)]
pub struct SimPush {
    pub connection_id: String,
    pub event: Value,
}

#[derive(Debug)]
pub enum SimError {
    NeedSim,
    NotPc,
    Unreachable,
    BadIp,
    UnknownConn,
    UnknownFrame,
    WrongPort,
    NotHolder,
    NotForwarder,
    FrameLimit,
}

impl Classroom {
    pub fn new(
        classroom_id: String,
        title: String,
        inventory: Inventory,
        created_at: i64,
    ) -> Self {
        let materialized = materialize_inventory(&inventory);
        let devices = materialized
            .into_iter()
            .map(|d| {
                let id = d.id.clone();
                (id, Device::from_materialized(d))
            })
            .collect();
        Self {
            classroom_id,
            title,
            claim_state: ClaimState::Draft,
            mode: Mode::Normal,
            created_at,
            inventory,
            devices,
            connections: HashMap::new(),
            links: Vec::new(),
            mac_table: Vec::new(),
            arp_table: Vec::new(),
            tap_attaches: HashMap::new(),
            chat_log: VecDeque::new(),
            frames: HashMap::new(),
            tap_log: VecDeque::new(),
        }
    }

    pub fn join(
        &mut self,
        client_kind: ClientKind,
        connection_id: Option<String>,
        nic_mac: Option<String>,
    ) -> Result<JoinOutcome, String> {
        if !client_kind.is_student() {
            return Err("client_kind must be a student".into());
        }
        if let Some(mac) = nic_mac.as_deref() {
            if !is_unicast_mac(mac) {
                return Err("nic_mac must be a unicast MAC".into());
            }
        }

        if let Some(id) = connection_id.as_deref() {
            if let Some(conn) = self.connections.get_mut(id) {
                if let Some(mac) = nic_mac.clone() {
                    conn.nic_mac = Some(mac);
                }
                conn.client_kind = client_kind;
                conn.last_seen = now_stamp();
                if let Some(device_id) = conn.device_id.clone() {
                    let device = self.device_snapshot(&device_id);
                    return Ok(JoinOutcome::Claimed {
                        connection_id: id.to_string(),
                        device,
                    });
                }
                return Ok(self.claim_or_wait(id.to_string()));
            }
        }

        let connection_id =
            papernet_shared::new_connection_id();
        self.connections.insert(
            connection_id.clone(),
            Conn {
                connection_id: connection_id.clone(),
                client_kind,
                device_id: None,
                nic_mac,
                last_seen: now_stamp(),
            },
        );
        Ok(self.claim_or_wait(connection_id))
    }

    fn claim_or_wait(&mut self, connection_id: String) -> JoinOutcome {
        match self.claim_state {
            ClaimState::Draft => JoinOutcome::WaitingOpen { connection_id },
            ClaimState::Open | ClaimState::Full => self.try_claim(connection_id),
        }
    }

    fn try_claim(&mut self, connection_id: String) -> JoinOutcome {
        if let Some(device_id) = self.pick_unclaimed() {
            self.bind_claim(&connection_id, &device_id);
            let device = self.device_snapshot(&device_id);
            JoinOutcome::Claimed {
                connection_id,
                device,
            }
        } else {
            self.connections.remove(&connection_id);
            self.claim_state = ClaimState::Full;
            JoinOutcome::Full
        }
    }

    fn pick_unclaimed(&self) -> Option<String> {
        let mut ids: Vec<String> = self
            .devices
            .values()
            .filter(|d| d.claimed_connection_id.is_none())
            .map(|d| d.id.clone())
            .collect();
        if ids.is_empty() {
            return None;
        }
        let idx = fastrand::usize(..ids.len());
        Some(ids.swap_remove(idx))
    }

    fn bind_claim(&mut self, connection_id: &str, device_id: &str) {
        let nic_mac = self
            .connections
            .get(connection_id)
            .and_then(|c| c.nic_mac.clone());
        let client_kind = self
            .connections
            .get(connection_id)
            .map(|c| c.client_kind)
            .unwrap_or(ClientKind::StudentHosted);
        if let Some(device) = self.devices.get_mut(device_id) {
            device.claimed_connection_id = Some(connection_id.to_string());
            if device.kind == DeviceKind::Pc {
                let mac = match (client_kind, nic_mac) {
                    (ClientKind::StudentStandalone, Some(mac)) => mac,
                    _ => new_unicast_mac(),
                };
                device.mac = Some(mac.clone());
                if let Some(port) = device.ports.first_mut() {
                    port.mac = Some(mac);
                }
            }
        }
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.device_id = Some(device_id.to_string());
        }
        if self
            .devices
            .values()
            .all(|d| d.claimed_connection_id.is_some())
        {
            self.claim_state = ClaimState::Full;
        }
        self.rebuild_tables();
    }

    pub fn open_claim(&mut self) -> Vec<OpenClaimEvent> {
        self.claim_state = ClaimState::Open;
        let mut waiters: Vec<String> = self
            .connections
            .values()
            .filter(|c| c.device_id.is_none())
            .map(|c| c.connection_id.clone())
            .collect();
        fastrand::shuffle(&mut waiters);
        let mut events = Vec::new();
        for conn_id in waiters {
            match self.try_claim(conn_id.clone()) {
                JoinOutcome::Claimed { connection_id, device } => {
                    events.push(OpenClaimEvent::Granted {
                        connection_id,
                        device,
                    });
                }
                JoinOutcome::Full => {
                    events.push(OpenClaimEvent::Full {
                        connection_id: conn_id,
                    });
                }
                JoinOutcome::WaitingOpen { .. } => {}
            }
        }
        if self
            .devices
            .values()
            .all(|d| d.claimed_connection_id.is_some())
        {
            self.claim_state = ClaimState::Full;
        }
        events
    }

    pub fn device_snapshot(&self, device_id: &str) -> Value {
        let device = match self.devices.get(device_id) {
            Some(d) => d,
            None => return json!({}),
        };
        json!({
            "id": device.id,
            "kind": device.kind.as_str(),
            "mac": device.mac,
            "ports": device.ports.iter().map(|p| json!({
                "id": p.id,
                "ip": p.ip,
                "mask": p.mask,
                "gateway": p.gateway,
                "peer_port_id": p.peer_port_id,
                "mac": p.mac,
            })).collect::<Vec<_>>(),
        })
    }

    pub fn configure_port(
        &mut self,
        connection_id: &str,
        device_id: &str,
        port_id: &str,
        patch: PortPatch,
    ) -> Result<Value, PortError> {
        let owned = self
            .connections
            .get(connection_id)
            .and_then(|c| c.device_id.as_deref())
            == Some(device_id);
        if !owned {
            return Err(PortError::NotOwner);
        }
        if !mask_is_fixed(patch.mask.as_deref()) {
            return Err(PortError::MaskFixed);
        }
        if let Some(ip) = patch.ip.as_deref() {
            if parse_ipv4(ip).is_none() {
                return Err(PortError::BadIp);
            }
        }
        if let Some(gw) = patch.gateway.as_deref() {
            if parse_ipv4(gw).is_none() {
                return Err(PortError::BadIp);
            }
        }
        if let Some(peer) = patch.peer_port_id.as_deref() {
            if !peer.is_empty() {
                if self.find_port(peer).is_none() {
                    return Err(PortError::UnknownPeer);
                }
                if self.port_is_busy(peer, port_id) {
                    return Err(PortError::PortBusy);
                }
            }
        }
        let kind = self
            .devices
            .get(device_id)
            .map(|d| d.kind)
            .ok_or(PortError::UnknownDevice)?;
        let port_json = {
            let port = self
                .devices
                .get_mut(device_id)
                .ok_or(PortError::UnknownDevice)?
                .ports
                .iter_mut()
                .find(|p| p.id == port_id)
                .ok_or(PortError::UnknownPort)?;
            if kind != DeviceKind::Switch {
                if let Some(ip) = patch.ip {
                    port.ip = Some(ip);
                }
            }
            if kind == DeviceKind::Pc {
                if let Some(gw) = patch.gateway {
                    port.gateway = Some(gw);
                }
            }
            if let Some(peer) = patch.peer_port_id {
                port.peer_port_id = if peer.is_empty() {
                    None
                } else {
                    Some(peer)
                };
            }
            port.mask = MASK_C.to_string();
            json!({
                "id": port.id,
                "ip": port.ip,
                "mask": port.mask,
                "gateway": port.gateway,
                "peer_port_id": port.peer_port_id,
                "mac": port.mac,
            })
        };
        self.rebuild_tables();
        Ok(json!({
            "ports": [port_json],
            "links": self.links,
            "mac_table": self.mac_table,
            "arp_table": self.arp_table,
        }))
    }

    pub fn attach_tap(
        &mut self,
        tap_id: &str,
        port_a: &str,
        port_b: &str,
    ) -> Result<Value, AttachError> {
        let kind = self
            .devices
            .get(tap_id)
            .map(|d| d.kind)
            .ok_or(AttachError::UnknownTap)?;
        if kind != DeviceKind::Tap {
            return Err(AttachError::NotTap);
        }
        if self.find_port(port_a).is_none() || self.find_port(port_b).is_none() {
            return Err(AttachError::UnknownPort);
        }
        self.rebuild_tables();
        let want = link_id_for(port_a, port_b);
        let link = self
            .links
            .iter()
            .find(|l| l.link_id == want)
            .ok_or(AttachError::LinkNotUp)?;
        if !link.physically_up {
            return Err(AttachError::LinkNotUp);
        }
        let link_id = link.link_id.clone();
        self.tap_attaches.insert(tap_id.to_string(), link_id.clone());
        Ok(json!({
            "tap_id": tap_id,
            "link_id": link_id,
            "port_a": port_a,
            "port_b": port_b,
        }))
    }

    pub fn unbind_device(&mut self, device_id: &str) -> Result<Option<String>, UnbindError> {
        let claimed = self
            .devices
            .get(device_id)
            .ok_or(UnbindError::UnknownDevice)?
            .claimed_connection_id
            .clone()
            .ok_or(UnbindError::NotClaimed)?;
        if let Some(device) = self.devices.get_mut(device_id) {
            device.claimed_connection_id = None;
        }
        if let Some(conn) = self.connections.get_mut(&claimed) {
            conn.device_id = None;
        }
        if self.devices.values().any(|d| d.claimed_connection_id.is_none())
            && self.claim_state == ClaimState::Full
        {
            self.claim_state = ClaimState::Open;
        }
        Ok(Some(claimed))
    }

    pub fn peer_candidates(&self) -> Vec<String> {
        let mut ids: Vec<String> = self
            .devices
            .values()
            .filter(|d| d.kind != DeviceKind::Tap)
            .flat_map(|d| d.ports.iter().map(|p| p.id.clone()))
            .collect();
        ids.sort();
        ids
    }

    pub fn snapshot(&self) -> Value {
        json!({
            "classroom_id": self.classroom_id,
            "mode": self.mode.as_str(),
            "claim_state": self.claim_state.as_str(),
            "online": self.connections.len(),
            "devices": self.devices.values().map(|d| json!({
                "id": d.id,
                "kind": d.kind.as_str(),
                "mac": d.mac,
                "claimed_connection_id": d.claimed_connection_id,
                "ports": d.ports.iter().map(|p| json!({
                    "id": p.id,
                    "ip": p.ip,
                    "mask": p.mask,
                    "gateway": p.gateway,
                    "peer_port_id": p.peer_port_id,
                    "mac": p.mac,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "links": self.links,
            "mac_table": self.mac_table,
            "arp_table": self.arp_table,
            "tap_attach": self.tap_attaches.iter().map(|(tap_id, link_id)| json!({
                "tap_id": tap_id,
                "link_id": link_id,
            })).collect::<Vec<_>>(),
            "frames": self.frames.values().map(frame_json).collect::<Vec<_>>(),
            "tap_log": self.tap_log.iter().map(|e| json!({
                "tap_id": e.tap_id,
                "frame": e.frame,
                "at": e.at,
            })).collect::<Vec<_>>(),
        })
    }

    pub fn send_chat(
        &mut self,
        connection_id: &str,
        to_ip: &str,
        text: &str,
    ) -> Result<ChatDelivery, CommError> {
        if self.mode != Mode::Normal {
            return Err(CommError::NeedNormal);
        }
        if parse_ipv4(to_ip).is_none() {
            return Err(CommError::BadIp);
        }
        let device_id = {
            let conn = self
                .connections
                .get(connection_id)
                .ok_or(CommError::UnknownConn)?;
            conn.device_id.clone().ok_or(CommError::NotPc)?
        };
        let kind = self
            .devices
            .get(&device_id)
            .map(|d| d.kind)
            .ok_or(CommError::UnknownConn)?;
        if kind != DeviceKind::Pc {
            return Err(CommError::NotPc);
        }
        let from_ip = self
            .devices
            .get(&device_id)
            .and_then(|d| d.ports.iter().find_map(|p| p.ip.clone()))
            .ok_or(CommError::Unreachable)?;
        let to_connection_id = match self.devices.values().find(|d| {
            d.kind == DeviceKind::Pc && d.ports.iter().any(|p| p.ip.as_deref() == Some(to_ip))
        }) {
            Some(d) => d.claimed_connection_id.clone(),
            None => {
                self.push_chat(&from_ip, to_ip, text, false);
                return Err(CommError::Unreachable);
            }
        };
        let refs = self.port_refs();
        if !is_reachable(&device_id, to_ip, &refs, &self.links) {
            self.push_chat(&from_ip, to_ip, text, false);
            return Err(CommError::Unreachable);
        }
        self.push_chat(&from_ip, to_ip, text, true);
        Ok(ChatDelivery {
            from_ip,
            to_ip: to_ip.to_string(),
            text: text.to_string(),
            from_connection_id: connection_id.to_string(),
            to_connection_id,
        })
    }

    pub fn ping(&self, connection_id: &str, to_ip: &str) -> Result<String, CommError> {
        if self.mode != Mode::Normal {
            return Err(CommError::NeedNormal);
        }
        if parse_ipv4(to_ip).is_none() {
            return Err(CommError::BadIp);
        }
        let conn = self
            .connections
            .get(connection_id)
            .ok_or(CommError::UnknownConn)?;
        let device_id = conn.device_id.clone().ok_or(CommError::NotPcOrRouter)?;
        let kind = self
            .devices
            .get(&device_id)
            .map(|d| d.kind)
            .ok_or(CommError::UnknownConn)?;
        if !matches!(kind, DeviceKind::Pc | DeviceKind::Router) {
            return Err(CommError::NotPcOrRouter);
        }
        let refs = self.port_refs();
        if !is_reachable(&device_id, to_ip, &refs, &self.links) {
            return Err(CommError::Unreachable);
        }
        Ok(format!("来自 {to_ip} 的虚拟响应"))
    }

    pub fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    pub fn touch(&mut self, connection_id: &str) {
        if let Some(conn) = self.connections.get_mut(connection_id) {
            conn.last_seen = now_stamp();
        }
    }

    pub fn sim_send(
        &mut self,
        connection_id: &str,
        to_ip: &str,
        text: &str,
    ) -> Result<(Value, Vec<SimPush>), SimError> {
        if self.mode != Mode::Simulation {
            return Err(SimError::NeedSim);
        }
        if parse_ipv4(to_ip).is_none() {
            return Err(SimError::BadIp);
        }
        if text.is_empty() {
            return Err(SimError::BadIp);
        }
        if self.inflight_count() >= MAX_INFLIGHT_FRAMES {
            return Err(SimError::FrameLimit);
        }
        let device_id = {
            let conn = self
                .connections
                .get(connection_id)
                .ok_or(SimError::UnknownConn)?;
            conn.device_id.clone().ok_or(SimError::NotPc)?
        };
        let kind = self
            .devices
            .get(&device_id)
            .map(|d| d.kind)
            .ok_or(SimError::UnknownConn)?;
        if kind != DeviceKind::Pc {
            return Err(SimError::NotPc);
        }
        let src_ip = self
            .devices
            .get(&device_id)
            .and_then(|d| d.ports.iter().find_map(|p| p.ip.clone()))
            .ok_or(SimError::Unreachable)?;
        let out_port_id = self
            .devices
            .get(&device_id)
            .and_then(|d| d.ports.first().map(|p| p.id.clone()))
            .ok_or(SimError::Unreachable)?;
        let refs = self.port_refs();
        if !is_reachable(&device_id, to_ip, &refs, &self.links) {
            return Err(SimError::Unreachable);
        }
        let (dst_mac, src_mac) =
            frame_macs(&device_id, to_ip, &refs, &self.arp_table).ok_or(SimError::Unreachable)?;
        let frame_id = new_frame_id();
        let frame = SimFrame {
            frame_id: frame_id.clone(),
            dst_mac,
            src_mac,
            src_ip,
            dst_ip: to_ip.to_string(),
            payload: text.to_string(),
            at_device_id: device_id.clone(),
            status: "inflight".into(),
        };
        self.frames.insert(frame_id.clone(), frame);
        let mut events = Vec::new();
        events.push(SimPush {
            connection_id: connection_id.to_string(),
            event: json!({
                "event": "frame.built",
                "frame": frame_json(self.frames.get(&frame_id).unwrap()),
            }),
        });
        self.deliver_out(&frame_id, &out_port_id, &mut events)?;
        let body = frame_json(self.frames.get(&frame_id).unwrap());
        Ok((body, events))
    }

    pub fn forward(
        &mut self,
        connection_id: &str,
        frame_id: &str,
        out_port_id: &str,
    ) -> Result<(Value, Vec<SimPush>), SimError> {
        if self.mode != Mode::Simulation {
            return Err(SimError::NeedSim);
        }
        let device_id = {
            let conn = self
                .connections
                .get(connection_id)
                .ok_or(SimError::UnknownConn)?;
            conn.device_id.clone().ok_or(SimError::NotHolder)?
        };
        let kind = self
            .devices
            .get(&device_id)
            .map(|d| d.kind)
            .ok_or(SimError::UnknownConn)?;
        if !matches!(kind, DeviceKind::Switch | DeviceKind::Router) {
            return Err(SimError::NotForwarder);
        }
        let at = self
            .frames
            .get(frame_id)
            .map(|f| f.at_device_id.clone())
            .ok_or(SimError::UnknownFrame)?;
        if at != device_id {
            return Err(SimError::NotHolder);
        }
        if self
            .devices
            .get(&device_id)
            .and_then(|d| d.ports.iter().find(|p| p.id == out_port_id))
            .is_none()
        {
            return Err(SimError::WrongPort);
        }
        let expected = match kind {
            DeviceKind::Switch => {
                let dst_mac = self.frames.get(frame_id).unwrap().dst_mac.clone();
                switch_out_port(&device_id, &dst_mac, &self.mac_table)
            }
            DeviceKind::Router => {
                let dst_ip = self.frames.get(frame_id).unwrap().dst_ip.clone();
                router_out_port(&device_id, &dst_ip, &self.port_refs())
            }
            _ => None,
        };
        if expected.as_deref() != Some(out_port_id) {
            return Err(SimError::WrongPort);
        }
        if kind == DeviceKind::Router {
            let refs = self.port_refs();
            let out = refs
                .iter()
                .find(|p| p.port_id == out_port_id)
                .cloned()
                .ok_or(SimError::WrongPort)?;
            if let Some(frame) = self.frames.get_mut(frame_id) {
                rewrite_router_macs(frame, &out, &refs);
            }
        }
        let mut events = Vec::new();
        events.push(SimPush {
            connection_id: connection_id.to_string(),
            event: json!({"event": "frame.departed", "frame_id": frame_id}),
        });
        self.deliver_out(frame_id, out_port_id, &mut events)?;
        let body = frame_json(self.frames.get(frame_id).unwrap());
        Ok((body, events))
    }

    fn deliver_out(
        &mut self,
        frame_id: &str,
        out_port_id: &str,
        events: &mut Vec<SimPush>,
    ) -> Result<(), SimError> {
        let peer = self
            .find_port(out_port_id)
            .and_then(|p| p.peer_port_id.clone())
            .ok_or(SimError::Unreachable)?;
        if let Some(tap_id) = self.tap_on_link(out_port_id, &peer) {
            if let Some(frame) = self.frames.get_mut(frame_id) {
                frame.at_device_id = tap_id.clone();
            }
            self.log_tap(&tap_id, frame_id, events);
        }
        let peer_dev = self.port_owner(&peer).ok_or(SimError::Unreachable)?;
        self.arrive_device(frame_id, &peer_dev, events);
        Ok(())
    }

    fn arrive_device(&mut self, frame_id: &str, device_id: &str, events: &mut Vec<SimPush>) {
        let dst_ip = self
            .frames
            .get(frame_id)
            .map(|f| f.dst_ip.clone())
            .unwrap_or_default();
        let is_dest_pc = self.devices.get(device_id).is_some_and(|d| {
            d.kind == DeviceKind::Pc && d.ports.iter().any(|p| p.ip.as_deref() == Some(dst_ip.as_str()))
        });
        if let Some(frame) = self.frames.get_mut(frame_id) {
            frame.at_device_id = device_id.to_string();
            if is_dest_pc {
                frame.status = "delivered".into();
            }
        }
        if let Some(conn) = self.conn_of(device_id) {
            let frame = frame_json(self.frames.get(frame_id).unwrap());
            events.push(SimPush {
                connection_id: conn,
                event: json!({
                    "event": "frame.arrived",
                    "frame": frame,
                    "at_device_id": device_id,
                }),
            });
        }
    }

    fn log_tap(&mut self, tap_id: &str, frame_id: &str, events: &mut Vec<SimPush>) {
        let copy = frame_json(self.frames.get(frame_id).unwrap());
        self.tap_log.push_back(TapLogEntry {
            tap_id: tap_id.to_string(),
            frame: copy.clone(),
            at: now_stamp(),
        });
        while self.tap_log.iter().filter(|e| e.tap_id == tap_id).count() > 500 {
            if let Some(i) = self.tap_log.iter().position(|e| e.tap_id == tap_id) {
                self.tap_log.remove(i);
            } else {
                break;
            }
        }
        if let Some(conn) = self.conn_of(tap_id) {
            events.push(SimPush {
                connection_id: conn,
                event: json!({"event": "frame.logged", "frame": copy}),
            });
        }
    }

    fn tap_on_link(&self, a: &str, b: &str) -> Option<String> {
        let want = link_id_for(a, b);
        self.tap_attaches
            .iter()
            .find(|(_, lid)| *lid == &want)
            .map(|(tap, _)| tap.clone())
    }

    fn port_owner(&self, port_id: &str) -> Option<String> {
        self.devices
            .values()
            .find(|d| d.ports.iter().any(|p| p.id == port_id))
            .map(|d| d.id.clone())
    }

    fn conn_of(&self, device_id: &str) -> Option<String> {
        self.devices
            .get(device_id)
            .and_then(|d| d.claimed_connection_id.clone())
    }

    fn push_chat(&mut self, from_ip: &str, to_ip: &str, text: &str, delivered: bool) {
        self.chat_log.push_back(ChatMsg {
            from_ip: from_ip.to_string(),
            to_ip: to_ip.to_string(),
            text: text.to_string(),
            delivered,
        });
        while self.chat_log.len() > 1000 {
            self.chat_log.pop_front();
        }
    }

    pub fn rebuild_tables(&mut self) {
        let refs = self.port_refs();
        self.links = rebuild_links(&refs);
        self.mac_table = rebuild_mac_table(&refs, &self.links);
        self.arp_table = rebuild_arp_table(&refs, &self.links);
    }

    fn inflight_count(&self) -> usize {
        self.frames
            .values()
            .filter(|f| f.status == "inflight")
            .count()
    }

    fn port_refs(&self) -> Vec<PortRef> {
        self.devices
            .values()
            .flat_map(|d| {
                d.ports.iter().map(|p| PortRef {
                    device_id: d.id.clone(),
                    kind: d.kind,
                    device_mac: d.mac.clone(),
                    port_id: p.id.clone(),
                    ip: p.ip.clone(),
                    gateway: p.gateway.clone(),
                    peer_port_id: p.peer_port_id.clone(),
                    port_mac: p.mac.clone(),
                })
            })
            .collect()
    }

    fn find_port(&self, port_id: &str) -> Option<&Port> {
        self.devices
            .values()
            .flat_map(|d| d.ports.iter())
            .find(|p| p.id == port_id)
    }
}

impl Classroom {
    fn port_is_busy(&self, target: &str, self_port: &str) -> bool {
        if let Some(port) = self.find_port(target) {
            if let Some(existing) = port.peer_port_id.as_deref() {
                if !existing.is_empty() && existing != self_port {
                    return true;
                }
            }
        }
        self.devices.values().any(|device| {
            device.ports.iter().any(|port| {
                port.id != self_port && port.peer_port_id.as_deref() == Some(target)
            })
        })
    }
}

fn frame_json(frame: &SimFrame) -> Value {
    json!({
        "frame_id": frame.frame_id,
        "dst_mac": frame.dst_mac,
        "src_mac": frame.src_mac,
        "src_ip": frame.src_ip,
        "dst_ip": frame.dst_ip,
        "payload": frame.payload,
        "at_device_id": frame.at_device_id,
        "status": frame.status,
    })
}

fn now_stamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Device {
    fn from_materialized(d: MaterializedDevice) -> Self {
        Self {
            id: d.id,
            kind: d.kind,
            mac: d.mac,
            claimed_connection_id: None,
            ports: d
                .ports
                .into_iter()
                .map(|p| Port {
                    id: p.id,
                    ip: p.ip,
                    mask: if p.mask.is_empty() {
                        MASK_C.to_string()
                    } else {
                        p.mask
                    },
                    gateway: p.gateway,
                    peer_port_id: p.peer_port_id,
                    mac: p.mac,
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use papernet_shared::PcSpec;

    #[test]
    fn chat_rejects_simulation_mode() {
        let inv = Inventory {
            pcs: vec![PcSpec { id: "PC1".into() }],
            ..Default::default()
        };
        let mut class = Classroom::new("c1".into(), "t".into(), inv, 0);
        class.mode = Mode::Simulation;
        class.claim_state = ClaimState::Open;
        let outcome = class
            .join(ClientKind::StudentHosted, None, None)
            .expect("join");
        let JoinOutcome::Claimed { connection_id, .. } = outcome else {
            panic!("expected claimed");
        };
        let err = class
            .send_chat(&connection_id, "192.168.1.2", "你好")
            .unwrap_err();
        assert!(matches!(err, CommError::NeedNormal));
    }

    fn dummy_frame(id: &str, status: &str) -> SimFrame {
        SimFrame {
            frame_id: id.to_string(),
            dst_mac: "aa:aa:aa:aa:aa:01".into(),
            src_mac: "aa:aa:aa:aa:aa:02".into(),
            src_ip: "192.168.1.10".into(),
            dst_ip: "192.168.1.11".into(),
            payload: "x".into(),
            at_device_id: "PC1".into(),
            status: status.into(),
        }
    }

    #[test]
    fn inflight_cap_rejects_257th() {
        let inv = Inventory {
            pcs: vec![PcSpec { id: "PC1".into() }],
            ..Default::default()
        };
        let mut class = Classroom::new("c1".into(), "t".into(), inv, 0);
        class.mode = Mode::Simulation;
        for i in 0..MAX_INFLIGHT_FRAMES {
            let id = format!("f-{i}");
            class.frames.insert(id.clone(), dummy_frame(&id, "inflight"));
        }
        let err = class
            .sim_send("missing", "192.168.1.2", "你好")
            .unwrap_err();
        assert!(matches!(err, SimError::FrameLimit));
    }

    #[test]
    fn delivered_frames_do_not_count_toward_inflight_cap() {
        let inv = Inventory {
            pcs: vec![PcSpec { id: "PC1".into() }],
            ..Default::default()
        };
        let mut class = Classroom::new("c1".into(), "t".into(), inv, 0);
        class.mode = Mode::Simulation;
        for i in 0..MAX_INFLIGHT_FRAMES {
            let id = format!("d-{i}");
            class.frames.insert(id.clone(), dummy_frame(&id, "delivered"));
        }
        let err = class
            .sim_send("missing", "192.168.1.2", "你好")
            .unwrap_err();
        assert!(matches!(err, SimError::UnknownConn));
    }

    #[test]
    fn unbind_clears_claim_and_reopens_full_classroom() {
        let inv = Inventory {
            pcs: vec![PcSpec { id: "PC1".into() }],
            ..Default::default()
        };
        let mut class = Classroom::new("c1".into(), "t".into(), inv, 0);
        class.claim_state = ClaimState::Open;
        let outcome = class
            .join(ClientKind::StudentHosted, None, None)
            .expect("join");
        let JoinOutcome::Claimed { connection_id, .. } = outcome else {
            panic!("expected claimed");
        };
        assert_eq!(class.claim_state, ClaimState::Full);
        let released = class.unbind_device("PC1").expect("unbind");
        assert_eq!(released.as_deref(), Some(connection_id.as_str()));
        assert!(class.devices["PC1"].claimed_connection_id.is_none());
        assert!(class.connections[&connection_id].device_id.is_none());
        assert_eq!(class.claim_state, ClaimState::Open);
        let again = class
            .join(ClientKind::StudentHosted, None, None)
            .expect("rejoin");
        assert!(matches!(again, JoinOutcome::Claimed { .. }));
    }

    fn set_peer(class: &mut Classroom, port_id: &str, peer: Option<&str>) {
        for device in class.devices.values_mut() {
            if let Some(port) = device.ports.iter_mut().find(|p| p.id == port_id) {
                port.peer_port_id = peer.map(str::to_string);
            }
        }
    }

    #[test]
    fn attach_tap_overwrites_previous_link() {
        use papernet_shared::{RouterSpec, SwitchSpec, TapSpec};
        let inv = Inventory {
            pcs: vec![PcSpec { id: "PC1".into() }],
            switches: vec![SwitchSpec {
                id: "S1".into(),
                port_count: 2,
            }],
            routers: vec![RouterSpec {
                id: "R1".into(),
                port_count: 2,
                ports: vec![],
            }],
            taps: vec![TapSpec { id: "TAP1".into() }],
        };
        let mut class = Classroom::new("c1".into(), "t".into(), inv, 0);
        set_peer(&mut class, "PC1/01", Some("S1/01"));
        set_peer(&mut class, "S1/01", Some("PC1/01"));
        set_peer(&mut class, "S1/02", Some("R1/01"));
        set_peer(&mut class, "R1/01", Some("S1/02"));
        class.rebuild_tables();
        class
            .attach_tap("TAP1", "PC1/01", "S1/01")
            .expect("first attach");
        class
            .attach_tap("TAP1", "S1/02", "R1/01")
            .expect("move attach");
        assert_eq!(
            class.tap_attaches.get("TAP1").cloned(),
            Some(link_id_for("S1/02", "R1/01"))
        );
    }
}
