use std::path::Path;

use papernet_shared::ClaimState;
use rusqlite::Connection;

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
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn insert_classroom(
    conn: &Connection,
    classroom_id: &str,
    title: &str,
    claim_state: ClaimState,
    mode: &str,
    created_at: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO classroom (classroom_id, title, claim_state, mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![classroom_id, title, claim_state.as_str(), mode, created_at],
    )?;
    Ok(())
}
