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
mod ssh_keys;
mod pty_commands;
mod sftp_commands;
mod tunnels;

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use ssh2::{CheckResult, KnownHostFileKind, KnownHostKeyFormat, Session};
use std::collections::HashMap;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
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
use crate::external_commands::{
    copy_text_to_clipboard, open_external_url, reveal_path_in_file_manager, set_tray_visible,
};
use crate::connections::{
    delete_connection, get_connections, save_connection, set_connection_password,
    update_connection,
};
use crate::connection_test::{
    check_host_key, test_connection, trust_host_key, ConnectionTestResult,
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
use crate::host_keys::ensure_known_host_match_for_session;
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

#[derive(Debug, Clone)]
pub struct ConnectionRuntimeDetails {
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
}



#[cfg(target_os = "linux")]
fn maybe_relaunch_appimage_with_wayland_preload() {
    use std::path::Path;
    use std::process::Command;

    let appimage = match std::env::var("APPIMAGE") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return,
    };

    if std::env::var_os("TERMSSH_APPIMAGE_RELAUNCHED").is_some() {
        return;
    }

    if std::env::var_os("LD_PRELOAD").is_some() {
        return;
    }

    let candidates = [
        "/usr/lib/libwayland-client.so",
        "/usr/lib64/libwayland-client.so",
        "/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/lib64/libwayland-client.so.0",
    ];

    let preload = candidates
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .map(|candidate| (*candidate).to_string());

    let Some(preload) = preload else {
        return;
    };

    let args: Vec<String> = std::env::args().skip(1).collect();

    let spawn_result = Command::new(&appimage)
        .args(args)
        .env("LD_PRELOAD", &preload)
        .env("TERMSSH_APPIMAGE_RELAUNCHED", "1")
        .spawn();

    if spawn_result.is_ok() {
        std::process::exit(0);
    }
}

const APP_DIR_NAME: &str = "terminassh";
const LEGACY_APP_DIR_NAME: &str = "ssh-mgr";
pub(crate) const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
const DB_BUSY_TIMEOUT_SECS: u64 = 5;
const VAULT_DB_FILE_NAME: &str = "vault.db";
const VAULT_SCHEMA_VERSION: i64 = 1;
const DEFAULT_VAULT_UNLOCK_MODE: &str = "demand";
const VAULT_SALT_LEN: usize = 16;
const VAULT_KEY_LEN: usize = 32;
const VAULT_NONCE_LEN: usize = 12;
const VAULT_VALIDATION_TEXT: &[u8] = b"terminassh-vault-ok";

pub(crate) fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        return Some(PathBuf::from(home));
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        return Some(PathBuf::from(user_profile));
    }

    None
}

#[cfg(target_os = "windows")]
fn get_platform_config_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata);
    }

    if let Some(home) = home_dir() {
        return home.join("AppData").join("Roaming");
    }

    PathBuf::from(".")
}

#[cfg(target_os = "macos")]
fn get_platform_config_root() -> PathBuf {
    if let Some(home) = home_dir() {
        return home.join("Library").join("Application Support");
    }

    PathBuf::from(".")
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn get_platform_config_root() -> PathBuf {
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg_config_home);
    }

    if let Some(home) = home_dir() {
        return home.join(".config");
    }

    PathBuf::from(".")
}

fn legacy_app_dirs(config_root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![config_root.join(LEGACY_APP_DIR_NAME)];

    if let Some(home) = home_dir() {
        let legacy_home_config = home.join(".config").join(LEGACY_APP_DIR_NAME);
        if !dirs.iter().any(|p| p == &legacy_home_config) {
            dirs.push(legacy_home_config);
        }
    }

    dirs
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src = entry.path();
        let dst = to.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else if file_type.is_file() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

fn migrate_legacy_app_dir(legacy_dir: &Path, new_dir: &Path) {
    if new_dir.exists() || !legacy_dir.exists() {
        return;
    }

    if fs::rename(legacy_dir, new_dir).is_ok() {
        return;
    }

    let _ = copy_dir_recursive(legacy_dir, new_dir);
}

pub(crate) fn get_app_dir() -> String {
    let config_root = get_platform_config_root();
    let new_dir = config_root.join(APP_DIR_NAME);

    if !new_dir.exists() {
        for legacy_dir in legacy_app_dirs(&config_root) {
            migrate_legacy_app_dir(&legacy_dir, &new_dir);
            if new_dir.exists() {
                break;
            }
        }
    }

    let _ = fs::create_dir_all(&new_dir);
    new_dir.to_string_lossy().to_string()
}

fn get_db_path() -> String {
    format!("{}/connections.db", get_app_dir())
}

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

fn get_vault_db_path() -> String {
    format!("{}/{}", get_app_dir(), VAULT_DB_FILE_NAME)
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

fn load_vault_status(
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

fn normalize_vault_unlock_mode(value: &str) -> String {
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

fn derive_vault_key_from_secret(secret: &str, salt: &[u8]) -> Result<[u8; VAULT_KEY_LEN], String> {
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

fn vault_encrypt_combined(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
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

fn vault_decrypt_combined(key: &[u8], combined: &[u8]) -> Result<Vec<u8>, String> {
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

fn generate_recovery_key() -> String {
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

fn delete_legacy_master_key() -> Result<(), String> {
    let key_path = PathBuf::from(get_key_path());
    if !key_path.exists() {
        return Ok(());
    }
    wipe_and_remove_file(&key_path)
}

fn count_legacy_secret_entries(conn_db: &Connection) -> Result<usize, String> {
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

fn finalize_legacy_master_key_cleanup_with_dek(
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

fn ensure_vault_runtime_ready(vault_state: &State<'_, VaultState>) -> Result<(), String> {
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

fn read_vault_secret_plaintext(
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

fn get_key_path() -> String {
    format!("{}/master.key", get_app_dir())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) fn get_keys_dir() -> String {
    let dir = format!("{}/keys", get_app_dir());
    let _ = fs::create_dir_all(&dir);
    dir
}


pub(crate) fn read_file_base64_if_exists(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if !Path::new(trimmed).exists() {
        return String::new();
    }

    fs::read(trimmed)
        .map(|bytes| STANDARD.encode(bytes))
        .unwrap_or_default()
}

pub(crate) fn sanitize_key_file_stem(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if cleaned.is_empty() {
        "imported_key".to_string()
    } else {
        cleaned
    }
}

pub(crate) fn ensure_unique_key_path(dir: &str, stem: &str) -> String {
    let mut candidate = format!("{}/{}", dir, stem);
    let mut index = 1usize;

    while Path::new(&candidate).exists() || Path::new(&format!("{}.pub", candidate)).exists() {
        candidate = format!("{}/{}_{}", dir, stem, index);
        index += 1;
    }

    candidate
}

fn default_ssh_private_key_paths() -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };

    let ssh_dir = home.join(".ssh");

    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| ssh_dir.join(name))
        .collect()
}

pub(crate) fn cleanup_imported_key_files(paths: &[String]) {
    for private_path in paths {
        let _ = fs::remove_file(private_path);
        let _ = fs::remove_file(format!("{}.pub", private_path));
    }
}

fn try_auth_with_private_key(
    sess: &Session,
    username: &str,
    private_key: &str,
    passphrase: Option<&str>,
) -> bool {
    let trimmed = private_key.trim();
    if trimmed.is_empty() {
        return false;
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return false;
    }

    sess.userauth_pubkey_file(username, None, path, passphrase)
        .is_ok()
}

fn try_auth_with_default_keys(sess: &Session, username: &str) -> bool {
    for path in default_ssh_private_key_paths() {
        if path.exists()
            && sess
                .userauth_pubkey_file(username, None, &path, None)
                .is_ok()
        {
            return true;
        }
    }

    false
}

pub(crate) fn current_export_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub(crate) fn tcp_connect_with_timeout(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
    let addr_str = format!("{}:{}", host, port);
    let addrs: Vec<_> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("TCP Error: {}", e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("TCP Error: Could not resolve {}", addr_str));
    }

    let mut last_err: Option<std::io::Error> = None;

    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(stream) => return Ok(stream),
            Err(err) => last_err = Some(err),
        }
    }

    Err(format!(
        "TCP Error: {}",
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| format!("Could not connect to {}", addr_str))
    ))
}

pub(crate) fn authenticate_session(
    sess: &Session,
    username: &str,
    password: &str,
    private_key: &str,
    passphrase: &str,
) -> bool {
    let pass = if passphrase.is_empty() {
        None
    } else {
        Some(passphrase)
    };

    if try_auth_with_private_key(sess, username, private_key, pass) {
        return true;
    }

    if sess.userauth_agent(username).is_ok() {
        return true;
    }

    if try_auth_with_default_keys(sess, username) {
        return true;
    }

    if !password.is_empty() && sess.userauth_password(username, password).is_ok() {
        return true;
    }

    false
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

#[tauri::command]
fn get_vault_status(vault_state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    ensure_vault_runtime_ready(&vault_state)?;
    let conn = open_vault_db()?;
    let runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    load_vault_status(&conn, &runtime)
}

#[tauri::command]
fn enable_vault_protection(
    master_password: String,
    unlock_mode: String,
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    if master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    init_vault_db()?;
    let conn_db = open_db()?;
    let migrated_secret_entries = count_legacy_secret_entries(&conn_db)?;
    ensure_vault_runtime_ready(&vault_state)?;
    let vault_conn = open_vault_db()?;

    let existing: (i32, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, local_dek FROM meta WHERE id = 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if existing.0 != 0 {
        return Err("Vault protection is already enabled".to_string());
    }

    let normalized_unlock_mode = normalize_vault_unlock_mode(&unlock_mode);
    let dek = if existing.1.len() == VAULT_KEY_LEN {
        existing.1.clone()
    } else {
        require_runtime_vault_dek(&vault_conn, &vault_state)?
    };

    let mut salt = [0u8; VAULT_SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let recovery_key = generate_recovery_key();
    let master_key = derive_vault_key_from_secret(&master_password, &salt)?;
    let recovery_wrap_key = derive_vault_key_from_secret(&recovery_key, &salt)?;

    let encrypted_dek = vault_encrypt_combined(&master_key, &dek)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&recovery_wrap_key, &dek)?;
    let kek_validation = vault_encrypt_combined(&dek, VAULT_VALIDATION_TEXT)?;

    let now = current_export_timestamp();
    vault_conn
        .execute(
            "UPDATE meta
             SET schema_version = ?1,
                 is_protected = 1,
                 unlock_mode = ?2,
                 salt = ?3,
                 encrypted_dek = ?4,
                 local_dek = X'',
                 recovery_encrypted_dek = ?5,
                 kek_validation = ?6,
                 updated_at = ?7
             WHERE id = 1",
            (
                &VAULT_SCHEMA_VERSION,
                &normalized_unlock_mode,
                &salt.to_vec(),
                &encrypted_dek,
                &recovery_encrypted_dek,
                &kek_validation,
                &now,
            ),
        )
        .map_err(|e| e.to_string())?;

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

    Ok(EnableVaultProtectionResult {
        recovery_key,
        migrated_secret_entries,
    })
}

#[tauri::command]
fn update_vault_unlock_mode(
    unlock_mode: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let normalized_unlock_mode = normalize_vault_unlock_mode(&unlock_mode);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET unlock_mode = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&normalized_unlock_mode, &now),
        )
        .map_err(|e| e.to_string())?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.unlock_mode = normalized_unlock_mode;

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
fn regenerate_vault_recovery_key(
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;

    let row: (i32, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, salt
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.1.len() < VAULT_SALT_LEN {
        return Err("Vault salt is invalid".to_string());
    }

    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;
    let new_recovery_key = generate_recovery_key();
    let recovery_wrap_key = derive_vault_key_from_secret(&new_recovery_key, &row.1)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&recovery_wrap_key, &dek)?;
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET recovery_encrypted_dek = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&recovery_encrypted_dek, &now),
        )
        .map_err(|e| e.to_string())?;

    Ok(EnableVaultProtectionResult {
        recovery_key: new_recovery_key,
        migrated_secret_entries: 0,
    })
}

#[tauri::command]
fn disable_vault_protection(vault_state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let conn_db = open_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, &vault_state)?;

    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let now = current_export_timestamp();
    let unlock_mode = DEFAULT_VAULT_UNLOCK_MODE.to_string();

    vault_conn
        .execute(
            "UPDATE meta
             SET is_protected = 0,
                 unlock_mode = ?1,
                 salt = X'',
                 encrypted_dek = X'',
                 local_dek = ?2,
                 recovery_encrypted_dek = X'',
                 kek_validation = X'',
                 updated_at = ?3
             WHERE id = 1",
            (&unlock_mode, &dek, &now),
        )
        .map_err(|e| e.to_string())?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = unlock_mode;
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
fn validate_vault_recovery_key(
    recovery_key: String,
) -> Result<(), String> {
    let normalized_recovery_key = recovery_key.trim().to_ascii_uppercase();
    if normalized_recovery_key.is_empty() {
        return Err("Recovery key is empty".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, salt, recovery_encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.2.is_empty() {
        return Err("Recovery data is missing".to_string());
    }

    let recovery_wrap_key = derive_vault_key_from_secret(&normalized_recovery_key, &row.1)?;
    let dek = vault_decrypt_combined(&recovery_wrap_key, &row.2)
        .map_err(|_| "Recovery key is invalid".to_string())?;
    let validation =
        vault_decrypt_combined(&dek, &row.3).map_err(|_| "Recovery key is invalid".to_string())?;

    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Recovery key is invalid".to_string());
    }

    Ok(())
}

#[tauri::command]
fn reset_vault_master_password_with_recovery_key(
    recovery_key: String,
    new_master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<EnableVaultProtectionResult, String> {
    let normalized_recovery_key = recovery_key.trim().to_ascii_uppercase();
    if normalized_recovery_key.is_empty() {
        return Err("Recovery key is empty".to_string());
    }

    if new_master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    if new_master_password.chars().count() < 6 {
        return Err("Master password must be at least 6 characters".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, recovery_encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    if row.3.is_empty() {
        return Err("Recovery data is missing".to_string());
    }

    let recovery_wrap_key = derive_vault_key_from_secret(&normalized_recovery_key, &row.2)?;
    let dek = vault_decrypt_combined(&recovery_wrap_key, &row.3)
        .map_err(|_| "Recovery key is invalid".to_string())?;
    let validation =
        vault_decrypt_combined(&dek, &row.4).map_err(|_| "Recovery key is invalid".to_string())?;

    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Recovery key is invalid".to_string());
    }

    let mut new_salt = [0u8; VAULT_SALT_LEN];
    OsRng.fill_bytes(&mut new_salt);

    let new_recovery_key = generate_recovery_key();
    let new_master_key = derive_vault_key_from_secret(&new_master_password, &new_salt)?;
    let new_recovery_wrap_key = derive_vault_key_from_secret(&new_recovery_key, &new_salt)?;

    let encrypted_dek = vault_encrypt_combined(&new_master_key, &dek)?;
    let recovery_encrypted_dek = vault_encrypt_combined(&new_recovery_wrap_key, &dek)?;
    let kek_validation = vault_encrypt_combined(&dek, VAULT_VALIDATION_TEXT)?;

    let normalized_unlock_mode = normalize_vault_unlock_mode(&row.1);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET is_protected = 1,
                 unlock_mode = ?1,
                 salt = ?2,
                 encrypted_dek = ?3,
                 local_dek = X'',
                 recovery_encrypted_dek = ?4,
                 kek_validation = ?5,
                 updated_at = ?6
             WHERE id = 1",
            (
                &normalized_unlock_mode,
                &new_salt.to_vec(),
                &encrypted_dek,
                &recovery_encrypted_dek,
                &kek_validation,
                &now,
            ),
        )
        .map_err(|e| e.to_string())?;

    let conn_db = open_db()?;
    let migrated_secret_entries =
        finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalized_unlock_mode;
    runtime.session_dek = Some(dek);

    Ok(EnableVaultProtectionResult {
        recovery_key: new_recovery_key,
        migrated_secret_entries,
    })
}

#[tauri::command]
fn change_vault_master_password(
    current_master_password: String,
    new_master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    if current_master_password.trim().is_empty() {
        return Err("Current master password is empty".to_string());
    }

    if new_master_password.trim().is_empty() {
        return Err("New master password is empty".to_string());
    }

    if new_master_password.chars().count() < 6 {
        return Err("New master password must be at least 6 characters".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    let current_master_key = derive_vault_key_from_secret(&current_master_password, &row.2)?;
    let dek = vault_decrypt_combined(&current_master_key, &row.3)?;
    let validation = vault_decrypt_combined(&dek, &row.4)?;

    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Current master password is invalid".to_string());
    }

    let new_master_key = derive_vault_key_from_secret(&new_master_password, &row.2)?;
    let encrypted_dek = vault_encrypt_combined(&new_master_key, &dek)?;
    let normalized_unlock_mode = normalize_vault_unlock_mode(&row.1);
    let now = current_export_timestamp();

    vault_conn
        .execute(
            "UPDATE meta
             SET encrypted_dek = ?1,
                 updated_at = ?2
             WHERE id = 1",
            (&encrypted_dek, &now),
        )
        .map_err(|e| e.to_string())?;

    let conn_db = open_db()?;
    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalized_unlock_mode;
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
fn unlock_vault(
    master_password: String,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    if master_password.trim().is_empty() {
        return Err("Master password is empty".to_string());
    }

    init_vault_db()?;
    let vault_conn = open_vault_db()?;
    let row: (i32, String, Vec<u8>, Vec<u8>, Vec<u8>) = vault_conn
        .query_row(
            "SELECT is_protected, unlock_mode, salt, encrypted_dek, kek_validation
             FROM meta
             WHERE id = 1
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    if row.0 == 0 {
        return Err("Vault protection is not enabled".to_string());
    }

    let master_key = derive_vault_key_from_secret(&master_password, &row.2)?;
    let dek = vault_decrypt_combined(&master_key, &row.3)?;
    let validation = vault_decrypt_combined(&dek, &row.4)?;

    if validation.as_slice() != VAULT_VALIDATION_TEXT {
        return Err("Master password is invalid".to_string());
    }

    let conn_db = open_db()?;
    let _ = finalize_legacy_master_key_cleanup_with_dek(&conn_db, &vault_conn, &dek)?;

    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = true;
    runtime.unlock_mode = normalize_vault_unlock_mode(&row.1);
    runtime.session_dek = Some(dek);

    load_vault_status(&vault_conn, &runtime)
}

#[tauri::command]
fn lock_vault(vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut runtime = vault_state
        .runtime
        .lock()
        .map_err(|_| "Vault state lock failed".to_string())?;
    runtime.is_unlocked = false;
    runtime.session_dek = None;
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



pub(crate) fn load_connection_runtime_details(
    id: i32,
    password_override: Option<String>,
    vault_state: &State<'_, VaultState>,
) -> Result<ConnectionRuntimeDetails, String> {
    init_vault_db()?;
    ensure_vault_runtime_ready(vault_state)?;

    let conn_db = open_db()?;
    let row_data: (String, u16, String, String) = conn_db
        .query_row(
            "SELECT host, port, username, private_key FROM connections WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Connection not found".to_string(),
            _ => e.to_string(),
        })?;

    let (host, port, username, private_key) = row_data;

    let vault_conn = open_vault_db()?;
    let dek = require_runtime_vault_dek(&vault_conn, vault_state)?;

    let password = match password_override {
        Some(value) if !value.is_empty() => value,
        _ => read_vault_secret_plaintext(&vault_conn, id, "password", &dek)?,
    };
    let passphrase = read_vault_secret_plaintext(&vault_conn, id, "passphrase", &dek)?;

    Ok(ConnectionRuntimeDetails {
        host,
        port,
        username,
        password,
        private_key,
        passphrase,
    })
}

pub(crate) fn connect_runtime_details(details: &ConnectionRuntimeDetails) -> Result<Session, String> {
    let tcp = tcp_connect_with_timeout(
        &details.host,
        details.port,
        Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS),
    )?;
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake Error: {}", e))?;

    ensure_known_host_match_for_session(&sess, &details.host, details.port)?;

    if !authenticate_session(
        &sess,
        &details.username,
        &details.password,
        &details.private_key,
        &details.passphrase,
    ) {
        return Err("Authentication failed".to_string());
    }

    Ok(sess)
}

pub(crate) fn connect_ssh_session_with_password_override(
    id: i32,
    password_override: Option<String>,
    vault_state: &State<'_, VaultState>,
) -> Result<Session, String> {
    let details = load_connection_runtime_details(id, password_override, vault_state)?;
    connect_runtime_details(&details)
}

pub(crate) fn connect_ssh_session(id: i32, vault_state: &State<'_, VaultState>) -> Result<Session, String> {
    connect_ssh_session_with_password_override(id, None, vault_state)
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

