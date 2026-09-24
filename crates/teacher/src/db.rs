use std::path::Path;

use std::collections::{HashMap, VecDeque};

use papernet_shared::{ClaimState, DeviceKind, Inventory, LinkView, Mode};
use rusqlite::Connection;

use crate::classroom::{Classroom, Device, Port};

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS classroom (
            classroom_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            claim_state TEXT NOT NULL,
            mode TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS device (
            classroom_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            mac TEXT,
            claimed_connection_id TEXT,
            PRIMARY KEY (classroom_id, device_id)
        );
        CREATE TABLE IF NOT EXISTS port (
            classroom_id TEXT NOT NULL,
            port_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            ip TEXT,
            mask TEXT NOT NULL,
            gateway TEXT,
            peer_port_id TEXT,
            mac TEXT,
            PRIMARY KEY (classroom_id, port_id)
        );
        CREATE TABLE IF NOT EXISTS link (
            classroom_id TEXT NOT NULL,
            link_id TEXT NOT NULL,
            port_a TEXT NOT NULL,
            port_b TEXT NOT NULL,
            physically_up INTEGER NOT NULL,
            PRIMARY KEY (classroom_id, link_id)
        );
        CREATE TABLE IF NOT EXISTS tap_attach (
            classroom_id TEXT NOT NULL,
            tap_id TEXT NOT NULL,
            link_id TEXT NOT NULL,
            PRIMARY KEY (classroom_id, tap_id)
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn insert_classroom_snapshot(
    conn: &mut Connection,
    class: &Classroom,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO classroom (classroom_id, title, claim_state, mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            class.classroom_id,
            class.title,
            class.claim_state.as_str(),
            class.mode.as_str(),
            class.created_at
        ],
    )?;
    for device in class.devices.values() {
        insert_device(&tx, &class.classroom_id, device)?;
        for port in &device.ports {
            insert_port(&tx, &class.classroom_id, &device.id, port)?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn insert_device(
    conn: &Connection,
    classroom_id: &str,
    device: &Device,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO device (classroom_id, device_id, kind, mac, claimed_connection_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            classroom_id,
            device.id,
            device.kind.as_str(),
            device.mac,
            device.claimed_connection_id
        ],
    )?;
    Ok(())
}

fn insert_port(
    conn: &Connection,
    classroom_id: &str,
    device_id: &str,
    port: &Port,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO port (classroom_id, port_id, device_id, ip, mask, gateway, peer_port_id, mac)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            classroom_id,
            port.id,
            device_id,
            port.ip,
            port.mask,
            port.gateway,
            port.peer_port_id,
            port.mac
        ],
    )?;
    Ok(())
}

pub fn update_claim_state(
    conn: &Connection,
    classroom_id: &str,
    claim_state: ClaimState,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE classroom SET claim_state = ?1 WHERE classroom_id = ?2",
        rusqlite::params![claim_state.as_str(), classroom_id],
    )?;
    Ok(())
}

pub fn update_device_claim(
    conn: &Connection,
    classroom_id: &str,
    device: &Device,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE device SET mac = ?1, claimed_connection_id = ?2
         WHERE classroom_id = ?3 AND device_id = ?4",
        rusqlite::params![
            device.mac,
            device.claimed_connection_id,
            classroom_id,
            device.id
        ],
    )?;
    if let Some(port) = device.ports.first() {
        conn.execute(
            "UPDATE port SET mac = ?1 WHERE classroom_id = ?2 AND port_id = ?3",
            rusqlite::params![port.mac, classroom_id, port.id],
        )?;
    }
    Ok(())
}

pub fn update_port(
    conn: &Connection,
    classroom_id: &str,
    port: &Port,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE port SET ip = ?1, mask = ?2, gateway = ?3, peer_port_id = ?4, mac = ?5
         WHERE classroom_id = ?6 AND port_id = ?7",
        rusqlite::params![
            port.ip,
            port.mask,
            port.gateway,
            port.peer_port_id,
            port.mac,
            classroom_id,
            port.id
        ],
    )?;
    Ok(())
}

pub fn replace_links(
    conn: &Connection,
    classroom_id: &str,
    links: &[LinkView],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM link WHERE classroom_id = ?1",
        [classroom_id],
    )?;
    for link in links {
        conn.execute(
            "INSERT INTO link (classroom_id, link_id, port_a, port_b, physically_up)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                classroom_id,
                link.link_id,
                link.port_a,
                link.port_b,
                if link.physically_up { 1 } else { 0 }
            ],
        )?;
    }
    Ok(())
}

pub fn upsert_tap_attach(
    conn: &Connection,
    classroom_id: &str,
    tap_id: &str,
    link_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tap_attach (classroom_id, tap_id, link_id) VALUES (?1, ?2, ?3)
         ON CONFLICT(classroom_id, tap_id) DO UPDATE SET link_id = excluded.link_id",
        rusqlite::params![classroom_id, tap_id, link_id],
    )?;
    Ok(())
}

pub fn delete_classroom(conn: &Connection, classroom_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM tap_attach WHERE classroom_id = ?1",
        [classroom_id],
    )?;
    conn.execute("DELETE FROM link WHERE classroom_id = ?1", [classroom_id])?;
    conn.execute("DELETE FROM port WHERE classroom_id = ?1", [classroom_id])?;
    conn.execute("DELETE FROM device WHERE classroom_id = ?1", [classroom_id])?;
    conn.execute(
        "DELETE FROM classroom WHERE classroom_id = ?1",
        [classroom_id],
    )?;
    Ok(())
}

pub fn update_mode(
    conn: &Connection,
    classroom_id: &str,
    mode: Mode,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE classroom SET mode = ?1 WHERE classroom_id = ?2",
        rusqlite::params![mode.as_str(), classroom_id],
    )?;
    Ok(())
}

pub fn clear_claim_bindings(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("UPDATE device SET claimed_connection_id = NULL", [])?;
    Ok(())
}

pub fn load_classrooms(conn: &Connection) -> Result<HashMap<String, Classroom>, String> {
    let metas = {
        let mut stmt = conn
            .prepare(
                "SELECT classroom_id, title, claim_state, mode, created_at FROM classroom",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let mut out = HashMap::new();
    for (id, title, claim_s, mode_s, created_at) in metas {
        let mut class = Classroom {
            classroom_id: id.clone(),
            title,
            claim_state: parse_claim(&claim_s)?,
            mode: parse_mode(&mode_s)?,
            created_at,
            inventory: Inventory::default(),
            devices: load_devices(conn, &id)?,
            connections: HashMap::new(),
            links: Vec::new(),
            mac_table: Vec::new(),
            arp_table: Vec::new(),
            tap_attaches: load_taps(conn, &id)?,
            chat_log: VecDeque::new(),
            frames: HashMap::new(),
            tap_log: VecDeque::new(),
        };
        class.rebuild_tables();
        out.insert(id, class);
    }
    Ok(out)
}

fn load_devices(
    conn: &Connection,
    classroom_id: &str,
) -> Result<HashMap<String, Device>, String> {
    let mut devices = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT device_id, kind, mac FROM device WHERE classroom_id = ?1 ORDER BY device_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([classroom_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, kind_s, mac) = row.map_err(|e| e.to_string())?;
            devices.insert(
                id.clone(),
                Device {
                    id,
                    kind: parse_kind(&kind_s)?,
                    mac,
                    claimed_connection_id: None,
                    ports: Vec::new(),
                },
            );
        }
    }
    {
        let mut stmt = conn
            .prepare(
                "SELECT port_id, device_id, ip, mask, gateway, peer_port_id, mac
                 FROM port WHERE classroom_id = ?1 ORDER BY port_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([classroom_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (port_id, device_id, ip, mask, gateway, peer, mac) =
                row.map_err(|e| e.to_string())?;
            if let Some(dev) = devices.get_mut(&device_id) {
                dev.ports.push(Port {
                    id: port_id,
                    ip,
                    mask,
                    gateway,
                    peer_port_id: peer,
                    mac,
                });
            }
        }
    }
    Ok(devices)
}

fn load_taps(
    conn: &Connection,
    classroom_id: &str,
) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT tap_id, link_id FROM tap_attach WHERE classroom_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([classroom_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for row in rows {
        let (tap_id, link_id) = row.map_err(|e| e.to_string())?;
        out.insert(tap_id, link_id);
    }
    Ok(out)
}

fn parse_claim(s: &str) -> Result<ClaimState, String> {
    match s {
        "draft" => Ok(ClaimState::Draft),
        "open" => Ok(ClaimState::Open),
        "full" => Ok(ClaimState::Full),
        other => Err(format!("unknown claim_state {other}")),
    }
}

fn parse_mode(s: &str) -> Result<Mode, String> {
    match s {
        "normal" => Ok(Mode::Normal),
        "simulation" => Ok(Mode::Simulation),
        other => Err(format!("unknown mode {other}")),
    }
}

fn parse_kind(s: &str) -> Result<DeviceKind, String> {
    match s {
        "router" => Ok(DeviceKind::Router),
        "switch" => Ok(DeviceKind::Switch),
        "pc" => Ok(DeviceKind::Pc),
        "tap" => Ok(DeviceKind::Tap),
        other => Err(format!("unknown device kind {other}")),
    }
}
