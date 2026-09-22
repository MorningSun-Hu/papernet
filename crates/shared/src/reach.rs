use crate::topo::{l2_reachable, parse_ipv4, same_c_class, LinkView, PortRef};
use crate::DeviceKind;

/// Whether `src_device_id` can reach `dst_ip` on the current topology.
///
/// Same C-class: L2 BFS along physically-up links, switches, and TAP.
/// Cross C-class: source must be a PC whose gateway equals the near-side
/// router port IP that leads to the destination network, with both hops up.
pub fn is_reachable(
    src_device_id: &str,
    dst_ip: &str,
    ports: &[PortRef],
    links: &[LinkView],
) -> bool {
    if parse_ipv4(dst_ip).is_none() {
        return false;
    }
    let dest_ports: Vec<&PortRef> = ports
        .iter()
        .filter(|p| p.ip.as_deref() == Some(dst_ip))
        .collect();
    if dest_ports.is_empty() {
        return false;
    }
    let src_ports: Vec<&PortRef> = ports
        .iter()
        .filter(|p| p.device_id == src_device_id)
        .collect();
    if src_ports.is_empty() {
        return false;
    }
    let src_kind = src_ports[0].kind;

    for sp in &src_ports {
        let Some(sip) = sp.ip.as_deref() else {
            continue;
        };
        for dp in &dest_ports {
            if same_c_class(sip, dst_ip) {
                if l2_reachable(&sp.port_id, &dp.port_id, ports, links) {
                    return true;
                }
            } else if src_kind == DeviceKind::Pc && cross_reachable(sp, dp, ports, links) {
                return true;
            }
        }
    }
    false
}

fn cross_reachable(sp: &PortRef, dp: &PortRef, ports: &[PortRef], links: &[LinkView]) -> bool {
    let Some(gw) = sp.gateway.as_deref() else {
        return false;
    };
    let Some(dst_ip) = dp.ip.as_deref() else {
        return false;
    };
    let mut routers: std::collections::HashMap<&str, Vec<&PortRef>> =
        std::collections::HashMap::new();
    for p in ports {
        if p.kind == DeviceKind::Router {
            routers.entry(p.device_id.as_str()).or_default().push(p);
        }
    }
    for rports in routers.values() {
        let near = rports.iter().copied().find(|p| p.ip.as_deref() == Some(gw));
        let far = rports.iter().copied().find(|p| {
            p.ip.as_deref()
                .is_some_and(|ip| same_c_class(ip, dst_ip))
        });
        let (Some(near), Some(far)) = (near, far) else {
            continue;
        };
        if near.port_id == far.port_id {
            continue;
        }
        if l2_reachable(&sp.port_id, &near.port_id, ports, links)
            && l2_reachable(&far.port_id, &dp.port_id, ports, links)
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topo::rebuild_links;
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

    /// PCA — S1 — R1 — S2 — PCB
    fn classroom_scene(pca_gw: Option<&str>, pcb_gw: Option<&str>, s1_02_peer: bool) -> (Vec<PortRef>, Vec<LinkView>) {
        let ports = vec![
            port(
                "PCA",
                DeviceKind::Pc,
                "PCA/01",
                Some("192.168.1.10"),
                Some("S1/01"),
                Some("aa:aa:aa:aa:aa:01"),
                pca_gw,
            ),
            port("S1", DeviceKind::Switch, "S1/01", None, Some("PCA/01"), None, None),
            port(
                "S1",
                DeviceKind::Switch,
                "S1/02",
                None,
                if s1_02_peer { Some("R1/01") } else { None },
                None,
                None,
            ),
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
                Some("cc:cc:cc:cc:cc:01"),
                pcb_gw,
            ),
        ];
        let links = rebuild_links(&ports);
        (ports, links)
    }

    #[test]
    fn same_segment_two_pcs_via_switch() {
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
        assert!(is_reachable("PC1", "192.168.1.11", &ports, &links));
        assert!(is_reachable("PC2", "192.168.1.10", &ports, &links));
    }

    #[test]
    fn broken_link_is_unreachable() {
        let (ports, links) = classroom_scene(Some("192.168.1.1"), Some("192.168.2.1"), false);
        assert!(!is_reachable("PCA", "192.168.2.10", &ports, &links));
        assert!(!is_reachable("PCA", "192.168.1.1", &ports, &links));
    }

    #[test]
    fn cross_segment_needs_near_router_gateway() {
        let (ports, links) = classroom_scene(Some("192.168.1.1"), Some("192.168.2.1"), true);
        assert!(is_reachable("PCA", "192.168.2.10", &ports, &links));
        assert!(is_reachable("PCB", "192.168.1.10", &ports, &links));
    }

    #[test]
    fn missing_or_wrong_gateway_blocks_cross_segment() {
        let (ports, links) = classroom_scene(None, Some("192.168.2.1"), true);
        assert!(!is_reachable("PCA", "192.168.2.10", &ports, &links));
        let (ports, links) = classroom_scene(Some("192.168.2.1"), Some("192.168.2.1"), true);
        assert!(!is_reachable("PCA", "192.168.2.10", &ports, &links));
        let (ports, links) = classroom_scene(Some("192.168.1.99"), Some("192.168.2.1"), true);
        assert!(!is_reachable("PCA", "192.168.2.10", &ports, &links));
    }

    #[test]
    fn unknown_dst_ip_is_unreachable() {
        let (ports, links) = classroom_scene(Some("192.168.1.1"), Some("192.168.2.1"), true);
        assert!(!is_reachable("PCA", "10.0.0.1", &ports, &links));
    }
}
