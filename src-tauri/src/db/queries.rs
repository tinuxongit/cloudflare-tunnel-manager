use rusqlite::{Connection, params};
use crate::db::models::*;
use crate::error::{AppError, AppResult};

pub fn insert_page(conn: &Connection, input: &NewPageInput) -> AppResult<Page> {
    if list_pages(conn)?.iter().any(|p| p.hostname == input.hostname) {
        return Err(AppError::HostnameTaken { hostname: input.hostname.clone() });
    }
    conn.execute(
        "INSERT INTO pages (hostname, service_url, tunnel_uuid) VALUES (?1, ?2, ?3)",
        params![input.hostname, input.service_url, input.tunnel_uuid],
    )?;
    let id = conn.last_insert_rowid();
    get_page(conn, id)
}

pub fn get_page(conn: &Connection, id: i64) -> AppResult<Page> {
    Ok(conn.query_row(
        "SELECT id, hostname, service_url, tunnel_uuid, enabled, created_at FROM pages WHERE id=?1",
        params![id],
        |r| Ok(Page {
            id: r.get(0)?,
            hostname: r.get(1)?,
            service_url: r.get(2)?,
            tunnel_uuid: r.get(3)?,
            enabled: r.get::<_, i64>(4)? != 0,
            created_at: r.get(5)?,
        }),
    )?)
}

pub fn list_pages(conn: &Connection) -> AppResult<Vec<Page>> {
    let mut stmt = conn.prepare(
        "SELECT id, hostname, service_url, tunnel_uuid, enabled, created_at FROM pages ORDER BY id"
    )?;
    let rows = stmt.query_map([], |r| Ok(Page {
        id: r.get(0)?,
        hostname: r.get(1)?,
        service_url: r.get(2)?,
        tunnel_uuid: r.get(3)?,
        enabled: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
    }))?;
    Ok(rows.collect::<Result<Vec<_>,_>>()?)
}

pub fn update_page(conn: &Connection, id: i64, patch: &PagePatch) -> AppResult<Page> {
    let cur = get_page(conn, id)?;
    let hostname = patch.hostname.clone().unwrap_or(cur.hostname);
    let service_url = patch.service_url.clone().unwrap_or(cur.service_url);
    let tunnel_uuid = patch.tunnel_uuid.clone().unwrap_or(cur.tunnel_uuid);
    let enabled = patch.enabled.unwrap_or(cur.enabled);
    conn.execute(
        "UPDATE pages SET hostname=?1, service_url=?2, tunnel_uuid=?3, enabled=?4 WHERE id=?5",
        params![hostname, service_url, tunnel_uuid, enabled as i64, id],
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
    let mut updates: Vec<(&str, String)> = vec![];
    if let Some(v) = &patch.grouping_mode      { updates.push(("grouping_mode", v.clone())); }
    if let Some(v) = &patch.shared_tunnel_uuid { updates.push(("shared_tunnel_uuid", v.clone())); }
    if let Some(v) = &patch.cloudflared_path   { updates.push(("cloudflared_path", v.clone())); }
    if let Some(v) = &patch.theme              { updates.push(("theme", v.clone())); }
    if let Some(v) = patch.start_on_boot       { updates.push(("start_on_boot", if v {"1"} else {"0"}.into())); }
    for (k, v) in updates {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=?2",
            params![k, v],
        )?;
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
        }).unwrap();
        assert_eq!(p.hostname, "example.com");
        assert!(!p.enabled);
        let all = list_pages(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, p.id);
    }
}
