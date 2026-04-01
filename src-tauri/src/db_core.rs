use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use std::time::Duration;

use crate::app_paths::{get_db_path, get_vault_db_path};
use crate::DB_BUSY_TIMEOUT_SECS;

pub(crate) fn open_db() -> Result<Connection, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(DB_BUSY_TIMEOUT_SECS))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(crate) fn open_vault_db() -> Result<Connection, String> {
    let conn = Connection::open(get_vault_db_path()).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(DB_BUSY_TIMEOUT_SECS))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(crate) fn current_export_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub(crate) fn ignore_duplicate_column_error(
    result: Result<usize, rusqlite::Error>,
) -> Result<(), String> {
    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.to_ascii_lowercase().contains("duplicate column name") {
                Ok(())
            } else {
                Err(msg)
            }
        }
    }
}

fn ensure_ssh_tunnels_foreign_key(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA foreign_key_list(ssh_tunnels)")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (table_name, from_col, to_col, on_delete) = row.map_err(|e| e.to_string())?;
        if table_name == "connections"
            && from_col == "server_id"
            && to_col == "id"
            && on_delete.eq_ignore_ascii_case("CASCADE")
        {
            return Ok(());
        }
    }

    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;

        CREATE TABLE ssh_tunnels_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            local_port INTEGER NOT NULL,
            remote_host TEXT NOT NULL,
            remote_port INTEGER NOT NULL,
            bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
            auto_start INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (server_id) REFERENCES connections(id) ON DELETE CASCADE
        );

        INSERT INTO ssh_tunnels_new (
            id, server_id, name, local_port, remote_host, remote_port, bind_host, auto_start
        )
        SELECT
            t.id, t.server_id, t.name, t.local_port, t.remote_host, t.remote_port, t.bind_host, t.auto_start
        FROM ssh_tunnels t
        INNER JOIN connections c ON c.id = t.server_id;

        DROP TABLE ssh_tunnels;
        ALTER TABLE ssh_tunnels_new RENAME TO ssh_tunnels;

        COMMIT;
        PRAGMA foreign_keys = ON;
        "#,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn init_db() -> Result<(), String> {
    let conn = open_db()?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;

    ignore_duplicate_column_error(conn.execute(
        "ALTER TABLE connections ADD COLUMN password TEXT NOT NULL DEFAULT ''",
        [],
    ))?;
    ignore_duplicate_column_error(conn.execute(
        "ALTER TABLE connections ADD COLUMN private_key TEXT NOT NULL DEFAULT ''",
        [],
    ))?;
    ignore_duplicate_column_error(conn.execute(
        "ALTER TABLE connections ADD COLUMN passphrase TEXT NOT NULL DEFAULT ''",
        [],
    ))?;
    ignore_duplicate_column_error(conn.execute(
        "ALTER TABLE connections ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
        [],
    ))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS snippets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, command TEXT NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ssh_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            public_key TEXT NOT NULL DEFAULT '',
            private_key_path TEXT NOT NULL,
            key_type TEXT NOT NULL DEFAULT '',
            fingerprint TEXT NOT NULL DEFAULT ''
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ssh_tunnels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            local_port INTEGER NOT NULL,
            remote_host TEXT NOT NULL,
            remote_port INTEGER NOT NULL,
            bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
            auto_start INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    ensure_ssh_tunnels_foreign_key(&conn)?;

    Ok(())
}

pub(crate) fn ensure_connection_exists(conn: &Connection, id: i32) -> Result<(), String> {
    let exists: Option<i32> = conn
        .query_row(
            "SELECT id FROM connections WHERE id = ?1 LIMIT 1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if exists.is_some() {
        Ok(())
    } else {
        Err("Connection not found".to_string())
    }
}

pub(crate) fn validate_snippet(name: &str, command: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Snippet name is empty".to_string());
    }

    if command.trim().is_empty() {
        return Err("Snippet command is empty".to_string());
    }

    Ok(())
}
