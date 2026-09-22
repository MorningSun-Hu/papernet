use serde::{Deserialize, Serialize};

use crate::topo::{same_c_class, ArpEntry, MacEntry, PortRef};
use crate::DeviceKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SimFrame {
    pub frame_id: String,
    pub dst_mac: String,
    pub src_mac: String,
    pub src_ip: String,
    pub dst_ip: String,
    pub payload: String,
    pub at_device_id: String,
    pub status: String,
}

/// Fill (dst_mac, src_mac) for a PC sending to dst_ip.
/// Same C-class uses dest MAC; cross-segment uses gateway MAC.
pub fn frame_macs(
    src_device_id: &str,
    dst_ip: &str,
    ports: &[PortRef],
    arp: &[ArpEntry],
) -> Option<(String, String)> {
    let src = ports
        .iter()
        .find(|p| p.device_id == src_device_id && p.kind == DeviceKind::Pc)?;
    let src_mac = src.comm_mac()?;
    let src_ip = src.ip.as_deref()?;
    let dst_mac = if same_c_class(src_ip, dst_ip) {
        mac_for(src_device_id, dst_ip, ports, arp)
    } else {
        let gw = src.gateway.as_deref()?;
        mac_for(src_device_id, gw, ports, arp)
    }?;
    Some((dst_mac, src_mac))
}

fn mac_for(
    device_id: &str,
    ip: &str,
    ports: &[PortRef],
    arp: &[ArpEntry],
) -> Option<String> {
    if let Some(e) = arp
        .iter()
        .find(|e| e.device_id == device_id && e.ip == ip)
    {
        return Some(e.mac.clone());
    }
    ports
        .iter()
        .find(|p| p.ip.as_deref() == Some(ip))
        .and_then(|p| p.comm_mac())
}

pub fn switch_out_port(switch_id: &str, dst_mac: &str, table: &[MacEntry]) -> Option<String> {
    table
        .iter()
        .find(|e| e.switch_id == switch_id && e.mac == dst_mac)
        .map(|e| e.port_id.clone())
}

pub fn router_out_port(router_id: &str, dst_ip: &str, ports: &[PortRef]) -> Option<String> {
    ports
        .iter()
        .find(|p| {
            p.device_id == router_id
                && p.kind == DeviceKind::Router
                && p.ip
                    .as_deref()
                    .is_some_and(|ip| same_c_class(ip, dst_ip))
        })
        .map(|p| p.port_id.clone())
}

/// After a router forwards out `out_port`, rewrite L2 addresses.
/// dst_mac becomes the dest-IP host MAC; src_mac becomes the egress port MAC.
pub fn rewrite_router_macs(frame: &mut SimFrame, out_port: &PortRef, ports: &[PortRef]) {
    if let Some(mac) = out_port.port_mac.clone() {
        frame.src_mac = mac;
    }
    if let Some(mac) = ports
        .iter()
        .find(|p| p.ip.as_deref() == Some(frame.dst_ip.as_str()))
        .and_then(|p| p.comm_mac())
    {
        frame.dst_mac = mac;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topo::{rebuild_arp_table, rebuild_links};
    use crate::DeviceKind;

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

    fn scene() -> (Vec<PortRef>, Vec<ArpEntry>, Vec<MacEntry>) {
        let ports = vec![
            port(
                "PCA",
                DeviceKind::Pc,
                "PCA/01",
                Some("192.168.1.10"),
                Some("S1/01"),
                Some("aa:aa:aa:aa:aa:0a"),
                Some("192.168.1.1"),
            ),
            port("S1", DeviceKind::Switch, "S1/01", None, Some("PCA/01"), None, None),
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
            port(
                "R1",
                DeviceKind::Router,
                "R1/02",
                Some("192.168.2.1"),
                Some("S2/01"),
                Some("bb:bb:bb:bb:bb:02"),
                None,
            ),
            port("S2", DeviceKind::Switch, "S2/01", None, Some("R1/02"), None, None),
            port("S2", DeviceKind::Switch, "S2/02", None, Some("PCB/01"), None, None),
            port(
                "PCB",
                DeviceKind::Pc,
                "PCB/01",
                Some("192.168.2.10"),
                Some("S2/02"),
                Some("cc:cc:cc:cc:cc:0b"),
                Some("192.168.2.1"),
            ),
        ];
        let links = rebuild_links(&ports);
        let arp = rebuild_arp_table(&ports, &links);
        let mac = crate::topo::rebuild_mac_table(&ports, &links);
        (ports, arp, mac)
    }

    #[test]
    fn cross_segment_uses_gateway_mac() {
        let (ports, arp, _) = scene();
        let (dst, src) = frame_macs("PCA", "192.168.2.10", &ports, &arp).unwrap();
        assert_eq!(src, "aa:aa:aa:aa:aa:0a");
        assert_eq!(dst, "bb:bb:bb:bb:bb:01");
    }

    #[test]
    fn same_segment_uses_dest_mac() {
        let ports = vec![
            port(
                "PC1",
                DeviceKind::Pc,
                "PC1/01",
                Some("192.168.1.10"),
                Some("S1/01"),
                Some("aa:aa:aa:aa:aa:01"),
                None,
            ),
            port("S1", DeviceKind::Switch, "S1/01", None, Some("PC1/01"), None, None),
            port("S1", DeviceKind::Switch, "S1/02", None, Some("PC2/01"), None, None),
            port(
                "PC2",
                DeviceKind::Pc,
                "PC2/01",
                Some("192.168.1.11"),
                Some("S1/02"),
                Some("aa:aa:aa:aa:aa:02"),
                None,
            ),
        ];
        let links = rebuild_links(&ports);
        let arp = rebuild_arp_table(&ports, &links);
        let (dst, src) = frame_macs("PC1", "192.168.1.11", &ports, &arp).unwrap();
        assert_eq!(src, "aa:aa:aa:aa:aa:01");
        assert_eq!(dst, "aa:aa:aa:aa:aa:02");
    }

    #[test]
    fn switch_picks_mac_table_port() {
        let (_, _, mac) = scene();
        assert_eq!(
            switch_out_port("S1", "bb:bb:bb:bb:bb:01", &mac).as_deref(),
            Some("S1/02")
        );
        assert_eq!(switch_out_port("S1", "ff:ff:ff:ff:ff:ff", &mac), None);
    }

    #[test]
    fn router_rewrite_keeps_ip_and_payload() {
        let (ports, _, _) = scene();
        let out = ports.iter().find(|p| p.port_id == "R1/02").unwrap();
        let mut frame = SimFrame {
            frame_id: "f-1".into(),
            dst_mac: "bb:bb:bb:bb:bb:01".into(),
            src_mac: "aa:aa:aa:aa:aa:0a".into(),
            src_ip: "192.168.1.10".into(),
            dst_ip: "192.168.2.10".into(),
            payload: "你好".into(),
            at_device_id: "R1".into(),
            status: "inflight".into(),
        };
        rewrite_router_macs(&mut frame, out, &ports);
        assert_eq!(frame.dst_mac, "cc:cc:cc:cc:cc:0b");
        assert_eq!(frame.src_mac, "bb:bb:bb:bb:bb:02");
        assert_eq!(frame.src_ip, "192.168.1.10");
        assert_eq!(frame.dst_ip, "192.168.2.10");
        assert_eq!(frame.payload, "你好");
        assert_eq!(router_out_port("R1", "192.168.2.10", &ports).as_deref(), Some("R1/02"));
    }
}
