use rusqlite_migration::{M, Migrations};
use once_cell::sync::Lazy;

pub static MIGRATIONS: Lazy<Migrations<'static>> = Lazy::new(|| {
    Migrations::new(vec![
        M::up(
            r#"
            CREATE TABLE pages (
                id            INTEGER PRIMARY KEY,
                hostname      TEXT NOT NULL UNIQUE,
                service_url   TEXT NOT NULL,
                tunnel_uuid   TEXT NOT NULL,
                enabled       INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE tunnels (
                uuid          TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                cred_path     TEXT NOT NULL,
                managed       INTEGER NOT NULL DEFAULT 0,
                last_seen     TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            INSERT INTO settings (key, value) VALUES
                ('grouping_mode', 'shared'),
                ('theme', 'dark'),
                ('start_on_boot', '0');
            "#,
        ),
    ])
});
