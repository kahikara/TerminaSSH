use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tauri::State;

use crate::app_paths::{
    cleanup_imported_key_files, ensure_unique_key_path, get_keys_dir, read_file_base64_if_exists,
    sanitize_key_file_stem,
};
use crate::db_core::{current_export_timestamp, open_db, open_vault_db, validate_snippet};
use crate::ssh_keys::{fingerprint_for_pubkey_path, read_public_key_for_path};
use crate::ssh_runtime::load_connection_runtime_details;
use crate::vault_core::{
    init_vault_db, require_runtime_vault_dek, upsert_vault_secret, VaultState,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupSnippet {
    name: String,
    command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupConnection {
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
    group_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupSshKey {
    name: String,
    public_key: String,
    key_type: String,
    fingerprint: String,
    original_path: String,
    private_key_content_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupTunnel {
    name: String,
    server_name: String,
    server_host: String,
    server_port: u16,
    server_username: String,
    server_group_name: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_host: String,
    auto_start: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupNote {
    storage_key: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupBundleV3 {
    version: u32,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    #[serde(rename = "appName")]
    app_name: String,
    #[serde(rename = "appVersion")]
    app_version: String,
    #[serde(rename = "format")]
    format_name: String,
    settings: serde_json::Value,
    connections: Vec<BackupConnection>,
    snippets: Vec<BackupSnippet>,
    tunnels: Vec<BackupTunnel>,
    notes: Vec<BackupNote>,
    #[serde(rename = "sshKeys")]
    ssh_keys: Vec<BackupSshKey>,
}

#[derive(Debug, Serialize)]
pub struct ImportBackupResult {
    settings: serde_json::Value,
    connections_imported: usize,
    snippets_imported: usize,
    ssh_keys_imported: usize,
    tunnels_imported: usize,
    notes_imported: usize,
    notes: Vec<BackupNote>,
    warnings: Vec<String>,
}

#[tauri::command]
pub(crate) fn export_backup_bundle(
    settings_json: String,
    notes_json: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let settings = if settings_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(&settings_json)
            .map_err(|e| format!("Invalid settings JSON: {}", e))?
    };

    let notes = if notes_json.trim().is_empty() {
        Vec::<BackupNote>::new()
    } else {
        serde_json::from_str::<Vec<BackupNote>>(&notes_json)
            .map_err(|e| format!("Invalid notes JSON: {}", e))?
    };

    let conn = open_db()?;

    let mut connections = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, host, port, username, private_key, group_name FROM connections ORDER BY name ASC")
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u16>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            let (id, name, host, port, username, private_key, group_name) =
                item.map_err(|e| e.to_string())?;
            let details = load_connection_runtime_details(id, None, &vault_state)?;

            connections.push(BackupConnection {
                name,
                host,
                port,
                username,
                password: details.password,
                private_key,
                passphrase: details.passphrase,
                group_name,
            });
        }
    }

    let mut snippets = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name, command FROM snippets ORDER BY name ASC")
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                Ok(BackupSnippet {
                    name: row.get(0)?,
                    command: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            snippets.push(item.map_err(|e| e.to_string())?);
        }
    }

    let mut tunnels = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT t.name, c.name, c.host, c.port, c.username, c.group_name, t.local_port, t.remote_host, t.remote_port, t.bind_host, t.auto_start
                 FROM ssh_tunnels t
                 JOIN connections c ON c.id = t.server_id
                 ORDER BY t.name ASC"
            )
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                let auto_start_raw: i32 = row.get(10)?;
                Ok(BackupTunnel {
                    name: row.get(0)?,
                    server_name: row.get(1)?,
                    server_host: row.get(2)?,
                    server_port: row.get(3)?,
                    server_username: row.get(4)?,
                    server_group_name: row.get(5)?,
                    local_port: row.get(6)?,
                    remote_host: row.get(7)?,
                    remote_port: row.get(8)?,
                    bind_host: row.get(9)?,
                    auto_start: auto_start_raw != 0,
                })
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            tunnels.push(item.map_err(|e| e.to_string())?);
        }
    }

    let mut ssh_keys = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name, public_key, private_key_path, key_type, fingerprint FROM ssh_keys ORDER BY name ASC")
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            let (name, public_key, original_path, key_type, fingerprint) =
                item.map_err(|e| e.to_string())?;

            ssh_keys.push(BackupSshKey {
                name,
                public_key,
                key_type,
                fingerprint,
                private_key_content_base64: read_file_base64_if_exists(&original_path),
                original_path,
            });
        }
    }

    let exported_at = current_export_timestamp();

    let bundle = BackupBundleV3 {
        version: 4,
        exported_at,
        app_name: "TerminaSSH".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        format_name: "terminassh-backup-v4".to_string(),
        settings,
        connections,
        snippets,
        tunnels,
        notes,
        ssh_keys,
    };

    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn import_backup_bundle(
    bundle_json: String,
    vault_state: State<'_, VaultState>,
) -> Result<ImportBackupResult, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(&bundle_json).map_err(|e| format!("Invalid backup JSON: {}", e))?;

    if !parsed.is_object() {
        return Err("Backup root must be a JSON object".to_string());
    }

    let version = parsed.get("version").and_then(|v| v.as_u64()).unwrap_or(0);

    if version != 4 {
        return Err(format!(
            "Backup version {} is not supported. Create a new backup with the current app version.",
            version
        ));
    }

    let format_name = parsed
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if format_name != "terminassh-backup-v4" {
        return Err(
            "Backup format is not supported. Create a new backup with the current app version."
                .to_string(),
        );
    }

    let settings = parsed
        .get("settings")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    let ssh_keys_value = parsed
        .get("sshKeys")
        .or_else(|| parsed.get("ssh_keys"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let connections_value = parsed
        .get("connections")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let snippets_value = parsed
        .get("snippets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let tunnels_value = parsed
        .get("tunnels")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let notes_value = parsed
        .get("notes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut imported_notes_map: HashMap<String, String> = HashMap::new();
    for item in notes_value {
        let storage_key = item
            .get("storage_key")
            .or_else(|| item.get("storageKey"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let content = item
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if storage_key.is_empty() {
            continue;
        }

        imported_notes_map.insert(storage_key, content);
    }

    let mut imported_notes: Vec<BackupNote> = imported_notes_map
        .into_iter()
        .map(|(storage_key, content)| BackupNote {
            storage_key,
            content,
        })
        .collect();
    imported_notes.sort_by(|a, b| a.storage_key.cmp(&b.storage_key));

    let notes_imported = imported_notes.len();

    let keys_dir = get_keys_dir();
    let mut warnings: Vec<String> = Vec::new();
    let mut created_imported_key_paths: Vec<String> = Vec::new();

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    let mut key_path_map: HashMap<String, String> = HashMap::new();

    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut ssh_keys_imported = 0usize;

    for item in ssh_keys_value {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Imported")
            .trim()
            .to_string();

        let public_key = item
            .get("public_key")
            .or_else(|| item.get("publicKey"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let key_type = item
            .get("key_type")
            .or_else(|| item.get("keyType"))
            .and_then(|v| v.as_str())
            .unwrap_or("imported")
            .trim()
            .to_string();

        let fingerprint = item
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let original_path = item
            .get("original_path")
            .or_else(|| item.get("private_key_path"))
            .or_else(|| item.get("privateKeyPath"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let private_key_content_base64 = item
            .get("private_key_content_base64")
            .or_else(|| item.get("privateKeyContentBase64"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let final_path = if !private_key_content_base64.is_empty() {
            let bytes = match STANDARD.decode(private_key_content_base64.as_bytes()) {
                Ok(bytes) => bytes,
                Err(_) => {
                    warnings.push(format!(
                        "SSH key '{}' could not be decoded and was skipped.",
                        name
                    ));
                    continue;
                }
            };

            let stem = sanitize_key_file_stem(&name);
            let private_path = ensure_unique_key_path(&keys_dir, &stem);

            fs::write(&private_path, bytes).map_err(|e| {
                cleanup_imported_key_files(&created_imported_key_paths);
                e.to_string()
            })?;
            created_imported_key_paths.push(private_path.clone());

            #[cfg(unix)]
            {
                let _ = fs::set_permissions(&private_path, fs::Permissions::from_mode(0o600));
            }

            if !public_key.is_empty() {
                let _ = fs::write(
                    format!("{}.pub", &private_path),
                    format!("{}\n", public_key),
                );
            }

            private_path
        } else if !original_path.is_empty() && Path::new(&original_path).exists() {
            original_path.clone()
        } else {
            warnings.push(format!(
                "SSH key '{}' had no portable key content and no usable local path, so it was skipped.",
                name
            ));
            continue;
        };

        let final_public_key = if public_key.is_empty() {
            read_public_key_for_path(&final_path)
        } else {
            public_key.clone()
        };

        let final_fingerprint = if fingerprint.is_empty() {
            fingerprint_for_pubkey_path(&format!("{}.pub", &final_path))
        } else {
            fingerprint.clone()
        };

        let existing_key_path: Option<String> = tx
            .query_row(
                "SELECT private_key_path FROM ssh_keys WHERE (public_key = ?1 AND ?1 != '') OR (name = ?2 AND key_type = ?3 AND fingerprint = ?4 AND ?4 != '') LIMIT 1",
                (&final_public_key, &name, &key_type, &final_fingerprint),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_path) = existing_key_path {
            if !original_path.is_empty() {
                key_path_map.insert(original_path.clone(), existing_path.clone());
            }
            key_path_map.insert(existing_path.clone(), existing_path.clone());

            if !private_key_content_base64.is_empty() && final_path != existing_path {
                let _ = fs::remove_file(&final_path);
                let _ = fs::remove_file(format!("{}.pub", &final_path));
            }

            warnings.push(format!(
                "SSH key '{}' already exists and was skipped.",
                name
            ));
            continue;
        }

        tx.execute(
            "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
            (&name, &final_public_key, &final_path, &key_type, &final_fingerprint)
        )
        .map_err(|e| e.to_string())?;

        if !original_path.is_empty() {
            key_path_map.insert(original_path.clone(), final_path.clone());
        }
        key_path_map.insert(final_path.clone(), final_path.clone());

        ssh_keys_imported += 1;
    }

    let mut connection_id_map: HashMap<String, i32> = HashMap::new();
    let mut pending_secret_imports: Vec<(i32, String, String)> = Vec::new();
    let mut connections_imported = 0usize;

    for item in connections_value {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let host = item
            .get("host")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let port = item.get("port").and_then(|v| v.as_u64()).unwrap_or(22) as u16;
        let username = item
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let password = item
            .get("password")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let passphrase = item
            .get("passphrase")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let group_name = item
            .get("group_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if name.is_empty() || host.is_empty() || username.is_empty() {
            warnings.push(
                "One connection was skipped because required fields were missing.".to_string(),
            );
            continue;
        }

        let mut private_key = item
            .get("private_key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if let Some(mapped) = key_path_map.get(&private_key) {
            private_key = mapped.clone();
        } else if !private_key.is_empty() && !Path::new(&private_key).exists() {
            warnings.push(format!(
                "Connection '{}' referenced a key path that is not available on this system. The key path was cleared.",
                name
            ));
            private_key.clear();
        }

        let primary_map_key = format!("{}|{}|{}|{}|{}", name, host, port, username, group_name);
        let legacy_map_key = format!("{}|{}|{}", name, host, username);

        let existing_connection_id: Option<i32> = tx
            .query_row(
                "SELECT id FROM connections WHERE host = ?1 AND port = ?2 AND username = ?3 AND group_name = ?4 LIMIT 1",
                (&host, &port, &username, &group_name),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_id) = existing_connection_id {
            connection_id_map.insert(primary_map_key, existing_id);
            connection_id_map.insert(legacy_map_key, existing_id);
            warnings.push(format!(
                "Connection '{}' already exists and was skipped.",
                name
            ));
            continue;
        }

        tx.execute(
            "INSERT INTO connections (name, host, port, username, password, private_key, passphrase, group_name) VALUES (?1, ?2, ?3, ?4, '', ?5, '', ?6)",
            (&name, &host, &port, &username, &private_key, &group_name)
        )
        .map_err(|e| e.to_string())?;

        let new_id = tx.last_insert_rowid() as i32;
        if !password.is_empty() || !passphrase.is_empty() {
            pending_secret_imports.push((new_id, password.clone(), passphrase.clone()));
        }
        connection_id_map.insert(primary_map_key, new_id);
        connection_id_map.insert(legacy_map_key, new_id);
        connections_imported += 1;
    }

    let mut snippets_imported = 0usize;

    for item in snippets_value {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let command = item
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if let Err(err) = validate_snippet(&name, &command) {
            warnings.push(format!("One snippet was skipped: {}", err));
            continue;
        }

        let existing_snippet_id: Option<i32> = tx
            .query_row(
                "SELECT id FROM snippets WHERE name = ?1 AND command = ?2 LIMIT 1",
                (&name, &command),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if existing_snippet_id.is_some() {
            warnings.push(format!(
                "Snippet '{}' already exists and was skipped.",
                name
            ));
            continue;
        }

        tx.execute(
            "INSERT INTO snippets (name, command) VALUES (?1, ?2)",
            (&name, &command),
        )
        .map_err(|e| e.to_string())?;

        snippets_imported += 1;
    }

    let mut tunnels_imported = 0usize;

    for item in tunnels_value {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let server_name = item
            .get("server_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let server_host = item
            .get("server_host")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let server_username = item
            .get("server_username")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let server_port = item
            .get("server_port")
            .and_then(|v| v.as_u64())
            .unwrap_or(22) as u16;
        let server_group_name = item
            .get("server_group_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let local_port = item.get("local_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
        let remote_host = item
            .get("remote_host")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let remote_port = item
            .get("remote_port")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u16;
        let bind_host = item
            .get("bind_host")
            .and_then(|v| v.as_str())
            .unwrap_or("127.0.0.1")
            .trim()
            .to_string();
        let auto_start = item
            .get("auto_start")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if name.is_empty()
            || server_name.is_empty()
            || server_host.is_empty()
            || server_username.is_empty()
        {
            warnings.push("One tunnel was skipped because required fields were missing.".to_string());
            continue;
        }

        if remote_host.is_empty() || local_port == 0 || remote_port == 0 {
            warnings.push(format!(
                "Tunnel '{}' was skipped because its route is invalid.",
                name
            ));
            continue;
        }

        let bind_host = if bind_host.is_empty() {
            "127.0.0.1".to_string()
        } else {
            bind_host
        };

        let primary_map_key = format!(
            "{}|{}|{}|{}|{}",
            server_name, server_host, server_port, server_username, server_group_name
        );
        let legacy_map_key = format!("{}|{}|{}", server_name, server_host, server_username);

        let server_id = connection_id_map
            .get(&primary_map_key)
            .copied()
            .or_else(|| connection_id_map.get(&legacy_map_key).copied());

        let Some(server_id) = server_id else {
            warnings.push(format!(
                "Tunnel '{}' could not be linked to an imported connection and was skipped.",
                name
            ));
            continue;
        };

        let existing_bind_tunnel: Option<String> = tx
            .query_row(
                "SELECT name FROM ssh_tunnels WHERE bind_host = ?1 AND local_port = ?2 LIMIT 1",
                (&bind_host, &local_port),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_name) = existing_bind_tunnel {
            warnings.push(format!(
                "Tunnel '{}' was skipped because local bind address is already used by '{}'.",
                name, existing_name
            ));
            continue;
        }

        let existing_route_tunnel: Option<String> = tx
            .query_row(
                "SELECT name FROM ssh_tunnels WHERE server_id = ?1 AND local_port = ?2 AND remote_host = ?3 AND remote_port = ?4 AND bind_host = ?5 LIMIT 1",
                (&server_id, &local_port, &remote_host, &remote_port, &bind_host),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_name) = existing_route_tunnel {
            warnings.push(format!(
                "Tunnel '{}' was skipped because the same route already exists as '{}'.",
                name, existing_name
            ));
            continue;
        }

        tx.execute(
            "INSERT INTO ssh_tunnels (server_id, name, local_port, remote_host, remote_port, bind_host, auto_start) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (&server_id, &name, &local_port, &remote_host, &remote_port, &bind_host, &(if auto_start { 1 } else { 0 }))
        )
        .map_err(|e| e.to_string())?;

        tunnels_imported += 1;
    }

    tx.commit().map_err(|e| {
        cleanup_imported_key_files(&created_imported_key_paths);
        e.to_string()
    })?;

    for (connection_id, password, passphrase) in pending_secret_imports {
        upsert_vault_secret(&vault_conn, connection_id, "password", &password, &dek)?;
        upsert_vault_secret(&vault_conn, connection_id, "passphrase", &passphrase, &dek)?;
    }

    Ok(ImportBackupResult {
        settings,
        connections_imported,
        snippets_imported,
        ssh_keys_imported,
        tunnels_imported,
        notes_imported,
        notes: imported_notes,
        warnings,
    })
}
