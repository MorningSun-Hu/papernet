use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::{DeviceKind, MASK_C};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkView {
    pub link_id: String,
    pub port_a: String,
    pub port_b: String,
    pub physically_up: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MacEntry {
    pub switch_id: String,
    pub port_id: String,
    pub mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArpEntry {
    pub device_id: String,
    pub ip: String,
    pub mac: String,
}

#[derive(Debug, Clone)]
pub struct PortRef {
    pub device_id: String,
    pub kind: DeviceKind,
    pub device_mac: Option<String>,
    pub port_id: String,
    pub ip: Option<String>,
    pub gateway: Option<String>,
    pub peer_port_id: Option<String>,
    pub port_mac: Option<String>,
}

impl PortRef {
    pub fn comm_mac(&self) -> Option<String> {
        match self.kind {
            DeviceKind::Pc => self.device_mac.clone(),
            DeviceKind::Router => self.port_mac.clone(),
            DeviceKind::Switch | DeviceKind::Tap => None,
        }
    }
}

pub fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut out = [0u8; 4];
    for (i, p) in parts.iter().enumerate() {
        if p.is_empty() || p.len() > 3 {
            return None;
        }
        if p.len() > 1 && p.starts_with('0') {
            return None;
        }
        out[i] = p.parse().ok()?;
    }
    Some(out)
}

pub fn same_c_class(a: &str, b: &str) -> bool {
    match (parse_ipv4(a), parse_ipv4(b)) {
        (Some(x), Some(y)) => x[0] == y[0] && x[1] == y[1] && x[2] == y[2],
        _ => false,
    }
}

pub fn mask_is_fixed(mask: Option<&str>) -> bool {
    match mask {
        None => true,
        Some(m) => m == MASK_C,
    }
}

pub fn is_physically_up(
    a_id: &str,
    a_peer: Option<&str>,
    b_id: &str,
    b_peer: Option<&str>,
) -> bool {
    a_peer == Some(b_id) && b_peer == Some(a_id)
}

pub fn ordered_pair<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

pub fn link_id_for(a: &str, b: &str) -> String {
    let (a, b) = ordered_pair(a, b);
    format!("{a}--{b}")
}

pub fn rebuild_links(ports: &[PortRef]) -> Vec<LinkView> {
    let peers: HashMap<&str, Option<&str>> = ports
        .iter()
        .map(|p| (p.port_id.as_str(), p.peer_port_id.as_deref()))
        .collect();
    let mut pairs: HashSet<(String, String)> = HashSet::new();
    for p in ports {
        if let Some(peer) = p.peer_port_id.as_deref() {
            if peers.contains_key(peer) {
                let (a, b) = ordered_pair(&p.port_id, peer);
                pairs.insert((a.to_string(), b.to_string()));
            }
        }
    }
    let mut links: Vec<LinkView> = pairs
        .into_iter()
        .map(|(a, b)| {
            let a_peer = peers.get(a.as_str()).copied().flatten();
            let b_peer = peers.get(b.as_str()).copied().flatten();
            LinkView {
                link_id: link_id_for(&a, &b),
                physically_up: is_physically_up(&a, a_peer, &b, b_peer),
                port_a: a,
                port_b: b,
            }
        })
        .collect();
    links.sort_by(|x, y| x.link_id.cmp(&y.link_id));
    links
}

pub fn rebuild_mac_table(ports: &[PortRef], links: &[LinkView]) -> Vec<MacEntry> {
    let by_id: HashMap<&str, &PortRef> = ports.iter().map(|p| (p.port_id.as_str(), p)).collect();
    let up: HashSet<&str> = links
        .iter()
        .filter(|l| l.physically_up)
        .flat_map(|l| [l.link_id.as_str()])
        .collect();
    let _ = up;
    let mut out = Vec::new();
    for p in ports {
        if p.kind != DeviceKind::Switch {
            continue;
        }
        let Some(peer_id) = p.peer_port_id.as_deref() else {
            continue;
        };
        let Some(peer) = by_id.get(peer_id) else {
            continue;
        };
        if !is_physically_up(
            &p.port_id,
            p.peer_port_id.as_deref(),
            peer_id,
            peer.peer_port_id.as_deref(),
        ) {
            continue;
        }
        if let Some(mac) = peer.comm_mac() {
            out.push(MacEntry {
                switch_id: p.device_id.clone(),
                port_id: p.port_id.clone(),
                mac,
            });
        }
    }
    out.sort_by(|a, b| (&a.switch_id, &a.port_id).cmp(&(&b.switch_id, &b.port_id)));
    out
}

pub fn rebuild_arp_table(ports: &[PortRef], links: &[LinkView]) -> Vec<ArpEntry> {
    let mut out = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let up_ports = physically_up_ports(ports, links);

    for p in ports {
        if !matches!(p.kind, DeviceKind::Pc | DeviceKind::Router) {
            continue;
        }
        let Some(ip) = p.ip.as_deref() else {
            continue;
        };
        if !up_ports.contains(&p.port_id) {
            continue;
        }
        for other in ports {
            if other.port_id == p.port_id {
                continue;
            }
            let Some(oip) = other.ip.as_deref() else {
                continue;
            };
            if !same_c_class(ip, oip) {
                continue;
            }
            if let Some(mac) = other.comm_mac() {
                push_arp(&mut out, &mut seen, &p.device_id, oip, mac);
            }
        }
        if p.kind == DeviceKind::Pc {
            if let Some(gw) = p.gateway.as_deref() {
                if let Some(gw_port) = ports.iter().find(|x| x.ip.as_deref() == Some(gw)) {
                    if l2_reachable(&p.port_id, &gw_port.port_id, ports, links) {
                        if let Some(mac) = gw_port.comm_mac() {
                            push_arp(&mut out, &mut seen, &p.device_id, gw, mac);
                        }
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| (&a.device_id, &a.ip).cmp(&(&b.device_id, &b.ip)));
    out
}

fn push_arp(
    out: &mut Vec<ArpEntry>,
    seen: &mut HashSet<(String, String)>,
    device_id: &str,
    ip: &str,
    mac: String,
) {
    if seen.insert((device_id.to_string(), ip.to_string())) {
        out.push(ArpEntry {
            device_id: device_id.to_string(),
            ip: ip.to_string(),
            mac,
        });
    }
}

fn physically_up_ports(ports: &[PortRef], links: &[LinkView]) -> HashSet<String> {
    let mut set = HashSet::new();
    for l in links.iter().filter(|l| l.physically_up) {
        set.insert(l.port_a.clone());
        set.insert(l.port_b.clone());
    }
    let _ = ports;
    set
}

pub(crate) fn l2_reachable(from: &str, to: &str, ports: &[PortRef], links: &[LinkView]) -> bool {
    if from == to {
        return true;
    }
    let bridge_ports: HashMap<&str, Vec<&str>> = {
        let mut m: HashMap<&str, Vec<&str>> = HashMap::new();
        for p in ports {
            if matches!(p.kind, DeviceKind::Switch | DeviceKind::Tap) {
                m.entry(p.device_id.as_str())
                    .or_default()
                    .push(p.port_id.as_str());
            }
        }
        m
    };
    let port_dev: HashMap<&str, &PortRef> = ports.iter().map(|p| (p.port_id.as_str(), p)).collect();
    let mut q = VecDeque::from([from.to_string()]);
    let mut seen = HashSet::from([from.to_string()]);
    while let Some(cur) = q.pop_front() {
        for l in links.iter().filter(|l| l.physically_up) {
            let next = if l.port_a == cur {
                Some(l.port_b.as_str())
            } else if l.port_b == cur {
                Some(l.port_a.as_str())
            } else {
                None
            };
            if let Some(n) = next {
                if n == to {
                    return true;
                }
                if seen.insert(n.to_string()) {
                    q.push_back(n.to_string());
                }
            }
        }
        if let Some(p) = port_dev.get(cur.as_str()) {
            if matches!(p.kind, DeviceKind::Switch | DeviceKind::Tap) {
                if let Some(siblings) = bridge_ports.get(p.device_id.as_str()) {
                    for n in siblings {
                        if *n == to {
                            return true;
                        }
                        if seen.insert((*n).to_string()) {
                            q.push_back((*n).to_string());
                        }
                    }
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(
        device_id: &str,
        kind: DeviceKind,
        port_id: &str,
        ip: Option<&str>,
        peer: Option<&str>,
        mac: Option<&str>,
        gw: Option<&str>,
    ) -> PortRef {
        PortRef {
            device_id: device_id.into(),
            kind,
            device_mac: if kind == DeviceKind::Pc {
                mac.map(|s| s.into())
            } else {
                None
            },
            port_id: port_id.into(),
            ip: ip.map(|s| s.into()),
            gateway: gw.map(|s| s.into()),
            peer_port_id: peer.map(|s| s.into()),
            port_mac: if kind == DeviceKind::Router {
                mac.map(|s| s.into())
            } else {
                None
            },
        }
    }

    #[test]
    fn one_sided_peer_is_not_physically_up() {
        let ports = vec![
            port("PC1", DeviceKind::Pc, "PC1/01", None, Some("S1/01"), Some("aa:aa:aa:aa:aa:01"), None),
            port("S1", DeviceKind::Switch, "S1/01", None, None, None, None),
        ];
        let links = rebuild_links(&ports);
        assert_eq!(links.len(), 1);
        assert!(!links[0].physically_up);
        assert!(rebuild_mac_table(&ports, &links).is_empty());
    }

    #[test]
    fn mutual_peer_fills_switch_mac() {
        let ports = vec![
            port("PC1", DeviceKind::Pc, "PC1/01", None, Some("S1/01"), Some("aa:aa:aa:aa:aa:01"), None),
            port("S1", DeviceKind::Switch, "S1/01", None, Some("PC1/01"), None, None),
        ];
        let links = rebuild_links(&ports);
        assert!(links[0].physically_up);
        let mac = rebuild_mac_table(&ports, &links);
        assert_eq!(mac.len(), 1);
        assert_eq!(mac[0].switch_id, "S1");
        assert_eq!(mac[0].port_id, "S1/01");
        assert_eq!(mac[0].mac, "aa:aa:aa:aa:aa:01");
    }

    #[test]
    fn pc_gateway_arp_when_path_is_up() {
        let ports = vec![
            port(
                "PC1",
                DeviceKind::Pc,
                "PC1/01",
                Some("192.168.1.10"),
                Some("S1/01"),
                Some("aa:aa:aa:aa:aa:01"),
                Some("192.168.1.1"),
            ),
            port("S1", DeviceKind::Switch, "S1/01", None, Some("PC1/01"), None, None),
            port("S1", DeviceKind::Switch, "S1/02", None, Some("R1/01"), None, None),
            port(
                "R1",
                DeviceKind::Router,
                "R1/01",
                Some("192.168.1.1"),
                Some("S1/02"),
                Some("bb:bb:bb:bb:bb:01"),
                None,
            ),
        ];
        let links = rebuild_links(&ports);
        assert_eq!(links.iter().filter(|l| l.physically_up).count(), 2);
        let arp = rebuild_arp_table(&ports, &links);
        let pc = arp.iter().find(|e| e.device_id == "PC1" && e.ip == "192.168.1.1").unwrap();
        assert_eq!(pc.mac, "bb:bb:bb:bb:bb:01");
    }

    #[test]
    fn mask_rejects_non_c_class() {
        assert!(mask_is_fixed(None));
        assert!(mask_is_fixed(Some(MASK_C)));
        assert!(!mask_is_fixed(Some("255.255.0.0")));
    }

    #[test]
    fn physically_up_iff_mutual() {
        assert!(!is_physically_up("A", Some("B"), "B", None));
        assert!(is_physically_up("A", Some("B"), "B", Some("A")));
        assert!(!is_physically_up("A", Some("B"), "B", Some("C")));
    }
}
