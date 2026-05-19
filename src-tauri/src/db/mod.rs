pub mod migrations;
pub mod models;
pub mod queries;

use std::path::Path;
use rusqlite::Connection;
use crate::error::AppResult;

pub fn open_and_migrate(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::MIGRATIONS
        .to_latest(&mut conn)
        .map_err(|e| crate::error::AppError::Other { message: e.to_string() })?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrate_creates_pages_table() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        let conn = open_and_migrate(&path).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='pages'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
