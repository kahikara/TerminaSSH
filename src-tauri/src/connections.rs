use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};

use crate::{
    SshState, VaultState, delete_vault_secret, init_vault_db, open_db, open_vault_db,
    require_runtime_vault_dek, upsert_vault_secret,
};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SshConnection {
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
    group_name: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ConnectionItem {
    id: i32,
    name: String,
    host: String,
    port: u16,
    username: String,
    private_key: String,
    group_name: String,
    has_password: bool,
}

#[tauri::command]
pub(crate) fn get_connections() -> Result<Vec<ConnectionItem>, String> {
    init_vault_db()?;
    let conn = open_db()?;
    let vault_conn = open_vault_db()?;

    let mut password_ids = HashSet::new();
    let mut vault_stmt = vault_conn
        .prepare("SELECT DISTINCT connection_id FROM secrets WHERE secret_type = 'password'")
        .map_err(|e| e.to_string())?;
    let vault_iter = vault_stmt
        .query_map([], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())?;
    for item in vault_iter {
        password_ids.insert(item.map_err(|e| e.to_string())?);
    }

    let mut stmt = conn
        .prepare("SELECT id, name, host, port, username, private_key, group_name, password FROM connections ORDER BY CASE WHEN TRIM(group_name) = '' THEN 0 ELSE 1 END, group_name COLLATE NOCASE ASC, name COLLATE NOCASE ASC, host COLLATE NOCASE ASC")
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([], |row| {
            let id: i32 = row.get(0)?;
            let legacy_password: String = row.get(7)?;
            Ok(ConnectionItem {
                id,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                private_key: row.get(5)?,
                group_name: row.get(6)?,
                has_password: password_ids.contains(&id) || !legacy_password.trim().is_empty(),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut res = Vec::new();
    for item in iter {
        res.push(item.map_err(|e| e.to_string())?);
    }
    Ok(res)
}


pub(crate) fn normalize_connection_fields(connection: &mut SshConnection) {
    connection.name = connection.name.trim().to_string();
    connection.host = connection.host.trim().to_string();
    connection.username = connection.username.trim().to_string();
    connection.private_key = connection.private_key.trim().to_string();
    connection.group_name = connection.group_name.trim().to_string();
}




pub(crate) fn validate_connection(connection: &SshConnection) -> Result<(), String> {
    if connection.name.is_empty() {
        return Err("Connection name is required".to_string());
    }

    if connection.host.is_empty() {
        return Err("Host is required".to_string());
    }

    if connection.username.is_empty() {
        return Err("Username is required".to_string());
    }

    if connection.port == 0 {
        return Err("Port must be between 1 and 65535".to_string());
    }

    Ok(())
}


fn ensure_connection_identity_unique(
    conn: &Connection,
    connection: &SshConnection,
    exclude_id: Option<i32>,
) -> Result<(), String> {
    let existing: Option<String> = if let Some(exclude_id) = exclude_id {
        conn.query_row(
            "SELECT name FROM connections WHERE host = ?1 AND port = ?2 AND username = ?3 AND group_name = ?4 AND id != ?5 LIMIT 1",
            (
                &connection.host,
                &connection.port,
                &connection.username,
                &connection.group_name,
                &exclude_id,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT name FROM connections WHERE host = ?1 AND port = ?2 AND username = ?3 AND group_name = ?4 LIMIT 1",
            (
                &connection.host,
                &connection.port,
                &connection.username,
                &connection.group_name,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(name) = existing {
        Err(format!(
            "A connection for {}@{}:{} already exists{}",
            connection.username,
            connection.host,
            connection.port,
            if name == connection.name {
                String::new()
            } else {
                format!(": {}", name)
            }
        ))
    } else {
        Ok(())
    }
}


#[tauri::command]
pub(crate) fn save_connection(
    mut connection: SshConnection,
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    normalize_connection_fields(&mut connection);
    validate_connection(&connection)?;

    init_vault_db()?;
    let conn = open_db()?;
    ensure_connection_identity_unique(&conn, &connection, None)?;

    let vault_conn = open_vault_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    conn.execute(
        "INSERT INTO connections (name, host, port, username, password, private_key, passphrase, group_name)
         VALUES (?1, ?2, ?3, ?4, '', ?5, '', ?6)",
        (
            &connection.name,
            &connection.host,
            &connection.port,
            &connection.username,
            &connection.private_key,
            &connection.group_name,
        ),
    )
    .map_err(|e| e.to_string())?;

    let connection_id = conn.last_insert_rowid() as i32;

    if let Err(err) = (|| -> Result<(), String> {
        upsert_vault_secret(
            &vault_conn,
            connection_id,
            "password",
            &connection.password,
            &dek,
        )?;
        upsert_vault_secret(
            &vault_conn,
            connection_id,
            "passphrase",
            &connection.passphrase,
            &dek,
        )?;
        Ok(())
    })() {
        let _ = conn.execute("DELETE FROM connections WHERE id = ?1", [&connection_id]);
        let _ = delete_vault_secret(&vault_conn, connection_id, "password");
        let _ = delete_vault_secret(&vault_conn, connection_id, "passphrase");
        return Err(err);
    }

    let _ = app.emit("connection-saved", ());
    Ok(format!("Connection '{}' saved", connection.name))
}

#[tauri::command]
pub(crate) fn update_connection(
    id: i32,
    old_name: String,
    mut connection: SshConnection,
    clear_password: bool,
    clear_passphrase: bool,
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    normalize_connection_fields(&mut connection);
    validate_connection(&connection)?;

    init_vault_db()?;
    let conn = open_db()?;
    ensure_connection_exists(&conn, id)?;
    ensure_connection_identity_unique(&conn, &connection, Some(id))?;

    let vault_conn = open_vault_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    let updated = conn.execute(
        "UPDATE connections
         SET name = ?1, host = ?2, port = ?3, username = ?4, password = '', private_key = ?5, passphrase = '', group_name = ?6
         WHERE id = ?7",
        (
            &connection.name,
            &connection.host,
            &connection.port,
            &connection.username,
            &connection.private_key,
            &connection.group_name,
            &id,
        ),
    )
    .map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Connection not found".to_string());
    }

    if clear_password {
        delete_vault_secret(&vault_conn, id, "password")?;
    } else if !connection.password.is_empty() {
        upsert_vault_secret(&vault_conn, id, "password", &connection.password, &dek)?;
    }

    if clear_passphrase {
        delete_vault_secret(&vault_conn, id, "passphrase")?;
    } else if !connection.passphrase.is_empty() {
        upsert_vault_secret(&vault_conn, id, "passphrase", &connection.passphrase, &dek)?;
    }

    let _ = old_name;
    let _ = app.emit("connection-saved", ());
    Ok(format!("Connection '{}' updated", connection.name))
}

#[tauri::command]
pub(crate) fn set_connection_password(
    id: i32,
    password: String,
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    init_vault_db()?;
    let conn = open_db()?;
    ensure_connection_exists(&conn, id)?;

    let vault_conn = open_vault_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    conn.execute("UPDATE connections SET password = '' WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if password.is_empty() {
        delete_vault_secret(&vault_conn, id, "password")?;
    } else {
        upsert_vault_secret(&vault_conn, id, "password", &password, &dek)?;
    }

    let _ = app.emit("connection-saved", ());
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_connection(
    id: i32,
    name: String,
    app: AppHandle,
    state: State<'_, SshState>,
) -> Result<String, String> {
    init_vault_db()?;
    let conn = open_db()?;
    let vault_conn = open_vault_db()?;
    ensure_connection_exists(&conn, id)?;

    let mut stmt = conn
        .prepare("SELECT id FROM ssh_tunnels WHERE server_id = ?1")
        .map_err(|e| e.to_string())?;
    let tunnel_ids = stmt
        .query_map([&id], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let entries = {
        let mut map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;

        let mut entries = Vec::new();
        for tunnel_id in &tunnel_ids {
            if let Some(entry) = map.remove(tunnel_id) {
                entries.push(entry);
            }
        }
        entries
    };

    for entry in entries {
        entry.stop_flag.store(true, Ordering::Relaxed);
        let _ = entry.handle.join();
    }

    conn.execute("DELETE FROM ssh_tunnels WHERE server_id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    delete_vault_secret(&vault_conn, id, "password")?;
    delete_vault_secret(&vault_conn, id, "passphrase")?;

    let deleted = conn
        .execute("DELETE FROM connections WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("Connection not found".to_string());
    }

    let _ = app.emit("connection-saved", ());
    Ok(format!("Connection '{}' deleted", name))
}

