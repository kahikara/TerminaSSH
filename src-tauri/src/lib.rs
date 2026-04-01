mod window_state;
mod window_commands;
mod backup;
mod external_commands;
mod status_bar;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ssh2::{CheckResult, HashType, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::backup::{export_backup_bundle, import_backup_bundle};
use crate::external_commands::{
    copy_text_to_clipboard, open_external_url, reveal_path_in_file_manager, set_tray_visible,
};
use crate::status_bar::get_status_bar_info;
use crate::window_state::{is_wayland_session, restore_main_window_state, save_main_window_state};
use crate::window_commands::{
    current_window_is_maximized, current_window_minimize, current_window_start_dragging,
    current_window_toggle_maximize, get_app_meta, get_linux_window_mode, save_window_state_all,
    window_close_main, window_is_maximized, window_minimize, window_start_dragging,
    window_toggle_maximize,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct SshConnection {
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
pub struct ConnectionItem {
    id: i32,
    name: String,
    host: String,
    port: u16,
    username: String,
    private_key: String,
    group_name: String,
    has_password: bool,
}
#[derive(Debug, Serialize)]
pub struct FileItem {
    name: String,
    is_dir: bool,
    size: u64,
}

#[derive(Debug, Serialize)]
pub struct SftpReadFilePayload {
    content_base64: String,
}

#[derive(Clone, Serialize)]
pub struct SftpProgress {
    transferred: u64,
    total: u64,
    speed: f64,
    current_file: String,
}
#[derive(Debug, Serialize)]
pub struct SnippetItem {
    id: i32,
    name: String,
    command: String,
}

#[derive(Debug, Serialize)]
pub struct SshKeyItem {
    id: i32,
    name: String,
    public_key: String,
    private_key_path: String,
    key_type: String,
    fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SshTunnel {
    name: String,
    server_id: i32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_host: String,
    auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct TunnelItem {
    id: i32,
    name: String,
    server_id: i32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_host: String,
    auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct ActiveTunnelItem {
    id: i32,
}


#[derive(Debug, Serialize)]
pub struct HostKeyCheckInfo {
    host: String,
    port: u16,
    display_host: String,
    key_type: String,
    fingerprint: String,
    status: String,
    known_hosts_path: String,
}

#[derive(Debug, Serialize)]
pub struct ConnectionTestResult {
    success: bool,
    auth_ok: bool,
    sftp_ok: bool,
    host_key_status: String,
    key_type: String,
    fingerprint: String,
    message: String,
}

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

pub struct TunnelRuntimeEntry {
    stop_flag: Arc<AtomicBool>,
    handle: JoinHandle<()>,
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

fn take_finished_tunnel_entries(
    state: &State<'_, SshState>,
) -> Result<Vec<TunnelRuntimeEntry>, String> {
    let mut map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;

    let finished_ids: Vec<i32> = map
        .iter()
        .filter_map(|(id, entry)| entry.handle.is_finished().then_some(*id))
        .collect();

    let mut entries = Vec::new();
    for id in finished_ids {
        if let Some(entry) = map.remove(&id) {
            entries.push(entry);
        }
    }

    Ok(entries)
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

fn emit_session_exit_once(app: &AppHandle, session_id: &str, sent: &Arc<AtomicBool>) {
    if !sent.swap(true, Ordering::Relaxed) {
        let _ = app.emit(&format!("term-exit-{}", session_id), true);
    }
}

fn sanitize_local_shell_env(cmd: &mut CommandBuilder) {
    for key in [
        "APPIMAGE",
        "APPDIR",
        "OWD",
        "ARGV0",
        "TERMSSH_APPIMAGE_RELAUNCHED",
    ] {
        cmd.env_remove(key);
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    for key in [
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "LD_AUDIT",
        "LD_DEBUG",
        "LD_ASSUME_KERNEL",
        "LD_BIND_NOW",
    ] {
        cmd.env_remove(key);
    }

    #[cfg(target_os = "macos")]
    for key in [
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
        "DYLD_FALLBACK_LIBRARY_PATH",
        "DYLD_FALLBACK_FRAMEWORK_PATH",
        "DYLD_INSERT_LIBRARIES",
    ] {
        cmd.env_remove(key);
    }
}

const APP_DIR_NAME: &str = "terminassh";
const LEGACY_APP_DIR_NAME: &str = "ssh-mgr";
const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
const DB_BUSY_TIMEOUT_SECS: u64 = 5;
const VAULT_DB_FILE_NAME: &str = "vault.db";
const VAULT_SCHEMA_VERSION: i64 = 1;
const DEFAULT_VAULT_UNLOCK_MODE: &str = "demand";
const VAULT_SALT_LEN: usize = 16;
const VAULT_KEY_LEN: usize = 32;
const VAULT_NONCE_LEN: usize = 12;
const VAULT_VALIDATION_TEXT: &[u8] = b"terminassh-vault-ok";

fn home_dir() -> Option<PathBuf> {
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

fn get_known_hosts_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or("Could not determine home directory".to_string())?;
    let ssh_dir = home.join(".ssh");
    fs::create_dir_all(&ssh_dir).map_err(|e| e.to_string())?;
    Ok(ssh_dir.join("known_hosts"))
}

fn format_known_host_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

fn host_key_type_label(kind: HostKeyType) -> String {
    match kind {
        HostKeyType::Rsa => "RSA".to_string(),
        HostKeyType::Dss => "DSA".to_string(),
        HostKeyType::Ecdsa256 => "ECDSA-256".to_string(),
        HostKeyType::Ecdsa384 => "ECDSA-384".to_string(),
        HostKeyType::Ecdsa521 => "ECDSA-521".to_string(),
        HostKeyType::Ed25519 => "ED25519".to_string(),
        HostKeyType::Unknown => "UNKNOWN".to_string(),
    }
}

fn host_key_sha256_fingerprint(sess: &Session) -> String {
    match sess.host_key_hash(HashType::Sha256) {
        Some(bytes) => {
            let encoded = STANDARD.encode(bytes);
            format!("SHA256:{}", encoded.trim_end_matches('='))
        }
        None => "unknown".to_string(),
    }
}

fn read_known_hosts_file(known_hosts: &mut ssh2::KnownHosts, path: &Path) -> Result<(), String> {
    if path.exists() {
        known_hosts
            .read_file(path, KnownHostFileKind::OpenSSH)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_openssh_ssh_keygen_path() -> Option<PathBuf> {
    let system_root = std::env::var_os("SystemRoot")?;
    let candidate = PathBuf::from(system_root)
        .join("System32")
        .join("OpenSSH")
        .join("ssh-keygen.exe");

    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

fn run_ssh_keygen(args: &[&str]) -> Result<std::process::Output, String> {
    match Command::new("ssh-keygen").args(args).output() {
        Ok(output) => Ok(output),
        Err(err) => {
            #[cfg(target_os = "windows")]
            {
                if err.kind() == std::io::ErrorKind::NotFound {
                    if let Some(path) = windows_openssh_ssh_keygen_path() {
                        return Command::new(path)
                            .args(args)
                            .output()
                            .map_err(|fallback_err| {
                                format!(
                                    "ssh-keygen could not be started from PATH or Windows OpenSSH path: {}",
                                    fallback_err
                                )
                            });
                    }

                    return Err(
                        "ssh-keygen was not found. Install the Windows OpenSSH Client or add ssh-keygen to PATH."
                            .to_string(),
                    );
                }
            }

            Err(format!("failed to start ssh-keygen: {}", err))
        }
    }
}

fn remove_known_host_entry_with_ssh_keygen(host: &str, port: u16, path: &Path) {
    let path_str = path.to_string_lossy().to_string();
    let target = format_known_host_name(host, port);

    let _ = run_ssh_keygen(&["-R", &target, "-f", &path_str]);

    if port == 22 {
        let _ = run_ssh_keygen(&["-R", host, "-f", &path_str]);
    }
}

fn check_known_host_status_for_session(
    sess: &Session,
    host: &str,
    port: u16,
    key: &[u8],
) -> Result<String, String> {
    let mut known_hosts = sess.known_hosts().map_err(|e| e.to_string())?;
    let known_hosts_path = get_known_hosts_path()?;
    read_known_hosts_file(&mut known_hosts, &known_hosts_path)?;

    let status = match known_hosts.check_port(host, port, key) {
        CheckResult::Match => "match",
        CheckResult::NotFound => "not_found",
        CheckResult::Mismatch => "mismatch",
        CheckResult::Failure => "failure",
    };

    Ok(status.to_string())
}

fn ensure_known_host_match_for_session(
    sess: &Session,
    host: &str,
    port: u16,
) -> Result<(), String> {
    let (key, _) = sess
        .host_key()
        .ok_or("Could not read remote host key".to_string())?;

    let status = check_known_host_status_for_session(sess, host, port, key)?;
    let display_host = format_known_host_name(host, port);

    match status.as_str() {
        "match" => Ok(()),
        "not_found" => Err(format!(
            "Host key for {} is not trusted yet. Trust the host before connecting.",
            display_host
        )),
        "mismatch" => Err(format!(
            "Stored host key for {} does not match the current server. Review and replace it before connecting.",
            display_host
        )),
        _ => Err(format!(
            "Host key verification failed for {}.",
            display_host
        )),
    }
}

fn probe_host_key(
    host: &str,
    port: u16,
) -> Result<(Session, Vec<u8>, HostKeyType, String), String> {
    let tcp = tcp_connect_with_timeout(host, port, Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS))?;

    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake Error: {}", e))?;

    let (key_bytes, key_type) = {
        let (key, key_type) = sess
            .host_key()
            .ok_or("Could not read remote host key".to_string())?;
        (key.to_vec(), key_type)
    };

    let fingerprint = host_key_sha256_fingerprint(&sess);

    Ok((sess, key_bytes, key_type, fingerprint))
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

fn tcp_connect_with_timeout(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, String> {
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

fn authenticate_session(
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

#[tauri::command]
fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}
#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_snippets() -> Result<Vec<SnippetItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, command FROM snippets ORDER BY name COLLATE NOCASE ASC")
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([], |row| {
            Ok(SnippetItem {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut res = Vec::new();
    for item in iter {
        res.push(item.map_err(|e| e.to_string())?);
    }
    Ok(res)
}
#[tauri::command]
fn add_snippet(name: String, command: String, app: AppHandle) -> Result<String, String> {
    let name = normalize_snippet_name(&name);
    validate_snippet(&name, &command)?;

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO snippets (name, command) VALUES (?1, ?2)",
        (&name, &command),
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit("snippets-updated", ());
    Ok("Snippet saved".to_string())
}
#[tauri::command]
fn update_snippet(
    id: i32,
    name: String,
    command: String,
    app: AppHandle,
) -> Result<String, String> {
    let name = normalize_snippet_name(&name);
    validate_snippet(&name, &command)?;

    let conn = open_db()?;
    let updated = conn
        .execute(
            "UPDATE snippets SET name = ?1, command = ?2 WHERE id = ?3",
            (&name, &command, &id),
        )
        .map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Snippet not found".to_string());
    }

    let _ = app.emit("snippets-updated", ());
    Ok("Snippet updated".to_string())
}
#[tauri::command]
fn delete_snippet(id: i32, app: AppHandle) -> Result<String, String> {
    let conn = open_db()?;
    let deleted = conn
        .execute("DELETE FROM snippets WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("Snippet not found".to_string());
    }

    let _ = app.emit("snippets-updated", ());
    Ok("Snippet deleted".to_string())
}

#[tauri::command]
fn get_connections() -> Result<Vec<ConnectionItem>, String> {
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

fn normalize_connection_fields(connection: &mut SshConnection) {
    connection.name = connection.name.trim().to_string();
    connection.host = connection.host.trim().to_string();
    connection.username = connection.username.trim().to_string();
    connection.private_key = connection.private_key.trim().to_string();
    connection.group_name = connection.group_name.trim().to_string();
}

fn normalize_tunnel_fields(tunnel: &mut SshTunnel) {
    tunnel.name = tunnel.name.trim().to_string();
    tunnel.remote_host = tunnel.remote_host.trim().to_string();
    tunnel.bind_host = tunnel.bind_host.trim().to_string();
}

fn validate_connection(connection: &SshConnection) -> Result<(), String> {
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

fn ensure_connection_exists(conn: &Connection, id: i32) -> Result<(), String> {
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

fn ensure_tunnel_route_is_unique(
    conn: &Connection,
    tunnel: &SshTunnel,
    bind_host: &str,
    exclude_id: Option<i32>,
) -> Result<(), String> {
    let existing: Option<String> = if let Some(exclude_id) = exclude_id {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE server_id = ?1 AND local_port = ?2 AND remote_host = ?3 AND remote_port = ?4 AND bind_host = ?5 AND id != ?6 LIMIT 1",
            (
                &tunnel.server_id,
                &tunnel.local_port,
                &tunnel.remote_host,
                &tunnel.remote_port,
                &bind_host,
                &exclude_id,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE server_id = ?1 AND local_port = ?2 AND remote_host = ?3 AND remote_port = ?4 AND bind_host = ?5 LIMIT 1",
            (
                &tunnel.server_id,
                &tunnel.local_port,
                &tunnel.remote_host,
                &tunnel.remote_port,
                &bind_host,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(name) = existing {
        Err(format!(
            "A tunnel with the same route already exists: {}",
            name
        ))
    } else {
        Ok(())
    }
}

fn ensure_tunnel_bind_target_is_unique(
    conn: &Connection,
    bind_host: &str,
    local_port: u16,
    exclude_id: Option<i32>,
) -> Result<(), String> {
    let existing: Option<String> = if let Some(exclude_id) = exclude_id {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE bind_host = ?1 AND local_port = ?2 AND id != ?3 LIMIT 1",
            (&bind_host, &local_port, &exclude_id),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE bind_host = ?1 AND local_port = ?2 LIMIT 1",
            (&bind_host, &local_port),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(name) = existing {
        Err(format!(
            "Local bind address is already used by tunnel: {}",
            name
        ))
    } else {
        Ok(())
    }
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

fn normalize_snippet_name(name: &str) -> String {
    name.trim().to_string()
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

fn normalize_ssh_key_name(name: &str) -> String {
    name.trim().to_string()
}

fn normalize_ssh_key_type(key_type: &str) -> String {
    let normalized = key_type.trim().to_lowercase();
    if normalized.is_empty() {
        "imported".to_string()
    } else {
        normalized
    }
}

fn ensure_ssh_key_unique(
    conn: &Connection,
    public_key: &str,
    private_key_path: &str,
) -> Result<(), String> {
    let existing_by_path: Option<String> = conn
        .query_row(
            "SELECT name FROM ssh_keys WHERE private_key_path = ?1 LIMIT 1",
            [&private_key_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(name) = existing_by_path {
        return Err(format!("SSH key already exists for this path: {}", name));
    }

    if !public_key.trim().is_empty() {
        let existing_by_public_key: Option<String> = conn
            .query_row(
                "SELECT name FROM ssh_keys WHERE public_key = ?1 LIMIT 1",
                [&public_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(name) = existing_by_public_key {
            return Err(format!("SSH key already exists: {}", name));
        }
    }

    Ok(())
}

#[tauri::command]
fn save_connection(
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
fn update_connection(
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
fn set_connection_password(
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
fn delete_connection(
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

pub(crate) fn read_public_key_for_path(private_key_path: &str) -> String {
    let pub_path = format!("{}.pub", private_key_path);
    fs::read_to_string(pub_path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(crate) fn fingerprint_for_pubkey_path(pub_path: &str) -> String {
    match run_ssh_keygen(&["-lf", pub_path]) {
        Ok(out) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                parts[1].to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

#[tauri::command]
fn get_managed_keys_dir() -> Result<String, String> {
    Ok(get_keys_dir())
}

#[tauri::command]
fn get_ssh_keys() -> Result<Vec<SshKeyItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, public_key, private_key_path, key_type, fingerprint FROM ssh_keys ORDER BY name COLLATE NOCASE ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(SshKeyItem {
                id: row.get(0)?,
                name: row.get(1)?,
                public_key: row.get(2)?,
                private_key_path: row.get(3)?,
                key_type: row.get(4)?,
                fingerprint: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for item in iter {
        res.push(item.map_err(|e| e.to_string())?);
    }
    Ok(res)
}

#[tauri::command]
fn save_ssh_key(
    name: String,
    public_key: String,
    private_key_path: String,
    key_type: String,
) -> Result<(), String> {
    let name = normalize_ssh_key_name(&name);
    if name.is_empty() {
        return Err("Key name is empty".to_string());
    }

    if private_key_path.trim().is_empty() {
        return Err("Private key path is empty".to_string());
    }

    let path = private_key_path.trim().to_string();
    if !Path::new(&path).exists() {
        return Err(format!("Key file not found: {}", path));
    }

    let normalized_key_type = normalize_ssh_key_type(&key_type);
    let public = if public_key.trim().is_empty() {
        read_public_key_for_path(&path)
    } else {
        public_key.trim().to_string()
    };

    let fingerprint = fingerprint_for_pubkey_path(&format!("{}.pub", path));

    let conn = open_db()?;
    ensure_ssh_key_unique(&conn, &public, &path)?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&name, &public, &path, &normalized_key_type, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn generate_ssh_key(name: String, key_type: String) -> Result<(), String> {
    let normalized_name = normalize_ssh_key_name(&name);
    if normalized_name.is_empty() {
        return Err("Key name is empty".to_string());
    }

    let safe_name: String = normalized_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let normalized_key_type = normalize_ssh_key_type(&key_type);
    let key_type_final = if normalized_key_type == "imported" {
        "ed25519".to_string()
    } else {
        normalized_key_type
    };

    let key_dir = get_keys_dir();
    let private_path = format!("{}/{}", key_dir, safe_name);
    let pub_path = format!("{}.pub", private_path);

    if Path::new(&private_path).exists() || Path::new(&pub_path).exists() {
        return Err("A key with that file name already exists".to_string());
    }

    let output = run_ssh_keygen(&[
        "-t",
        &key_type_final,
        "-f",
        &private_path,
        "-N",
        "",
        "-C",
        &normalized_name,
    ])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ssh-keygen failed: {}", stderr));
    }

    let public_key = fs::read_to_string(&pub_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let fingerprint = fingerprint_for_pubkey_path(&pub_path);

    let conn = open_db()?;
    ensure_ssh_key_unique(&conn, &public_key, &private_path)?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&normalized_name, &public_key, &private_path, &key_type_final, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_ssh_key(id: i32) -> Result<(), String> {
    let conn = open_db()?;

    let mut stmt = conn
        .prepare("SELECT private_key_path, key_type FROM ssh_keys WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (private_key_path, key_type): (String, String) = stmt
        .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "SSH key not found".to_string(),
            _ => e.to_string(),
        })?;

    let deleted = conn
        .execute("DELETE FROM ssh_keys WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("SSH key not found".to_string());
    }

    let managed_dir = get_keys_dir();
    if key_type != "imported" && private_key_path.starts_with(&managed_dir) {
        let _ = fs::remove_file(&private_key_path);
        let _ = fs::remove_file(format!("{}.pub", private_key_path));
    }

    Ok(())
}

#[tauri::command]
fn get_tunnels(server_id: i32) -> Result<Vec<TunnelItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, server_id, local_port, remote_host, remote_port, bind_host, auto_start
         FROM ssh_tunnels
         WHERE server_id = ?1
         ORDER BY name ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([&server_id], |row| {
            let auto_start_raw: i32 = row.get(7)?;
            Ok(TunnelItem {
                id: row.get(0)?,
                name: row.get(1)?,
                server_id: row.get(2)?,
                local_port: row.get(3)?,
                remote_host: row.get(4)?,
                remote_port: row.get(5)?,
                bind_host: row.get(6)?,
                auto_start: auto_start_raw != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for item in iter {
        res.push(item.map_err(|e| e.to_string())?);
    }
    Ok(res)
}

#[tauri::command]
fn save_tunnel(mut tunnel: SshTunnel) -> Result<String, String> {
    normalize_tunnel_fields(&mut tunnel);

    if tunnel.name.is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }

    let bind_host = if tunnel.bind_host.is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.clone()
    };

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, None)?;
    ensure_tunnel_route_is_unique(&conn, &tunnel, &bind_host, None)?;

    conn.execute(
        "INSERT INTO ssh_tunnels (server_id, name, local_port, remote_host, remote_port, bind_host, auto_start)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            &tunnel.server_id,
            &tunnel.name,
            &tunnel.local_port,
            &tunnel.remote_host,
            &tunnel.remote_port,
            &bind_host,
            &(if tunnel.auto_start { 1 } else { 0 }),
        )
    ).map_err(|e| e.to_string())?;

    Ok("Tunnel saved".to_string())
}
#[tauri::command]
fn update_tunnel(
    id: i32,
    mut tunnel: SshTunnel,
    state: State<'_, SshState>,
) -> Result<String, String> {
    normalize_tunnel_fields(&mut tunnel);

    if tunnel.name.is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }

    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    {
        let map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        if map.contains_key(&id) {
            return Err("Stop the tunnel before editing it".to_string());
        }
    }

    let bind_host = if tunnel.bind_host.is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.clone()
    };

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, Some(id))?;
    ensure_tunnel_route_is_unique(&conn, &tunnel, &bind_host, Some(id))?;

    let updated = conn.execute(
        "UPDATE ssh_tunnels
         SET server_id = ?1, name = ?2, local_port = ?3, remote_host = ?4, remote_port = ?5, bind_host = ?6, auto_start = ?7
         WHERE id = ?8",
        (
            &tunnel.server_id,
            &tunnel.name,
            &tunnel.local_port,
            &tunnel.remote_host,
            &tunnel.remote_port,
            &bind_host,
            &(if tunnel.auto_start { 1 } else { 0 }),
            &id,
        )
    ).map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Tunnel not found".to_string());
    }

    Ok("Tunnel updated".to_string())
}
#[tauri::command]
fn delete_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
    let entry = {
        let mut map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        map.remove(&id)
    };

    if let Some(entry) = entry {
        entry.stop_flag.store(true, Ordering::Relaxed);
        let _ = entry.handle.join();
    }

    let conn = open_db()?;
    let deleted = conn
        .execute("DELETE FROM ssh_tunnels WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Err("Tunnel not found".to_string());
    }
    Ok("Tunnel deleted".to_string())
}

fn get_tunnel_by_id(id: i32) -> Result<TunnelItem, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, server_id, local_port, remote_host, remote_port, bind_host, auto_start
         FROM ssh_tunnels
         WHERE id = ?1"
    ).map_err(|e| e.to_string())?;

    stmt.query_row([&id], |row| {
        let auto_start_raw: i32 = row.get(7)?;
        Ok(TunnelItem {
            id: row.get(0)?,
            name: row.get(1)?,
            server_id: row.get(2)?,
            local_port: row.get(3)?,
            remote_host: row.get(4)?,
            remote_port: row.get(5)?,
            bind_host: row.get(6)?,
            auto_start: auto_start_raw != 0,
        })
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "Tunnel not found".to_string(),
        _ => e.to_string(),
    })
}

fn connect_quick_session(
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
) -> Result<Session, String> {
    let tcp = tcp_connect_with_timeout(&host, port, Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS))?;

    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake Error: {}", e))?;

    ensure_known_host_match_for_session(&sess, &host, port)?;

    if !authenticate_session(&sess, &username, &password, &private_key, &passphrase) {
        return Err("Authentication failed".to_string());
    }

    Ok(sess)
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

fn connect_runtime_details(details: &ConnectionRuntimeDetails) -> Result<Session, String> {
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

fn connect_ssh_session_with_password_override(
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

fn normalize_remote_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    Ok(trimmed.to_string())
}

fn map_sftp_path_error(err: ssh2::Error, action: &str, path: &str) -> String {
    let message = err.message().to_ascii_lowercase();
    if message.contains("no such file")
        || message.contains("not found")
        || message.contains("does not exist")
    {
        format!("{} not found: {}", action, path)
    } else {
        format!("{} failed for {}: {}", action, path, err)
    }
}

fn normalize_local_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn map_local_fs_error(err: &std::io::Error, action: &str, path: &Path) -> String {
    let display = path.to_string_lossy();

    match err.kind() {
        std::io::ErrorKind::NotFound => format!("{} not found: {}", action, display),
        std::io::ErrorKind::PermissionDenied => {
            format!("{} permission denied: {}", action, display)
        }
        std::io::ErrorKind::AlreadyExists => format!("{} already exists: {}", action, display),
        _ => format!("{} failed for {}: {}", action, display, err),
    }
}

#[tauri::command]
fn local_list_dir(path: String) -> Result<Vec<FileItem>, String> {
    let path = normalize_local_path(&path)?;

    let metadata =
        fs::metadata(&path).map_err(|e| map_local_fs_error(&e, "List directory", &path))?;
    if !metadata.is_dir() {
        return Err(format!(
            "List directory failed for {}: Not a directory",
            path.to_string_lossy()
        ));
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| map_local_fs_error(&e, "List directory", &path))? {
        let entry = entry.map_err(|e| map_local_fs_error(&e, "List directory", &path))?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == "." || name == ".." {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        let link_metadata = fs::symlink_metadata(&entry_path).ok();
        let resolved_metadata = if file_type.is_symlink() {
            fs::metadata(&entry_path).ok()
        } else {
            None
        };

        let is_dir = file_type.is_dir()
            || resolved_metadata
                .as_ref()
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);

        let size = if is_dir {
            0
        } else {
            link_metadata
                .as_ref()
                .map(|metadata| metadata.len())
                .or_else(|| resolved_metadata.as_ref().map(|metadata| metadata.len()))
                .unwrap_or(0)
        };

        items.push(FileItem { name, is_dir, size });
    }

    items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
fn local_mkdir(path: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    fs::create_dir(&path).map_err(|e| map_local_fs_error(&e, "Create folder", &path))?;
    Ok("Folder created".to_string())
}

#[tauri::command]
fn local_rename(old_path: String, new_path: String) -> Result<String, String> {
    let old_path = normalize_local_path(&old_path)?;
    let new_path = normalize_local_path(&new_path)?;
    fs::rename(&old_path, &new_path).map_err(|e| map_local_fs_error(&e, "Rename", &old_path))?;
    Ok("Renamed".to_string())
}

#[tauri::command]
fn local_delete(path: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    let link_metadata =
        fs::symlink_metadata(&path).map_err(|e| map_local_fs_error(&e, "Delete target", &path))?;

    if link_metadata.file_type().is_symlink() {
        fs::remove_file(&path).map_err(|e| map_local_fs_error(&e, "Delete link", &path))?;
    } else if link_metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| map_local_fs_error(&e, "Delete folder", &path))?;
    } else {
        fs::remove_file(&path).map_err(|e| map_local_fs_error(&e, "Delete file", &path))?;
    }

    Ok("Deleted".to_string())
}

#[tauri::command]
fn local_read_file(path: String) -> Result<SftpReadFilePayload, String> {
    let path = normalize_local_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|e| map_local_fs_error(&e, "Read file", &path))?;

    if metadata.is_dir() {
        return Err(format!(
            "Read file failed for {}: Path is a directory",
            path.to_string_lossy()
        ));
    }

    let bytes = fs::read(&path).map_err(|e| map_local_fs_error(&e, "Read file", &path))?;
    Ok(SftpReadFilePayload {
        content_base64: STANDARD.encode(bytes),
    })
}

#[tauri::command]
fn local_write_file(path: String, content_base64: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    let bytes = STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|e| format!("Invalid base64 content: {}", e))?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| map_local_fs_error(&e, "Prepare parent folder", parent))?;
        }
    }

    fs::write(&path, bytes).map_err(|e| map_local_fs_error(&e, "Write file", &path))?;
    Ok("Saved".to_string())
}

#[tauri::command]
fn get_local_home_dir() -> Result<String, String> {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));

    match fs::canonicalize(&home) {
        Ok(resolved) => Ok(resolved.to_string_lossy().to_string()),
        Err(_) => Ok(home.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn get_local_roots() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();

        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                roots.push(root);
            }
        }

        return Ok(roots);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn test_connection(
    mut connection: SshConnection,
    check_sftp: Option<bool>,
) -> Result<ConnectionTestResult, String> {
    normalize_connection_fields(&mut connection);
    validate_connection(&connection)?;

    let host = connection.host.clone();
    let port = connection.port;
    let username = connection.username.clone();

    let (sess, key, key_type, fingerprint) = probe_host_key(&host, port)?;
    let host_key_status = check_known_host_status_for_session(&sess, &host, port, &key)?;
    let key_type_label = host_key_type_label(key_type);

    if host_key_status != "match" {
        let message = match host_key_status.as_str() {
            "not_found" => "Host key is not trusted yet".to_string(),
            "mismatch" => "Stored host key does not match the current server".to_string(),
            _ => "Host key verification failed".to_string(),
        };

        return Ok(ConnectionTestResult {
            success: false,
            auth_ok: false,
            sftp_ok: false,
            host_key_status,
            key_type: key_type_label,
            fingerprint,
            message,
        });
    }

    let auth_ok = authenticate_session(
        &sess,
        &connection.username,
        &connection.password,
        &connection.private_key,
        &connection.passphrase,
    );

    if !auth_ok {
        return Ok(ConnectionTestResult {
            success: false,
            auth_ok: false,
            sftp_ok: false,
            host_key_status,
            key_type: key_type_label,
            fingerprint,
            message: format!("Authentication failed for {}", username),
        });
    }

    let wants_sftp = check_sftp.unwrap_or(true);
    let sftp_ok = if wants_sftp {
        sess.sftp().is_ok()
    } else {
        false
    };

    if wants_sftp && !sftp_ok {
        return Ok(ConnectionTestResult {
            success: false,
            auth_ok: true,
            sftp_ok: false,
            host_key_status,
            key_type: key_type_label,
            fingerprint,
            message: "SSH login succeeded, but SFTP could not be opened".to_string(),
        });
    }

    Ok(ConnectionTestResult {
        success: true,
        auth_ok: true,
        sftp_ok,
        host_key_status,
        key_type: key_type_label,
        fingerprint,
        message: "Connection test succeeded".to_string(),
    })
}

#[tauri::command]
fn check_host_key(host: String, port: u16) -> Result<HostKeyCheckInfo, String> {
    let (sess, key, key_type, fingerprint) = probe_host_key(&host, port)?;
    let mut known_hosts = sess.known_hosts().map_err(|e| e.to_string())?;
    let known_hosts_path = get_known_hosts_path()?;
    read_known_hosts_file(&mut known_hosts, &known_hosts_path)?;

    let status = match known_hosts.check_port(&host, port, &key) {
        CheckResult::Match => "match",
        CheckResult::NotFound => "not_found",
        CheckResult::Mismatch => "mismatch",
        CheckResult::Failure => "failure",
    }
    .to_string();

    Ok(HostKeyCheckInfo {
        host: host.clone(),
        port,
        display_host: format_known_host_name(&host, port),
        key_type: host_key_type_label(key_type),
        fingerprint,
        status,
        known_hosts_path: known_hosts_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn trust_host_key(host: String, port: u16) -> Result<(), String> {
    let (sess, key, key_type, _) = probe_host_key(&host, port)?;
    let known_hosts_path = get_known_hosts_path()?;

    remove_known_host_entry_with_ssh_keygen(&host, port, &known_hosts_path);

    let mut known_hosts = sess.known_hosts().map_err(|e| e.to_string())?;
    read_known_hosts_file(&mut known_hosts, &known_hosts_path)?;

    let host_name = format_known_host_name(&host, port);
    let key_format: KnownHostKeyFormat = key_type.into();

    known_hosts
        .add(&host_name, &key, "", key_format)
        .map_err(|e| e.to_string())?;

    known_hosts
        .write_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_active_tunnels(state: State<'_, SshState>) -> Result<Vec<ActiveTunnelItem>, String> {
    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    let map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    let items = map.keys().map(|id| ActiveTunnelItem { id: *id }).collect();
    Ok(items)
}

#[tauri::command]
fn start_tunnel(
    id: i32,
    state: State<'_, SshState>,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    {
        let map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        if map.contains_key(&id) {
            return Ok("Tunnel already running".to_string());
        }
    }

    let tunnel = get_tunnel_by_id(id)?;
    if tunnel.remote_host.trim().is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Tunnel ports must be greater than 0".to_string());
    }

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    let tunnel_runtime_details =
        load_connection_runtime_details(tunnel.server_id, None, &vault_state)?;

    let bind_host = if tunnel.bind_host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.trim().to_string()
    };
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, Some(id))?;
    let bind_addr = format!("{}:{}", bind_host, tunnel.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .map_err(|e| format!("Failed to bind {}: {}", bind_addr, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_thread = Arc::clone(&stop_flag);

    let remote_host = tunnel.remote_host.trim().to_string();
    let remote_port = tunnel.remote_port;

    let handle = thread::spawn(move || loop {
        if stop_flag_thread.load(Ordering::Relaxed) {
            break;
        }

        match listener.accept() {
            Ok((inbound, _addr)) => {
                let remote_host_clone = remote_host.clone();
                let connection_details = tunnel_runtime_details.clone();
                thread::spawn(move || {
                    let sess = match connect_runtime_details(&connection_details) {
                        Ok(s) => s,
                        Err(_) => return,
                    };

                    let mut channel =
                        match sess.channel_direct_tcpip(&remote_host_clone, remote_port, None) {
                            Ok(c) => c,
                            Err(_) => return,
                        };

                    let mut inbound_read = match inbound.try_clone() {
                        Ok(s) => s,
                        Err(_) => return,
                    };

                    let mut inbound_write = inbound;

                    let mut channel_clone = channel.stream(0);

                    let t1 = thread::spawn(move || {
                        let _ = std::io::copy(&mut inbound_read, &mut channel);
                    });

                    let _ = std::io::copy(&mut channel_clone, &mut inbound_write);
                    let _ = t1.join();
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                break;
            }
        }
    });

    let mut map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    map.insert(id, TunnelRuntimeEntry { stop_flag, handle });

    Ok(format!("Tunnel running on {}", bind_addr))
}

#[tauri::command]
fn stop_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
    let entry = {
        let mut map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        map.remove(&id)
    };

    if let Some(entry) = entry {
        entry.stop_flag.store(true, Ordering::Relaxed);
        let _ = entry.handle.join();
        return Ok("Tunnel stopped".to_string());
    }

    let conn = open_db()?;
    let exists: Option<i32> = conn
        .query_row(
            "SELECT id FROM ssh_tunnels WHERE id = ?1 LIMIT 1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if exists.is_some() {
        Ok("Tunnel was not running".to_string())
    } else {
        Err("Tunnel not found".to_string())
    }
}

#[tauri::command]
fn start_local_pty(
    session_id: String,
    cols: u32,
    rows: u32,
    app_handle: AppHandle,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY Error: {}", e))?;

    #[cfg(target_os = "windows")]
    let shell = std::env::var("TERMSSH_WINDOWS_SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("COMSPEC")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "cmd.exe".to_string());

    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());

    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("shell")
        .to_ascii_lowercase();

    let mut cmd = CommandBuilder::new(shell.clone());
    sanitize_local_shell_env(&mut cmd);

    #[cfg(not(target_os = "windows"))]
    {
        cmd.arg("-i");

        if shell_name.contains("bash") || shell_name.contains("zsh") || shell_name.contains("fish")
        {
            cmd.arg("-l");
        }

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
    }

    #[cfg(target_os = "windows")]
    {
        if shell_name == "powershell.exe"
            || shell_name == "pwsh.exe"
            || shell_name == "powershell"
            || shell_name == "pwsh"
        {
            cmd.arg("-NoLogo");
        }
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Shell Start Fehler: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Reader Fehler: {}", e))?;

    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Writer Fehler: {}", e))?;

    let (tx, rx) = channel::<SshMessage>();
    state
        .txs
        .lock()
        .map_err(|_| "PTY state lock failed".to_string())?
        .insert(session_id.clone(), tx);

    let event_name = format!("term-output-{}", session_id);
    let app_for_reader = app_handle.clone();
    let exit_sent = Arc::new(AtomicBool::new(false));
    let exit_sent_reader = Arc::clone(&exit_sent);
    let session_id_reader = session_id.clone();
    let app_for_wait = app_handle.clone();
    let exit_sent_wait = Arc::clone(&exit_sent);
    let session_id_wait = session_id.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app_for_reader
                        .emit(&event_name, String::from_utf8_lossy(&buf[..n]).to_string());
                }
                Ok(_) => {
                    let _ = app_for_reader
                        .emit(&event_name, "\r\n[Lokale Shell beendet]\r\n".to_string());
                    emit_session_exit_once(&app_for_reader, &session_id_reader, &exit_sent_reader);
                    break;
                }
                Err(_) => {
                    let _ = app_for_reader
                        .emit(&event_name, "\r\n[Lokale Shell beendet]\r\n".to_string());
                    emit_session_exit_once(&app_for_reader, &session_id_reader, &exit_sent_reader);
                    break;
                }
            }
        }
    });

    thread::spawn(move || {
        let master = pair.master;
        while let Ok(msg) = rx.recv() {
            match msg {
                SshMessage::Input(input) => {
                    let _ = writer.write_all(input.as_bytes());
                    let _ = writer.flush();
                }
                SshMessage::Resize(c, r) => {
                    let _ = master.resize(PtySize {
                        rows: r as u16,
                        cols: c as u16,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        emit_session_exit_once(&app_for_wait, &session_id_wait, &exit_sent_wait);
    });

    Ok(())
}

#[tauri::command]
fn start_quick_ssh(
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
    session_id: String,
    cols: u32,
    rows: u32,
    app_handle: AppHandle,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let sess = connect_quick_session(host, port, username, password, private_key, passphrase)?;
    let (tx, rx) = channel::<SshMessage>();
    state
        .txs
        .lock()
        .map_err(|_| "SSH state lock failed".to_string())?
        .insert(session_id.clone(), tx);

    let event_name = format!("term-output-{}", session_id);
    let connect_event = format!("ssh-connected-{}", session_id);
    let _ = app_handle.emit(&connect_event, true);
    let exit_sent = Arc::new(AtomicBool::new(false));
    let exit_sent_loop = Arc::clone(&exit_sent);
    let session_id_for_exit = session_id.clone();

    thread::spawn(move || {
        let mut channel = match sess.channel_session() {
            Ok(channel) => channel,
            Err(e) => {
                let _ = app_handle.emit(
                    &event_name,
                    format!(
                        "\r\n\x1b[1;31m[Kanal konnte nicht geöffnet werden: {}]\x1b[0m\r\n",
                        e
                    ),
                );
                let _ = app_handle.emit(&connect_event, false);
                emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                return;
            }
        };
        if let Err(e) = channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0))) {
            let _ = app_handle.emit(
                &event_name,
                format!(
                    "\r\n\x1b[1;31m[PTY konnte nicht angefordert werden: {}]\x1b[0m\r\n",
                    e
                ),
            );
            let _ = app_handle.emit(&connect_event, false);
            emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
            let _ = channel.close();
            return;
        }
        if let Err(e) = channel.shell() {
            let _ = app_handle.emit(
                &event_name,
                format!(
                    "\r\n\x1b[1;31m[Shell konnte nicht gestartet werden: {}]\x1b[0m\r\n",
                    e
                ),
            );
            let _ = app_handle.emit(&connect_event, false);
            emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
            let _ = channel.close();
            return;
        }
        sess.set_blocking(false);
        let mut buf = [0; 4096];

        loop {
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app_handle
                        .emit(&event_name, String::from_utf8_lossy(&buf[..n]).to_string());
                }
                Ok(_) => {}
                Err(_) => {}
            }

            loop {
                match rx.try_recv() {
                    Ok(SshMessage::Input(input)) => {
                        let _ = channel.write_all(input.as_bytes());
                        let _ = channel.flush();
                    }
                    Ok(SshMessage::Resize(c, r)) => {
                        let _ = channel.request_pty_size(c, r, None, None);
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        let _ = channel.close();
                        let _ = app_handle.emit(&connect_event, false);
                        emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                        return;
                    }
                }
            }

            if channel.eof() {
                let _ = app_handle.emit(
                    &event_name,
                    "\r\n\x1b[1;31m[Verbindung beendet]\x1b[0m\r\n".to_string(),
                );
                let _ = app_handle.emit(&connect_event, false);
                emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                let _ = channel.wait_close();
                break;
            }

            thread::sleep(Duration::from_millis(10));
        }
    });

    Ok(())
}

#[tauri::command]
fn start_ssh(
    id: i32,
    session_id: String,
    cols: u32,
    rows: u32,
    password_override: Option<String>,
    app_handle: AppHandle,
    state: State<'_, SshState>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let sess = connect_ssh_session_with_password_override(id, password_override, &vault_state)?;
    let (tx, rx) = channel::<SshMessage>();
    state
        .txs
        .lock()
        .map_err(|_| "SSH state lock failed".to_string())?
        .insert(session_id.clone(), tx);
    let event_name = format!("term-output-{}", session_id);
    let connect_event = format!("ssh-connected-{}", session_id);
    let _ = app_handle.emit(&connect_event, true);
    let exit_sent = Arc::new(AtomicBool::new(false));
    let exit_sent_loop = Arc::clone(&exit_sent);
    let session_id_for_exit = session_id.clone();
    thread::spawn(move || {
        let mut channel = match sess.channel_session() {
            Ok(channel) => channel,
            Err(e) => {
                let _ = app_handle.emit(
                    &event_name,
                    format!(
                        "\r\n\x1b[1;31m[Kanal konnte nicht geöffnet werden: {}]\x1b[0m\r\n",
                        e
                    ),
                );
                let _ = app_handle.emit(&connect_event, false);
                emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                return;
            }
        };
        if let Err(e) = channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0))) {
            let _ = app_handle.emit(
                &event_name,
                format!(
                    "\r\n\x1b[1;31m[PTY konnte nicht angefordert werden: {}]\x1b[0m\r\n",
                    e
                ),
            );
            let _ = app_handle.emit(&connect_event, false);
            emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
            let _ = channel.close();
            return;
        }
        if let Err(e) = channel.shell() {
            let _ = app_handle.emit(
                &event_name,
                format!(
                    "\r\n\x1b[1;31m[Shell konnte nicht gestartet werden: {}]\x1b[0m\r\n",
                    e
                ),
            );
            let _ = app_handle.emit(&connect_event, false);
            emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
            let _ = channel.close();
            return;
        }
        sess.set_blocking(false);
        let mut buf = [0; 4096];
        loop {
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app_handle
                        .emit(&event_name, String::from_utf8_lossy(&buf[..n]).to_string());
                }
                Ok(_) => {}
                Err(_) => {}
            }
            loop {
                match rx.try_recv() {
                    Ok(SshMessage::Input(input)) => {
                        let _ = channel.write_all(input.as_bytes());
                        let _ = channel.flush();
                    }
                    Ok(SshMessage::Resize(c, r)) => {
                        let _ = channel.request_pty_size(c, r, None, None);
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        let _ = channel.close();
                        let _ = app_handle.emit(&connect_event, false);
                        emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                        return;
                    }
                }
            }
            if channel.eof() {
                let _ = app_handle.emit(
                    &event_name,
                    "\r\n\x1b[1;31m[Verbindung beendet]\x1b[0m\r\n".to_string(),
                );
                let _ = app_handle.emit(&connect_event, false);
                emit_session_exit_once(&app_handle, &session_id_for_exit, &exit_sent_loop);
                let _ = channel.wait_close();
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    Ok(())
}
#[tauri::command]
fn sftp_list_dir(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<Vec<FileItem>, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let mut items = Vec::new();
    let dir_entries = sftp
        .readdir(Path::new(&path))
        .map_err(|e| map_sftp_path_error(e, "List directory", &path))?;
    for (path_buf, stat) in dir_entries {
        if let Some(filename) = path_buf.file_name().and_then(|n| n.to_str()) {
            if filename == "." || filename == ".." {
                continue;
            }
            items.push(FileItem {
                name: filename.to_string(),
                is_dir: stat.is_dir(),
                size: stat.size.unwrap_or(0),
            });
        }
    }
    items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
fn sftp_mkdir(id: i32, path: String, vault_state: State<'_, VaultState>) -> Result<String, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    sftp.mkdir(Path::new(&path), 0o755)
        .map_err(|e| map_sftp_path_error(e, "Create folder", &path))?;
    Ok("Folder created".to_string())
}

#[tauri::command]
fn sftp_rename(
    id: i32,
    old_path: String,
    new_path: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let old_path = normalize_remote_path(&old_path)?;
    let new_path = normalize_remote_path(&new_path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
        .map_err(|e| map_sftp_path_error(e, "Rename", &old_path))?;
    Ok("Renamed".to_string())
}

#[tauri::command]
fn sftp_delete(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let stat = sftp
        .stat(Path::new(&path))
        .map_err(|e| map_sftp_path_error(e, "Delete target", &path))?;
    if stat.is_dir() {
        sftp.rmdir(Path::new(&path))
            .map_err(|e| map_sftp_path_error(e, "Delete folder", &path))?;
    } else {
        sftp.unlink(Path::new(&path))
            .map_err(|e| map_sftp_path_error(e, "Delete file", &path))?;
    }
    Ok("Deleted".to_string())
}

#[tauri::command]
fn sftp_read_file(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<SftpReadFilePayload, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let mut file = sftp
        .open(Path::new(&path))
        .map_err(|e| map_sftp_path_error(e, "Read file", &path))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("Read failed for {}: {}", path, e))?;
    Ok(SftpReadFilePayload {
        content_base64: STANDARD.encode(&buf),
    })
}

#[tauri::command]
fn sftp_write_file(
    id: i32,
    path: String,
    content_base64: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let bytes = STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|e| format!("Invalid base64 content: {}", e))?;
    let mut file = sftp
        .create(Path::new(&path))
        .map_err(|e| map_sftp_path_error(e, "Write file", &path))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Write failed for {}: {}", path, e))?;
    Ok("Saved".to_string())
}

#[tauri::command]
fn cancel_transfer(session_id: String, state: State<'_, SshState>) {
    if let Ok(transfers) = state.transfers.lock() {
        if let Some(flag) = transfers.get(&session_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

fn upload_recursive(
    sftp: &ssh2::Sftp,
    local: &Path,
    remote: &Path,
    cancel: &AtomicBool,
    app: &AppHandle,
    sid: &str,
    start_time: std::time::Instant,
    transferred: &mut u64,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("CANCELLED".to_string());
    }
    if local.is_dir() {
        let _ = sftp.mkdir(remote, 0o755);
        for entry in fs::read_dir(local).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let new_remote = remote.join(entry.file_name());
            upload_recursive(
                sftp,
                &entry.path(),
                Path::new(&new_remote.to_string_lossy().replace("\\", "/")),
                cancel,
                app,
                sid,
                start_time,
                transferred,
            )?;
        }
    } else {
        let mut local_file = fs::File::open(local).map_err(|e| e.to_string())?;
        let mut remote_file = sftp.create(remote).map_err(|e| e.to_string())?;
        let mut buffer = vec![0; 128 * 1024];
        let mut last_emit = std::time::Instant::now();
        let fname = local
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = sftp.unlink(remote);
                return Err("CANCELLED".to_string());
            }
            let n = local_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buffer[..n])
                .map_err(|e| e.to_string())?;
            *transferred += n as u64;
            if last_emit.elapsed().as_millis() > 150 {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    *transferred as f64 / elapsed
                } else {
                    0.0
                };
                let _ = app.emit(
                    &format!("sftp-progress-{}", sid),
                    SftpProgress {
                        transferred: *transferred,
                        total: 0,
                        speed,
                        current_file: fname.clone(),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
    }
    Ok(())
}
#[tauri::command]
async fn sftp_upload(
    id: i32,
    session_id: String,
    local_path: String,
    remote_path: String,
    app: AppHandle,
    state: State<'_, SshState>,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let local_path = normalize_local_path(&local_path)?;
    if !local_path.exists() {
        return Err(format!("Path not found: {}", local_path.to_string_lossy()));
    }

    let remote_path = normalize_remote_path(&remote_path)?;
    let runtime_details = load_connection_runtime_details(id, None, &vault_state)?;
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .transfers
        .lock()
        .map_err(|_| "SFTP transfer state lock failed".to_string())?
        .insert(session_id.clone(), Arc::clone(&cancel_flag));
    let s_id = session_id.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let sess = connect_runtime_details(&runtime_details)?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let mut transferred = 0;
        upload_recursive(
            &sftp,
            &local_path,
            Path::new(&remote_path),
            &cancel_flag,
            &app,
            &s_id,
            std::time::Instant::now(),
            &mut transferred,
        )?;
        Ok("Upload completed".to_string())
    })
    .await;

    if let Ok(mut transfers) = state.transfers.lock() {
        transfers.remove(&session_id);
    }

    let inner_result = join_result.map_err(|_| "Thread Error".to_string())?;
    inner_result
}

fn download_recursive(
    sftp: &ssh2::Sftp,
    remote: &Path,
    local: &Path,
    cancel: &AtomicBool,
    app: &AppHandle,
    sid: &str,
    start_time: std::time::Instant,
    transferred: &mut u64,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("CANCELLED".to_string());
    }
    let stat = sftp.stat(remote).map_err(|e| e.to_string())?;
    if stat.is_dir() {
        fs::create_dir_all(local).map_err(|e| e.to_string())?;
        let entries = sftp.readdir(remote).map_err(|e| e.to_string())?;
        for (path_buf, _) in entries {
            if let Some(name) = path_buf.file_name() {
                if name == "." || name == ".." {
                    continue;
                }
                let new_local = local.join(name);
                download_recursive(
                    sftp,
                    &path_buf,
                    &new_local,
                    cancel,
                    app,
                    sid,
                    start_time,
                    transferred,
                )?;
            }
        }
    } else {
        let mut remote_file = sftp.open(remote).map_err(|e| e.to_string())?;
        let mut local_file = fs::File::create(local).map_err(|e| e.to_string())?;
        let mut buffer = vec![0; 128 * 1024];
        let mut last_emit = std::time::Instant::now();
        let fname = remote
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(local_file);
                let _ = fs::remove_file(local);
                return Err("CANCELLED".to_string());
            }
            let n = remote_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buffer[..n])
                .map_err(|e| e.to_string())?;
            *transferred += n as u64;
            if last_emit.elapsed().as_millis() > 150 {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    *transferred as f64 / elapsed
                } else {
                    0.0
                };
                let _ = app.emit(
                    &format!("sftp-progress-{}", sid),
                    SftpProgress {
                        transferred: *transferred,
                        total: 0,
                        speed,
                        current_file: fname.clone(),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
    }
    Ok(())
}
#[tauri::command]
async fn sftp_download(
    id: i32,
    session_id: String,
    remote_path: String,
    local_path: String,
    app: AppHandle,
    state: State<'_, SshState>,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let remote_path = normalize_remote_path(&remote_path)?;
    let local_path = normalize_local_path(&local_path)?;

    if let Some(parent) = local_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let runtime_details = load_connection_runtime_details(id, None, &vault_state)?;
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .transfers
        .lock()
        .map_err(|_| "SFTP transfer state lock failed".to_string())?
        .insert(session_id.clone(), Arc::clone(&cancel_flag));
    let s_id = session_id.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let sess = connect_runtime_details(&runtime_details)?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let mut transferred = 0;
        download_recursive(
            &sftp,
            Path::new(&remote_path),
            &local_path,
            &cancel_flag,
            &app,
            &s_id,
            std::time::Instant::now(),
            &mut transferred,
        )?;
        Ok("Download completed".to_string())
    })
    .await;

    if let Ok(mut transfers) = state.transfers.lock() {
        transfers.remove(&session_id);
    }

    let inner_result = join_result.map_err(|_| "Thread Error".to_string())?;
    inner_result
}

#[tauri::command]
fn write_to_pty(
    session_id: String,
    input: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    if let Some(tx) = state
        .txs
        .lock()
        .map_err(|_| "PTY state lock failed".to_string())?
        .get(&session_id)
    {
        let _ = tx.send(SshMessage::Input(input));
    }
    Ok(())
}
#[tauri::command]
fn resize_pty(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, SshState>,
) -> Result<(), String> {
    if let Some(tx) = state
        .txs
        .lock()
        .map_err(|_| "PTY state lock failed".to_string())?
        .get(&session_id)
    {
        let _ = tx.send(SshMessage::Resize(cols, rows));
    }
    Ok(())
}
#[tauri::command]
fn close_session(session_id: String, state: State<'_, SshState>) {
    if let Ok(mut txs) = state.txs.lock() {
        txs.remove(&session_id);
    }
}
#[tauri::command]
fn measure_tcp_latency(host: String, port: u16) -> Result<u128, String> {
    let start = std::time::Instant::now();
    tcp_connect_with_timeout(&host, port, Duration::from_millis(1500))?;
    Ok(start.elapsed().as_millis())
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

