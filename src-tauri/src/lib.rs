mod window_state;
mod window_commands;
mod backup;
mod external_commands;
mod status_bar;
mod host_keys;
mod connection_test;
mod snippets;
mod system_commands;
mod local_fs;
mod connections;
mod ssh_runtime;
mod ssh_keys;
mod pty_commands;
mod sftp_commands;
mod tunnels;
mod vault_commands;
mod app_paths;

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;

use crate::backup::{export_backup_bundle, import_backup_bundle};
use crate::app_paths::{
    get_db_path, get_key_path, get_vault_db_path, home_dir,
    maybe_relaunch_appimage_with_wayland_preload,
};
use crate::external_commands::{
    copy_text_to_clipboard, open_external_url, reveal_path_in_file_manager, set_tray_visible,
};
use crate::connections::{
    delete_connection, get_connections, save_connection, set_connection_password,
    update_connection,
};
use crate::connection_test::{
    check_host_key, test_connection, trust_host_key,
};
use crate::pty_commands::{
    close_session, resize_pty, start_local_pty, start_quick_ssh, start_ssh, write_to_pty,
};
use crate::sftp_commands::{
    cancel_transfer, sftp_delete, sftp_download, sftp_list_dir, sftp_mkdir, sftp_read_file,
    sftp_rename, sftp_upload, sftp_write_file,
};
use crate::ssh_keys::{
    delete_ssh_key, generate_ssh_key, get_managed_keys_dir, get_ssh_keys,
    save_ssh_key,
};
use crate::local_fs::{
    get_local_home_dir, get_local_roots, local_delete, local_list_dir, local_mkdir,
    local_read_file, local_rename, local_write_file,
};
use crate::snippets::{add_snippet, delete_snippet, get_snippets, update_snippet};
use crate::tunnels::{
    TunnelRuntimeEntry, delete_tunnel, get_active_tunnels, get_tunnels, save_tunnel,
    start_tunnel, stop_tunnel, update_tunnel,
};
use crate::status_bar::get_status_bar_info;
use crate::system_commands::{measure_tcp_latency, read_clipboard, write_clipboard};
use crate::window_state::{is_wayland_session, restore_main_window_state, save_main_window_state};
use crate::vault_commands::{
    change_vault_master_password, disable_vault_protection, enable_vault_protection,
    get_vault_status, lock_vault, regenerate_vault_recovery_key,
    reset_vault_master_password_with_recovery_key, unlock_vault, update_vault_unlock_mode,
    validate_vault_recovery_key,
};
use crate::window_commands::{
    current_window_is_maximized, current_window_minimize, current_window_start_dragging,
    current_window_toggle_maximize, get_app_meta, get_linux_window_mode, save_window_state_all,
    window_close_main, window_is_maximized, window_minimize, window_start_dragging,
    window_toggle_maximize,
};

#[derive(Debug, Serialize)]
pub struct LinuxWindowModeInfo {
    wayland_undecorated: bool,
}

#[derive(Debug, Serialize)]
pub struct AppMetaInfo {
    app_version: String,
}

pub enum SshMessage {
    Input(String),
    Resize(u32, u32),
}

pub struct SshState {
    txs: Mutex<HashMap<String, Sender<SshMessage>>>,
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    tunnel_runtime: Mutex<HashMap<i32, TunnelRuntimeEntry>>,
}



pub struct VaultState {
    runtime: Mutex<VaultRuntimeState>,
}

pub struct VaultRuntimeState {
    is_unlocked: bool,
    unlock_mode: String,
    session_dek: Option<Vec<u8>>,
}

#[derive(Debug, Serialize)]
pub struct VaultStatus {
    is_initialized: bool,
    is_protected: bool,
    is_unlocked: bool,
    unlock_mode: String,
    has_legacy_master_key: bool,
}

#[derive(Debug, Serialize)]
pub struct EnableVaultProtectionResult {
    recovery_key: String,
    migrated_secret_entries: usize,
}

pub(crate) const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
const DB_BUSY_TIMEOUT_SECS: u64 = 5;
pub(crate) const VAULT_DB_FILE_NAME: &str = "vault.db";
pub(crate) const VAULT_SCHEMA_VERSION: i64 = 1;
pub(crate) const DEFAULT_VAULT_UNLOCK_MODE: &str = "demand";
pub(crate) const VAULT_SALT_LEN: usize = 16;
pub(crate) const VAULT_KEY_LEN: usize = 32;
const VAULT_NONCE_LEN: usize = 12;
pub(crate) const VAULT_VALIDATION_TEXT: &[u8] = b"terminassh-vault-ok";

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

pub(crate) fn init_vault_db() -> Result<(), String> {
    let conn = open_vault_db()?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            is_protected INTEGER NOT NULL DEFAULT 0,
            unlock_mode TEXT NOT NULL DEFAULT 'demand',
            salt BLOB NOT NULL DEFAULT X'',
            encrypted_dek BLOB NOT NULL DEFAULT X'',
            local_dek BLOB NOT NULL DEFAULT X'',
            recovery_encrypted_dek BLOB NOT NULL DEFAULT X'',
            kek_validation BLOB NOT NULL DEFAULT X'',
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS secrets (
            connection_id INTEGER NOT NULL,
            secret_type TEXT NOT NULL,
            encrypted_data BLOB NOT NULL DEFAULT X'',
            nonce BLOB NOT NULL DEFAULT X'',
            PRIMARY KEY (connection_id, secret_type)
        );",
    )
    .map_err(|e| e.to_string())?;

    ignore_duplicate_column_error(conn.execute(
        "ALTER TABLE meta ADD COLUMN local_dek BLOB NOT NULL DEFAULT X''",
        [],
    ))?;

    let meta_exists: Option<i64> = conn
        .query_row("SELECT id FROM meta WHERE id = 1 LIMIT 1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;

    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         CREATE TABLE IF NOT EXISTS secrets_new (
             connection_id INTEGER NOT NULL,
             secret_type TEXT NOT NULL,
             encrypted_data BLOB NOT NULL DEFAULT X'',
             nonce BLOB NOT NULL DEFAULT X'',
             PRIMARY KEY (connection_id, secret_type)
         );
         INSERT OR REPLACE INTO secrets_new (connection_id, secret_type, encrypted_data, nonce)
         SELECT connection_id, secret_type, encrypted_data, nonce FROM secrets;
         DROP TABLE secrets;
         ALTER TABLE secrets_new RENAME TO secrets;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| e.to_string())?;

    if meta_exists.is_none() {
        let now = current_export_timestamp();
        conn.execute(
            "INSERT INTO meta (
                id,
                schema_version,
                is_protected,
                unlock_mode,
                created_at,
                updated_at
            ) VALUES (1, ?1, 0, ?2, ?3, ?3)",
            (&VAULT_SCHEMA_VERSION, &DEFAULT_VAULT_UNLOCK_MODE, &now),
        )
        .map_err(|e| e.to_string())?;
    } else {
        let now = current_export_timestamp();
        conn.execute(
            "UPDATE meta
             SET schema_version = ?1,
                 unlock_mode = CASE
                     WHEN TRIM(COALESCE(unlock_mode, '')) = '' THEN ?2
                     ELSE unlock_mode
                 END,
                 updated_at = CASE
                     WHEN TRIM(COALESCE(updated_at, '')) = '' THEN ?3
                     ELSE updated_at
                 END
             WHERE id = 1",
            (&VAULT_SCHEMA_VERSION, &DEFAULT_VAULT_UNLOCK_MODE, &now),
        )
        .map_err(|e| e.to_string())?;
    }

    let is_protected: i32 = conn
        .query_row(
            "SELECT is_protected FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if is_protected == 0 {
        let _ = ensure_unprotected_vault_dek(&conn)?;
    }

    Ok(())
}

pub(crate) fn load_vault_status(
    conn: &Connection,
    runtime: &VaultRuntimeState,
) -> Result<VaultStatus, String> {
    let row: Option<(i32, String)> = conn
        .query_row(
            "SELECT is_protected, unlock_mode FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (is_protected, unlock_mode) = row.unwrap_or((0, DEFAULT_VAULT_UNLOCK_MODE.to_string()));

    let effective_unlock_mode = if unlock_mode.trim().is_empty() {
        runtime.unlock_mode.clone()
    } else {
        unlock_mode
    };

    Ok(VaultStatus {
        is_initialized: true,
        is_protected: is_protected != 0,
        is_unlocked: runtime.is_unlocked
            && runtime
                .session_dek
                .as_ref()
                .map(|value| !value.is_empty())
                .unwrap_or(false),
        unlock_mode: effective_unlock_mode,
        has_legacy_master_key: Path::new(&get_key_path()).exists(),
    })
}

pub(crate) fn normalize_vault_unlock_mode(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "startup" => "startup".to_string(),
        "demand" => "demand".to_string(),
        _ => DEFAULT_VAULT_UNLOCK_MODE.to_string(),
    }
}

fn create_argon2() -> Result<Argon2<'static>, String> {
    let params = Params::new(19_456, 3, 1, Some(VAULT_KEY_LEN))
        .map_err(|e| format!("Argon2 params failed: {}", e))?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

pub(crate) fn derive_vault_key_from_secret(secret: &str, salt: &[u8]) -> Result<[u8; VAULT_KEY_LEN], String> {
    if secret.trim().is_empty() {
        return Err("Secret is empty".to_string());
    }
    if salt.len() < VAULT_SALT_LEN {
        return Err("Vault salt is invalid".to_string());
    }

    let argon2 = create_argon2()?;
    let mut out = [0u8; VAULT_KEY_LEN];
    argon2
        .hash_password_into(secret.as_bytes(), salt, &mut out)
        .map_err(|e| format!("Argon2 derive failed: {}", e))?;
    Ok(out)
}

pub(crate) fn vault_encrypt_combined(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != VAULT_KEY_LEN {
        return Err("Vault key length is invalid".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; VAULT_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(combined)
}

pub(crate) fn vault_decrypt_combined(key: &[u8], combined: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != VAULT_KEY_LEN {
        return Err("Vault key length is invalid".to_string());
    }
    if combined.len() < VAULT_NONCE_LEN {
        return Err("Vault payload is too short".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&combined[..VAULT_NONCE_LEN]);
    cipher
        .decrypt(nonce, &combined[VAULT_NONCE_LEN..])
        .map_err(|_| "Vault decrypt failed".to_string())
}

fn vault_encrypt_secret_value(dek: &[u8], plaintext: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    if dek.len() != VAULT_KEY_LEN {
        return Err("Vault DEK length is invalid".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(dek).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; VAULT_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

pub(crate) fn generate_recovery_key() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 20];
    OsRng.fill_bytes(&mut bytes);

    let mut parts: Vec<String> = Vec::new();
    for chunk in bytes.chunks(4) {
        let part: String = chunk
            .iter()
            .map(|byte| ALPHABET[(*byte as usize) % ALPHABET.len()] as char)
            .collect();
        parts.push(part);
    }
    parts.join("-")
}

pub(crate) fn upsert_vault_secret(
    vault_conn: &Connection,
    connection_id: i32,
    secret_type: &str,
    secret_value: &str,
    dek: &[u8],
) -> Result<(), String> {
    if secret_value.is_empty() {
        return Ok(());
    }

    let (encrypted_data, nonce) = vault_encrypt_secret_value(dek, secret_value)?;
    vault_conn
        .execute(
            "INSERT INTO secrets (connection_id, secret_type, encrypted_data, nonce)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(connection_id, secret_type)
             DO UPDATE SET encrypted_data = excluded.encrypted_data, nonce = excluded.nonce",
            (&connection_id, &secret_type, &encrypted_data, &nonce),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate_legacy_secrets_into_vault(
    conn_db: &Connection,
    vault_conn: &Connection,
    dek: &[u8],
) -> Result<usize, String> {
    let mut stmt = conn_db
        .prepare("SELECT id, password, passphrase FROM connections ORDER BY id ASC")
        .map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut migrated = 0usize;

    for item in iter {
        let (connection_id, legacy_password, legacy_passphrase) =
            item.map_err(|e| e.to_string())?;

        if !legacy_password.trim().is_empty() {
            let plain = decrypt_pw(&legacy_password)?;
            if !plain.is_empty() {
                upsert_vault_secret(vault_conn, connection_id, "password", &plain, dek)?;
                migrated += 1;
            }
        }

        if !legacy_passphrase.trim().is_empty() {
            let plain = decrypt_pw(&legacy_passphrase)?;
            if !plain.is_empty() {
                upsert_vault_secret(vault_conn, connection_id, "passphrase", &plain, dek)?;
                migrated += 1;
            }
        }
    }

    Ok(migrated)
}

fn read_legacy_master_key() -> Result<[u8; 32], String> {
    let key_path = PathBuf::from(get_key_path());
    if !key_path.exists() {
        return Err("Legacy master.key not found".to_string());
    }

    let key_base64 = fs::read_to_string(&key_path).map_err(|e| e.to_string())?;
    let key_bytes = STANDARD
        .decode(key_base64.trim())
        .map_err(|_| "Legacy master.key is invalid".to_string())?;

    if key_bytes.len() != 32 {
        return Err("Legacy master.key length is invalid".to_string());
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    Ok(key)
}

pub(crate) fn delete_legacy_master_key() -> Result<(), String> {
    let key_path = PathBuf::from(get_key_path());
    if !key_path.exists() {
        return Ok(());
    }
    wipe_and_remove_file(&key_path)
}

pub(crate) fn count_legacy_secret_entries(conn_db: &Connection) -> Result<usize, String> {
    let counts: (Option<i64>, Option<i64>) = conn_db
        .query_row(
            "SELECT
                SUM(CASE WHEN TRIM(COALESCE(password, '')) <> '' THEN 1 ELSE 0 END),
                SUM(CASE WHEN TRIM(COALESCE(passphrase, '')) <> '' THEN 1 ELSE 0 END)
             FROM connections",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    Ok((counts.0.unwrap_or(0) + counts.1.unwrap_or(0)) as usize)
}

fn clear_legacy_connection_secrets(conn_db: &Connection) -> Result<(), String> {
    conn_db
        .execute(
            "UPDATE connections
             SET password = '', passphrase = ''
             WHERE TRIM(COALESCE(password, '')) <> ''
                OR TRIM(COALESCE(passphrase, '')) <> ''",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn finalize_legacy_master_key_cleanup_with_dek(
    conn_db: &Connection,
    vault_conn: &Connection,
    dek: &[u8],
) -> Result<usize, String> {
    let mut migrated = 0usize;

    if count_legacy_secret_entries(conn_db)? > 0 {
        migrated = migrate_legacy_secrets_into_vault(conn_db, vault_conn, dek)?;
        clear_legacy_connection_secrets(conn_db)?;
        let _ = conn_db.execute_batch("VACUUM;");
    }

    let key_path = PathBuf::from(get_key_path());
    if key_path.exists() {
        wipe_and_remove_file(&key_path)?;
    }

    Ok(migrated)
}

fn ensure_unprotected_vault_dek(vault_conn: &Connection) -> Result<Vec<u8>, String> {
    let local_dek: Option<Vec<u8>> = vault_conn
        .query_row(
            "SELECT local_dek FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(value) = local_dek {
        if value.len() == VAULT_KEY_LEN {
            return Ok(value);
        }
    }

    let mut dek = [0u8; VAULT_KEY_LEN];
    OsRng.fill_bytes(&mut dek);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET local_dek = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&dek.to_vec(), &now),
        )
        .map_err(|e| e.to_string())?;

    Ok(dek.to_vec())
}

pub(crate) fn ensure_vault_runtime_ready(vault_state: &State<'_, VaultState>) -> Result<(), String> {
    init_vault_db()?;
    let conn_db = open_db()?;
    let vault_conn = open_vault_db()?;

    let row: (i32, String, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, local_dek
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let normalized_unlock_mode = normalize_vault_unlock_mode(&row.1);

    if row.0 == 0 {
        let dek = if row.2.len() == VAULT_KEY_LEN {
            row.2.clone()
        } else {
            ensure_unprotected_vault_dek(&vault_conn)?
        };

        let legacy_secret_entries = count_legacy_secret_entries(&conn_db)?;
        if legacy_secret_entries > 0 {
            migrate_legacy_secrets_into_vault(&conn_db, &vault_conn, &dek)?;
            clear_legacy_connection_secrets(&conn_db)?;
        }

        if Path::new(&get_key_path()).exists() {
            delete_legacy_master_key()?;
        }

        let mut runtime = vault_state
            .runtime
            .lock()
            .map_err(|_| "Vault state lock failed".to_string())?;
        runtime.is_unlocked = true;
        runtime.unlock_mode = normalized_unlock_mode;
        runtime.session_dek = Some(dek);
        return Ok(());
    }

    if !row.2.is_empty() {
        let now = current_export_timestamp();
        vault_conn
            .execute(
                "UPDATE meta
                 SET local_dek = X'',
                     updated_at = ?1
                 WHERE id = 1",
                (&now,),
            )
            .map_err(|e| e.to_string())?;
    }

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.unlock_mode = normalized_unlock_mode;

    if !(runtime.is_unlocked
        && runtime
            .session_dek
            .as_ref()
            .map(|value| !value.is_empty())
            .unwrap_or(false))
    {
        runtime.is_unlocked = false;
        runtime.session_dek = None;
    }

    Ok(())
}

fn is_vault_protected(vault_conn: &Connection) -> Result<bool, String> {
    let value: Option<i32> = vault_conn
        .query_row(
            "SELECT is_protected FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value.unwrap_or(0) != 0)
}

fn get_runtime_vault_dek(vault_state: &State<'_, VaultState>) -> Result<Option<Vec<u8>>, String> {
    let runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    Ok(runtime.session_dek.clone())
}

pub(crate) fn require_runtime_vault_dek(
    _vault_conn: &Connection,
    vault_state: &State<'_, VaultState>,
) -> Result<Vec<u8>, String> {
    ensure_vault_runtime_ready(vault_state)?;

    let dek = get_runtime_vault_dek(vault_state)?;
    match dek {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err("Vault is locked".to_string()),
    }
}

pub(crate) fn read_vault_secret_plaintext(
    vault_conn: &Connection,
    connection_id: i32,
    secret_type: &str,
    dek: &[u8],
) -> Result<String, String> {
    let row: Option<(Vec<u8>, Vec<u8>)> = vault_conn
        .query_row(
            "SELECT encrypted_data, nonce
             FROM secrets
             WHERE connection_id = ?1 AND secret_type = ?2
             LIMIT 1",
            (&connection_id, &secret_type),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((encrypted_data, nonce)) = row else {
        return Ok(String::new());
    };

    let mut combined = nonce;
    combined.extend_from_slice(&encrypted_data);
    let plain = vault_decrypt_combined(dek, &combined)?;
    String::from_utf8(plain).map_err(|_| "Vault secret is not valid UTF 8".to_string())
}

fn delete_vault_secret(
    vault_conn: &Connection,
    connection_id: i32,
    secret_type: &str,
) -> Result<(), String> {
    vault_conn
        .execute(
            "DELETE FROM secrets WHERE connection_id = ?1 AND secret_type = ?2",
            (&connection_id, &secret_type),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn wipe_and_remove_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let wipe_len = fs::metadata(path).map(|m| m.len()).unwrap_or(64).max(64) as usize;
    let _ = fs::write(path, vec![0u8; wipe_len]);
    fs::remove_file(path).map_err(|e| e.to_string())
}

fn migrate_legacy_master_key_to_vault() -> Result<(), String> {
    let key_path = PathBuf::from(get_key_path());
    if !key_path.exists() {
        return Ok(());
    }

    init_vault_db()?;
    let conn_db = open_db()?;
    let legacy_secret_entries = count_legacy_secret_entries(&conn_db)?;

    if legacy_secret_entries == 0 {
        wipe_and_remove_file(&key_path)?;
        return Ok(());
    }

    let vault_conn = open_vault_db()?;

    if is_vault_protected(&vault_conn)? {
        return Ok(());
    }

    let dek = ensure_unprotected_vault_dek(&vault_conn)?;
    migrate_legacy_secrets_into_vault(&conn_db, &vault_conn, &dek)?;
    clear_legacy_connection_secrets(&conn_db)?;
    let _ = conn_db.execute_batch("VACUUM;");
    wipe_and_remove_file(&key_path)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) fn current_export_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn decrypt_pw(encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let combined = STANDARD.decode(encoded).map_err(|_| "Base64 Fehler")?;
    if combined.len() < 12 {
        return Err("Verschlüsselter Text ist zu kurz".to_string());
    }
    let key = read_legacy_master_key()?;
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(&combined[..12]);
    let plaintext = cipher
        .decrypt(nonce, &combined[12..])
        .map_err(|_| "Falscher Key")?;
    String::from_utf8(plaintext).map_err(|_| "UTF8 Fehler".to_string())
}


pub(crate) mod decode_vault_with_secret {
    pub(crate) fn derive_only(secret: &str, salt: &[u8]) -> Result<[u8; crate::VAULT_KEY_LEN], String> {
        crate::derive_vault_key_from_secret(secret, salt)
    }
}

pub(crate) fn decode_vault_with_secret(
    secret: &str,
    salt: &[u8],
    encrypted_dek: &[u8],
    kek_validation: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key = derive_vault_key_from_secret(secret, salt)?;
    let dek = vault_decrypt_combined(&key, encrypted_dek)?;
    let validation = vault_decrypt_combined(&dek, kek_validation)?;
    Ok((dek, validation))
}

pub(crate) fn decode_vault_with_recovery(
    recovery_key: &str,
    salt: &[u8],
    recovery_encrypted_dek: &[u8],
    kek_validation: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    decode_vault_with_secret(recovery_key, salt, recovery_encrypted_dek, kek_validation)
}

fn ignore_duplicate_column_error(result: Result<usize, rusqlite::Error>) -> Result<(), String> {
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

fn init_db() -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    maybe_relaunch_appimage_with_wayland_preload();

    if let Err(e) = init_db() {
        eprintln!("Database init failed: {}", e);
    }

    if let Err(e) = init_vault_db() {
        eprintln!("Vault init failed: {}", e);
    }

    if let Err(e) = migrate_legacy_master_key_to_vault() {
        eprintln!("Legacy master.key migration failed: {}", e);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SshState {
            txs: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            tunnel_runtime: Mutex::new(HashMap::new()),
        })
        .manage(VaultState {
            runtime: Mutex::new(VaultRuntimeState {
                is_unlocked: false,
                unlock_mode: DEFAULT_VAULT_UNLOCK_MODE.to_string(),
                session_dek: None,
            }),
        })
        .invoke_handler(tauri::generate_handler![
            save_connection,
            get_connections,
            get_vault_status,
            enable_vault_protection,
            disable_vault_protection,
            regenerate_vault_recovery_key,
            update_vault_unlock_mode,
            validate_vault_recovery_key,
            reset_vault_master_password_with_recovery_key,
            change_vault_master_password,
            unlock_vault,
            lock_vault,
            update_connection,
            test_connection,
            set_connection_password,
            delete_connection,
            start_ssh,
            start_quick_ssh,
            start_local_pty,
            write_to_pty,
            resize_pty,
            sftp_list_dir,
            sftp_mkdir,
            sftp_rename,
            sftp_delete,
            sftp_read_file,
            sftp_write_file,
            sftp_upload,
            sftp_download,
            local_list_dir,
            local_mkdir,
            local_rename,
            local_delete,
            local_read_file,
            local_write_file,
            get_local_home_dir,
            get_local_roots,
            close_session,
            measure_tcp_latency,
            get_linux_window_mode,
            get_app_meta,
            window_minimize,
            window_toggle_maximize,
            window_is_maximized,
            window_start_dragging,
            current_window_minimize,
            current_window_toggle_maximize,
            current_window_is_maximized,
            current_window_start_dragging,
            save_window_state_all,
            window_close_main,
            get_status_bar_info,
            cancel_transfer,
            write_clipboard,
            read_clipboard,
            get_snippets,
            add_snippet,
            update_snippet,
            delete_snippet,
            get_managed_keys_dir,
            export_backup_bundle,
            import_backup_bundle,
            get_ssh_keys,
            save_ssh_key,
            delete_ssh_key,
            generate_ssh_key,
            get_tunnels,
            save_tunnel,
            update_tunnel,
            delete_tunnel,
            open_external_url,
            reveal_path_in_file_manager,
            copy_text_to_clipboard,
            set_tray_visible,
            start_tunnel,
            stop_tunnel,
            get_active_tunnels,
            check_host_key,
            trust_host_key,
        ])
        .setup(|app| {
            if let Err(e) = ensure_vault_runtime_ready(&app.state::<VaultState>()) {
                eprintln!("Vault runtime init failed: {}", e);
            }

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "linux")]
                {
                    let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
                        || std::env::var("XDG_SESSION_TYPE")
                            .map(|value| value.eq_ignore_ascii_case("wayland"))
                            .unwrap_or(false);

                    let _ = window.set_decorations(!is_wayland);
                }

                #[cfg(not(target_os = "linux"))]
                {
                    let _ = window.set_decorations(true);
                }

                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("Termina SSH v{}", version));
                let _ = restore_main_window_state(&window);

                if !is_wayland_session() {
                    let save_events_enabled = Arc::new(AtomicBool::new(false));
                    let save_events_enabled_for_events = Arc::clone(&save_events_enabled);
                    let window_for_events = window.clone();

                    window.on_window_event(move |event| {
                        if !save_events_enabled_for_events.load(Ordering::Relaxed) {
                            return;
                        }

                        match event {
                            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                                let _ = save_main_window_state(&window_for_events);
                            }
                            _ => {}
                        }
                    });

                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(1200));
                        save_events_enabled.store(true, Ordering::Relaxed);
                    });
                }
            }

            let show_item = MenuItem::with_id(app, "tray_show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "tray_quit" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = save_main_window_state(&window);
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray-quit-requested", true);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            let tray_result = if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder.icon(icon).build(app)
            } else {
                tray_builder.build(app)
            };

            if let Ok(tray) = tray_result {
                let _ = tray.set_visible(false);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten");
}

