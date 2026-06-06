use rusqlite::{Connection, params};
use crate::db::models::*;
use crate::error::{AppError, AppResult};

const PAGE_COLS: &str =
    "id, hostname, service_url, tunnel_uuid, enabled, created_at, source_dir, run_command, assigned_port";

fn row_to_page(r: &rusqlite::Row) -> rusqlite::Result<Page> {
    Ok(Page {
        id: r.get(0)?,
        hostname: r.get(1)?,
        service_url: r.get(2)?,
        tunnel_uuid: r.get(3)?,
        enabled: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        source_dir: r.get(6)?,
        run_command: r.get(7)?,
        assigned_port: r.get::<_, Option<i64>>(8)?.map(|v| v as u16),
    })
}

pub fn insert_page(conn: &Connection, input: &NewPageInput) -> AppResult<Page> {
    if list_pages(conn)?.iter().any(|p| p.hostname == input.hostname) {
        return Err(AppError::HostnameTaken { hostname: input.hostname.clone() });
    }
    conn.execute(
        "INSERT INTO pages (hostname, service_url, tunnel_uuid, source_dir, run_command)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![input.hostname, input.service_url, input.tunnel_uuid,
                input.source_dir, input.run_command],
    )?;
    let id = conn.last_insert_rowid();
    get_page(conn, id)
}

pub fn get_page(conn: &Connection, id: i64) -> AppResult<Page> {
    let sql = format!("SELECT {PAGE_COLS} FROM pages WHERE id=?1");
    Ok(conn.query_row(&sql, params![id], row_to_page)?)
}

pub fn list_pages(conn: &Connection) -> AppResult<Vec<Page>> {
    let sql = format!("SELECT {PAGE_COLS} FROM pages ORDER BY id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_page)?;
    Ok(rows.collect::<Result<Vec<_>,_>>()?)
}

pub fn update_page(conn: &Connection, id: i64, patch: &PagePatch) -> AppResult<Page> {
    let cur = get_page(conn, id)?;
    let hostname     = patch.hostname.clone().unwrap_or(cur.hostname);
    let service_url  = patch.service_url.clone().unwrap_or(cur.service_url);
    let tunnel_uuid  = patch.tunnel_uuid.clone().unwrap_or(cur.tunnel_uuid);
    let enabled      = patch.enabled.unwrap_or(cur.enabled);
    // Double-Option: None = field absent (keep current), Some(None) = clear,
    // Some(Some(x)) = set to x. Lets the UI send JSON null to wipe a field.
    let source_dir    = patch.source_dir.clone().unwrap_or(cur.source_dir);
    let run_command   = patch.run_command.clone().unwrap_or(cur.run_command);
    let assigned_port = patch.assigned_port.unwrap_or(cur.assigned_port);
    conn.execute(
        "UPDATE pages SET hostname=?1, service_url=?2, tunnel_uuid=?3, enabled=?4,
                          source_dir=?5, run_command=?6, assigned_port=?7
         WHERE id=?8",
        params![hostname, service_url, tunnel_uuid, enabled as i64,
                source_dir, run_command, assigned_port.map(|v| v as i64),
                id],
    )?;
    get_page(conn, id)
}

pub fn delete_page(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM pages WHERE id=?1", params![id])?;
    Ok(())
}

// Tunnel cache
pub fn upsert_tunnel(conn: &Connection, t: &Tunnel) -> AppResult<()> {
    conn.execute(
        "INSERT INTO tunnels (uuid, name, cred_path, managed, last_seen)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(uuid) DO UPDATE SET name=?2, cred_path=?3, managed=?4, last_seen=datetime('now')",
        params![t.uuid, t.name, t.cred_path, t.managed as i64],
    )?;
    Ok(())
}

pub fn list_tunnels(conn: &Connection) -> AppResult<Vec<Tunnel>> {
    let mut stmt = conn.prepare(
        "SELECT uuid, name, cred_path, managed, last_seen FROM tunnels ORDER BY name"
    )?;
    let rows = stmt.query_map([], |r| Ok(Tunnel {
        uuid: r.get(0)?,
        name: r.get(1)?,
        cred_path: r.get(2)?,
        managed: r.get::<_, i64>(3)? != 0,
        last_seen: r.get(4)?,
    }))?;
    Ok(rows.collect::<Result<Vec<_>,_>>()?)
}

pub fn delete_tunnel(conn: &Connection, uuid: &str) -> AppResult<()> {
    conn.execute("DELETE FROM tunnels WHERE uuid=?1", params![uuid])?;
    Ok(())
}

// Settings (k/v table → struct)
pub fn get_settings(conn: &Connection) -> AppResult<Settings> {
    let mut s = Settings { grouping_mode: "shared".into(), theme: "dark".into(), ..Default::default() };
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        match k.as_str() {
            "grouping_mode"      => s.grouping_mode = v,
            "shared_tunnel_uuid" => s.shared_tunnel_uuid = Some(v),
            "cloudflared_path"   => s.cloudflared_path = Some(v),
            "theme"              => s.theme = v,
            "start_on_boot"      => s.start_on_boot = v == "1",
            _ => {}
        }
    }
    Ok(s)
}

pub fn set_settings(conn: &Connection, patch: &SettingsPatch) -> AppResult<Settings> {
    // Plain Option<String/bool> fields: only present writes; absence leaves
    // the row alone. Double-Option fields (shared_tunnel_uuid, cloudflared_path)
    // distinguish absent (keep), null/empty (delete row), and set.
    let mut updates: Vec<(&str, String)> = vec![];
    let mut deletes: Vec<&str> = vec![];
    if let Some(v) = &patch.grouping_mode { updates.push(("grouping_mode", v.clone())); }
    if let Some(v) = &patch.theme         { updates.push(("theme", v.clone())); }
    if let Some(v) = patch.start_on_boot  { updates.push(("start_on_boot", if v {"1"} else {"0"}.into())); }
    if let Some(outer) = &patch.shared_tunnel_uuid {
        match outer.as_deref() {
            Some(s) if !s.is_empty() => updates.push(("shared_tunnel_uuid", s.to_string())),
            _                        => deletes.push("shared_tunnel_uuid"),
        }
    }
    if let Some(outer) = &patch.cloudflared_path {
        match outer.as_deref() {
            Some(s) if !s.is_empty() => updates.push(("cloudflared_path", s.to_string())),
            _                        => deletes.push("cloudflared_path"),
        }
    }
    for (k, v) in updates {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=?2",
            params![k, v],
        )?;
    }
    for k in deletes {
        conn.execute("DELETE FROM settings WHERE key=?1", params![k])?;
    }
    get_settings(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_and_migrate;
    use crate::db::models::NewPageInput;
    use tempfile::tempdir;

    #[test]
    fn insert_and_list_pages() {
        let dir = tempdir().unwrap();
        let conn = open_and_migrate(&dir.path().join("t.db")).unwrap();
        let p = insert_page(&conn, &NewPageInput {
            hostname: "example.com".into(),
            service_url: "http://localhost:3000".into(),
            tunnel_uuid: "uuid-1".into(),
            source_dir: None,
            run_command: None,
        }).unwrap();
        assert_eq!(p.hostname, "example.com");
        assert!(!p.enabled);
        let all = list_pages(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, p.id);
    }
}
