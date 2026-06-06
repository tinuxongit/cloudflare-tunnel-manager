//! SQLite-backed persistence for created projects. Lets the Projects view
//! survive app restarts + supports redeploying / deleting from the UI.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub template_id: String,
    pub folder: String,
    pub deployed_url: Option<String>,
    pub custom_domain: Option<String>,
    pub created_at: String,
    pub last_deployed_at: Option<String>,
}

pub fn insert(
    conn: &Connection,
    name: &str,
    template_id: &str,
    folder: &str,
    deployed_url: Option<&str>,
    custom_domain: Option<&str>,
) -> AppResult<Project> {
    conn.execute(
        "INSERT INTO projects (name, template_id, folder, deployed_url, custom_domain, last_deployed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        params![name, template_id, folder, deployed_url, custom_domain],
    )?;
    let id = conn.last_insert_rowid();
    by_id(conn, id)
}

pub fn list(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, template_id, folder, deployed_url, custom_domain, created_at, last_deployed_at
         FROM projects ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], row_to_project)?;
    Ok(rows.filter_map(Result::ok).collect())
}

pub fn by_id(conn: &Connection, id: i64) -> AppResult<Project> {
    let mut stmt = conn.prepare(
        "SELECT id, name, template_id, folder, deployed_url, custom_domain, created_at, last_deployed_at
         FROM projects WHERE id = ?1",
    )?;
    let p = stmt.query_row(params![id], row_to_project)?;
    Ok(p)
}

pub fn update_live_url(
    conn: &Connection,
    id: i64,
    deployed_url: Option<&str>,
    custom_domain: Option<&str>,
) -> AppResult<Project> {
    conn.execute(
        "UPDATE projects SET deployed_url = ?1, custom_domain = ?2 WHERE id = ?3",
        params![deployed_url, custom_domain, id],
    )?;
    by_id(conn, id)
}

pub fn update_import_by_folder(
    conn: &Connection,
    folder: &str,
    name: &str,
    template_id: &str,
    deployed_url: Option<&str>,
    custom_domain: Option<&str>,
) -> AppResult<Project> {
    conn.execute(
        "UPDATE projects
         SET name = ?1, template_id = ?2, deployed_url = ?3, custom_domain = ?4
         WHERE folder = ?5",
        params![name, template_id, deployed_url, custom_domain, folder],
    )?;
    let mut stmt = conn.prepare(
        "SELECT id, name, template_id, folder, deployed_url, custom_domain, created_at, last_deployed_at
         FROM projects WHERE folder = ?1",
    )?;
    Ok(stmt.query_row(params![folder], row_to_project)?)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn touch_deploy(conn: &Connection, id: i64, deployed_url: Option<&str>) -> AppResult<Project> {
    conn.execute(
        "UPDATE projects SET deployed_url = COALESCE(?1, deployed_url), last_deployed_at = datetime('now') WHERE id = ?2",
        params![deployed_url, id],
    )?;
    by_id(conn, id)
}

/// Used by the Stop button to mark a project as not-currently-deployed
/// without deleting the row. The card flips to "Stopped"; Deploy will
/// recreate the Worker + repopulate this URL.
pub fn clear_deployed_url(conn: &Connection, id: i64) -> AppResult<Project> {
    conn.execute(
        "UPDATE projects SET deployed_url = NULL WHERE id = ?1",
        params![id],
    )?;
    by_id(conn, id)
}

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        template_id: row.get(2)?,
        folder: row.get(3)?,
        deployed_url: row.get(4)?,
        custom_domain: row.get(5)?,
        created_at: row.get(6)?,
        last_deployed_at: row.get(7)?,
    })
}
