use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri_plugin_clipboard_manager::ClipboardExt;

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
}
#[derive(Debug, Serialize)]
pub struct FileItem {
    name: String,
    is_dir: bool,
    size: u64,
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
pub struct BackupBundleV3 {
    version: u32,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    settings: serde_json::Value,
    connections: Vec<BackupConnection>,
    snippets: Vec<BackupSnippet>,
    #[serde(rename = "sshKeys")]
    ssh_keys: Vec<BackupSshKey>,
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
pub struct StatusBarInfo {
    load: Option<String>,
    ram: Option<String>,
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
    _handle: JoinHandle<()>,
}

const APP_DIR_NAME: &str = "terminassh";
const LEGACY_APP_DIR_NAME: &str = "ssh-mgr";

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

fn get_app_dir() -> String {
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
fn get_key_path() -> String {
    format!("{}/master.key", get_app_dir())
}
fn get_keys_dir() -> String {
    let dir = format!("{}/keys", get_app_dir());
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_or_create_key() -> [u8; 32] {
    let key_path = get_key_path();
    if let Ok(key_base64) = fs::read_to_string(&key_path) {
        if let Ok(key_bytes) = STANDARD.decode(key_base64.trim()) {
            if key_bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&key_bytes);
                return key;
            }
        }
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    fs::write(key_path, STANDARD.encode(key)).unwrap_or_default();
    key
}

fn read_file_base64_if_exists(path: &str) -> String {
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

fn encrypt_pw(pw: &str) -> String {
    if pw.is_empty() {
        return String::new();
    }
    let key = get_or_create_key();
    let cipher = Aes256Gcm::new(&key.into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, pw.as_bytes()).unwrap();
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    STANDARD.encode(combined)
}

fn decrypt_pw(encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let combined = STANDARD.decode(encoded).map_err(|_| "Base64 Fehler")?;
    if combined.len() < 12 {
        return Err("Verschlüsselter Text ist zu kurz".to_string());
    }
    let key = get_or_create_key();
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(&combined[..12]);
    let plaintext = cipher
        .decrypt(nonce, &combined[12..])
        .map_err(|_| "Falscher Key")?;
    String::from_utf8(plaintext).map_err(|_| "UTF8 Fehler".to_string())
}

fn init_db() {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).unwrap();
    conn.execute("CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL)", []).unwrap();
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN password TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN private_key TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN passphrase TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
        [],
    );
    conn.execute("CREATE TABLE IF NOT EXISTS snippets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, command TEXT NOT NULL)", []).unwrap();
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
    .unwrap();
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
    .unwrap();
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
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, command FROM snippets ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([], |row| {
            Ok(SnippetItem {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
            })
        })
        .unwrap();
    let mut res = Vec::new();
    for c in iter {
        res.push(c.unwrap());
    }
    Ok(res)
}
#[tauri::command]
fn add_snippet(name: String, command: String, app: AppHandle) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).unwrap();
    conn.execute(
        "INSERT INTO snippets (name, command) VALUES (?1, ?2)",
        (&name, &command),
    )
    .unwrap();
    let _ = app.emit("snippets-updated", ());
    Ok("Snippet gespeichert!".to_string())
}
#[tauri::command]
fn update_snippet(
    id: i32,
    name: String,
    command: String,
    app: AppHandle,
) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).unwrap();
    conn.execute(
        "UPDATE snippets SET name = ?1, command = ?2 WHERE id = ?3",
        (&name, &command, &id),
    )
    .unwrap();
    let _ = app.emit("snippets-updated", ());
    Ok("Snippet aktualisiert!".to_string())
}
#[tauri::command]
fn delete_snippet(id: i32, app: AppHandle) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).unwrap();
    conn.execute("DELETE FROM snippets WHERE id = ?1", [&id])
        .unwrap();
    let _ = app.emit("snippets-updated", ());
    Ok("Snippet gelöscht!".to_string())
}

#[tauri::command]
fn get_connections() -> Result<Vec<ConnectionItem>, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, host, port, username, private_key, group_name FROM connections")
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([], |row| {
            Ok(ConnectionItem {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                private_key: row.get(5)?,
                group_name: row.get(6)?,
            })
        })
        .unwrap();
    let mut res = Vec::new();
    for c in iter {
        res.push(c.unwrap());
    }
    Ok(res)
}
#[tauri::command]
fn save_connection(connection: SshConnection, app: AppHandle) -> Result<String, String> {
    let enc_pw = encrypt_pw(&connection.password);
    let enc_passphrase = encrypt_pw(&connection.passphrase);
    let conn = Connection::open(get_db_path()).unwrap();
    conn.execute("INSERT INTO connections (name, host, port, username, password, private_key, passphrase, group_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", (&connection.name, &connection.host, &connection.port, &connection.username, &enc_pw, &connection.private_key, &enc_passphrase, &connection.group_name)).unwrap();
    let _ = app.emit("connection-saved", ());
    Ok(format!(
        "Verbindung '{}' sicher gespeichert!",
        connection.name
    ))
}
#[tauri::command]
fn update_connection(
    id: i32,
    old_name: String,
    connection: SshConnection,
    app: AppHandle,
) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).unwrap();
    let pw_to_save = if connection.password.is_empty() {
        let mut stmt = conn
            .prepare("SELECT password FROM connections WHERE id = ?1")
            .unwrap();
        stmt.query_row([&id], |row| row.get(0)).unwrap_or_default()
    } else {
        encrypt_pw(&connection.password)
    };
    let passphrase_to_save = if connection.passphrase.is_empty() {
        let mut stmt = conn
            .prepare("SELECT passphrase FROM connections WHERE id = ?1")
            .unwrap();
        stmt.query_row([&id], |row| row.get(0)).unwrap_or_default()
    } else {
        encrypt_pw(&connection.passphrase)
    };
    conn.execute("UPDATE connections SET name = ?1, host = ?2, port = ?3, username = ?4, password = ?5, private_key = ?6, passphrase = ?7, group_name = ?8 WHERE id = ?9", (&connection.name, &connection.host, &connection.port, &connection.username, &pw_to_save, &connection.private_key, &passphrase_to_save, &connection.group_name, &id)).unwrap();
    let _ = old_name;
    let _ = app.emit("connection-saved", ());
    Ok(format!("Verbindung '{}' aktualisiert!", connection.name))
}
#[tauri::command]
fn delete_connection(id: i32, name: String, app: AppHandle) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).unwrap();
    conn.execute("DELETE FROM connections WHERE id = ?1", [&id])
        .unwrap();
    let _ = app.emit("connection-saved", ());
    Ok(format!("Verbindung '{}' gelöscht!", name))
}

fn read_public_key_for_path(private_key_path: &str) -> String {
    let pub_path = format!("{}.pub", private_key_path);
    fs::read_to_string(pub_path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn fingerprint_for_pubkey_path(pub_path: &str) -> String {
    match Command::new("ssh-keygen").args(["-lf", pub_path]).output() {
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
fn export_backup_bundle(settings_json: String) -> Result<String, String> {
    let settings = if settings_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(&settings_json)
            .map_err(|e| format!("Invalid settings JSON: {}", e))?
    };

    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;

    let mut connections = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name, host, port, username, password, private_key, passphrase, group_name FROM connections ORDER BY name ASC")
            .map_err(|e| e.to_string())?;

        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u16>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for item in iter {
            let (name, host, port, username, enc_pw, private_key, enc_passphrase, group_name) =
                item.map_err(|e| e.to_string())?;

            connections.push(BackupConnection {
                name,
                host,
                port,
                username,
                password: decrypt_pw(&enc_pw)?,
                private_key,
                passphrase: decrypt_pw(&enc_passphrase)?,
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

    let exported_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();

    let bundle = BackupBundleV3 {
        version: 3,
        exported_at,
        settings,
        connections,
        snippets,
        ssh_keys,
    };

    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_ssh_keys() -> Result<Vec<SshKeyItem>, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, public_key, private_key_path, key_type, fingerprint FROM ssh_keys ORDER BY name ASC"
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
    if private_key_path.trim().is_empty() {
        return Err("Private key path is empty".to_string());
    }

    let path = private_key_path.trim().to_string();
    if !Path::new(&path).exists() {
        return Err(format!("Key file not found: {}", path));
    }

    let public = if public_key.trim().is_empty() {
        read_public_key_for_path(&path)
    } else {
        public_key.trim().to_string()
    };

    let fingerprint = fingerprint_for_pubkey_path(&format!("{}.pub", path));

    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&name, &public, &path, &key_type, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn generate_ssh_key(name: String, key_type: String) -> Result<(), String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Key name is empty".to_string());
    }

    let safe_name: String = clean_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let key_type_final = if key_type.trim().is_empty() {
        "ed25519"
    } else {
        key_type.trim()
    };
    let key_dir = get_keys_dir();
    let private_path = format!("{}/{}", key_dir, safe_name);
    let pub_path = format!("{}.pub", private_path);

    if Path::new(&private_path).exists() || Path::new(&pub_path).exists() {
        return Err("A key with that file name already exists".to_string());
    }

    let output = Command::new("ssh-keygen")
        .args([
            "-t",
            key_type_final,
            "-f",
            &private_path,
            "-N",
            "",
            "-C",
            clean_name,
        ])
        .output()
        .map_err(|e| format!("ssh-keygen failed to start: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ssh-keygen failed: {}", stderr));
    }

    let public_key = fs::read_to_string(&pub_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let fingerprint = fingerprint_for_pubkey_path(&pub_path);

    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&clean_name, &public_key, &private_path, &key_type_final, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_ssh_key(id: i32) -> Result<(), String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT private_key_path, key_type FROM ssh_keys WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (private_key_path, key_type): (String, String) = stmt
        .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    let managed_dir = get_keys_dir();
    if key_type != "imported" && private_key_path.starts_with(&managed_dir) {
        let _ = fs::remove_file(&private_key_path);
        let _ = fs::remove_file(format!("{}.pub", private_key_path));
    }

    Ok(())
}

#[tauri::command]
fn get_tunnels(server_id: i32) -> Result<Vec<TunnelItem>, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
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
fn save_tunnel(tunnel: SshTunnel) -> Result<String, String> {
    if tunnel.name.trim().is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.trim().is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }

    let bind_host = if tunnel.bind_host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.trim().to_string()
    };

    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
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
fn update_tunnel(id: i32, tunnel: SshTunnel) -> Result<String, String> {
    if tunnel.name.trim().is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.trim().is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }

    let bind_host = if tunnel.bind_host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.trim().to_string()
    };

    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
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

    Ok("Tunnel updated".to_string())
}

#[tauri::command]
fn delete_tunnel(id: i32) -> Result<String, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ssh_tunnels WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok("Tunnel deleted".to_string())
}

fn get_tunnel_by_id(id: i32) -> Result<TunnelItem, String> {
    let conn = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())
}

fn connect_quick_session(
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .map_err(|e| format!("TCP Error: {}", e))?;

    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake Error: {}", e))?;

    let mut auth_success = false;

    if !private_key.is_empty() {
        let pass = if passphrase.is_empty() {
            None
        } else {
            Some(passphrase.as_str())
        };
        if sess
            .userauth_pubkey_file(&username, None, Path::new(&private_key), pass)
            .is_ok()
        {
            auth_success = true;
        }
    }

    if !auth_success && sess.userauth_agent(&username).is_ok() {
        auth_success = true;
    }

    if !auth_success {
        if let Ok(home) = std::env::var("HOME") {
            let ed25519 = format!("{}/.ssh/id_ed25519", home);
            let rsa = format!("{}/.ssh/id_rsa", home);

            if Path::new(&ed25519).exists()
                && sess
                    .userauth_pubkey_file(&username, None, Path::new(&ed25519), None)
                    .is_ok()
            {
                auth_success = true;
            } else if Path::new(&rsa).exists()
                && sess
                    .userauth_pubkey_file(&username, None, Path::new(&rsa), None)
                    .is_ok()
            {
                auth_success = true;
            }
        }
    }

    if !auth_success && !password.is_empty() {
        if sess.userauth_password(&username, &password).is_ok() {
            auth_success = true;
        }
    }

    if !auth_success {
        return Err("Authentifizierung fehlgeschlagen!".to_string());
    }

    Ok(sess)
}

fn connect_ssh_session(id: i32) -> Result<Session, String> {
    let conn_db = Connection::open(get_db_path()).map_err(|e| e.to_string())?;
    let mut stmt = conn_db.prepare("SELECT host, port, username, password, private_key, passphrase FROM connections WHERE id = ?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query([&id]).map_err(|e| e.to_string())?;
    let row = rows
        .next()
        .map_err(|e| e.to_string())?
        .ok_or("Verbindung nicht gefunden")?;

    let host: String = row.get(0).unwrap();
    let port: u16 = row.get(1).unwrap();
    let username: String = row.get(2).unwrap();
    let enc_pw: String = row.get(3).unwrap();
    let private_key: String = row.get(4).unwrap();
    let enc_passphrase: String = row.get(5).unwrap();
    let password = decrypt_pw(&enc_pw)?;
    let passphrase = decrypt_pw(&enc_passphrase)?;

    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .map_err(|e| format!("TCP Error: {}", e))?;
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake Error: {}", e))?;

    let mut auth_success = false;
    if !private_key.is_empty() {
        let pass = if passphrase.is_empty() {
            None
        } else {
            Some(passphrase.as_str())
        };
        if sess
            .userauth_pubkey_file(&username, None, Path::new(&private_key), pass)
            .is_ok()
        {
            auth_success = true;
        }
    }
    if !auth_success && sess.userauth_agent(&username).is_ok() {
        auth_success = true;
    }
    if !auth_success {
        if let Ok(home) = std::env::var("HOME") {
            let ed25519 = format!("{}/.ssh/id_ed25519", home);
            let rsa = format!("{}/.ssh/id_rsa", home);
            if Path::new(&ed25519).exists()
                && sess
                    .userauth_pubkey_file(&username, None, Path::new(&ed25519), None)
                    .is_ok()
            {
                auth_success = true;
            } else if Path::new(&rsa).exists()
                && sess
                    .userauth_pubkey_file(&username, None, Path::new(&rsa), None)
                    .is_ok()
            {
                auth_success = true;
            }
        }
    }
    if !auth_success && !password.is_empty() {
        if sess.userauth_password(&username, &password).is_ok() {
            auth_success = true;
        }
    }
    if !auth_success {
        return Err("Authentifizierung fehlgeschlagen!".to_string());
    }
    Ok(sess)
}

#[tauri::command]
fn get_active_tunnels(state: State<'_, SshState>) -> Result<Vec<ActiveTunnelItem>, String> {
    let map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    let items = map.keys().map(|id| ActiveTunnelItem { id: *id }).collect();
    Ok(items)
}

#[tauri::command]
fn start_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
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
    let bind_host = if tunnel.bind_host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        tunnel.bind_host.trim().to_string()
    };
    let bind_addr = format!("{}:{}", bind_host, tunnel.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .map_err(|e| format!("Failed to bind {}: {}", bind_addr, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_thread = Arc::clone(&stop_flag);

    let server_id = tunnel.server_id;
    let remote_host = tunnel.remote_host.clone();
    let remote_port = tunnel.remote_port;

    let handle = thread::spawn(move || loop {
        if stop_flag_thread.load(Ordering::Relaxed) {
            break;
        }

        match listener.accept() {
            Ok((inbound, _addr)) => {
                let remote_host_clone = remote_host.clone();
                thread::spawn(move || {
                    let sess = match connect_ssh_session(server_id) {
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
    map.insert(
        id,
        TunnelRuntimeEntry {
            stop_flag,
            _handle: handle,
        },
    );

    Ok(format!("Tunnel running on {}", bind_addr))
}

#[tauri::command]
fn stop_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
    let mut map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    if let Some(entry) = map.remove(&id) {
        entry.stop_flag.store(true, Ordering::Relaxed);
        return Ok("Tunnel stopped".to_string());
    }
    Ok("Tunnel was not running".to_string())
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("bash")
        .to_string();

    let mut cmd = CommandBuilder::new(shell.clone());
    cmd.arg("-i");

    if shell_name.contains("bash") || shell_name.contains("zsh") || shell_name.contains("fish") {
        cmd.arg("-l");
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

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
    state.txs.lock().unwrap().insert(session_id.clone(), tx);

    let event_name = format!("term-output-{}", session_id);
    let app_for_reader = app_handle.clone();

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
                    break;
                }
                Err(_) => {
                    let _ = app_for_reader
                        .emit(&event_name, "\r\n[Lokale Shell beendet]\r\n".to_string());
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
    state.txs.lock().unwrap().insert(session_id.clone(), tx);

    let event_name = format!("term-output-{}", session_id);
    let connect_event = format!("ssh-connected-{}", session_id);
    let _ = app_handle.emit(&connect_event, true);

    thread::spawn(move || {
        let mut channel = sess.channel_session().unwrap();
        channel
            .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .unwrap();
        channel.shell().unwrap();
        sess.set_blocking(false);
        let mut buf = [0; 4096];

        loop {
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app_handle
                        .emit(&event_name, String::from_utf8_lossy(&buf[..n]).to_string());
                }
                Ok(_) => {
                    let _ = app_handle.emit(
                        &event_name,
                        "\r\n\x1b[1;31m[Verbindung beendet]\x1b[0m\r\n".to_string(),
                    );
                    let _ = app_handle.emit(&connect_event, false);
                    break;
                }
                Err(_) => {}
            }

            while let Ok(msg) = rx.try_recv() {
                match msg {
                    SshMessage::Input(input) => {
                        let _ = channel.write_all(input.as_bytes());
                        let _ = channel.flush();
                    }
                    SshMessage::Resize(c, r) => {
                        let _ = channel.request_pty_size(c, r, None, None);
                    }
                }
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
    app_handle: AppHandle,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let sess = connect_ssh_session(id)?;
    let (tx, rx) = channel::<SshMessage>();
    state.txs.lock().unwrap().insert(session_id.clone(), tx);
    let event_name = format!("term-output-{}", session_id);
    let connect_event = format!("ssh-connected-{}", session_id);
    let _ = app_handle.emit(&connect_event, true);
    thread::spawn(move || {
        let mut channel = sess.channel_session().unwrap();
        channel
            .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
            .unwrap();
        channel.shell().unwrap();
        sess.set_blocking(false);
        let mut buf = [0; 4096];
        loop {
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let _ = app_handle
                        .emit(&event_name, String::from_utf8_lossy(&buf[..n]).to_string());
                }
                Ok(_) => {
                    let _ = app_handle.emit(
                        &event_name,
                        "\r\n\x1b[1;31m[Verbindung beendet]\x1b[0m\r\n".to_string(),
                    );
                    let _ = app_handle.emit(&connect_event, false);
                    break;
                }
                Err(_) => {}
            }
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    SshMessage::Input(input) => {
                        let _ = channel.write_all(input.as_bytes());
                        let _ = channel.flush();
                    }
                    SshMessage::Resize(c, r) => {
                        let _ = channel.request_pty_size(c, r, None, None);
                    }
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    Ok(())
}
#[tauri::command]
fn sftp_list_dir(id: i32, path: String) -> Result<Vec<FileItem>, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let mut items = Vec::new();
    let dir_entries = sftp
        .readdir(Path::new(&path))
        .map_err(|_| format!("Pfad '{}' nicht gefunden", path))?;
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
fn sftp_mkdir(id: i32, path: String) -> Result<String, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    sftp.mkdir(Path::new(&path), 0o755)
        .map_err(|e| e.to_string())?;
    Ok("Ordner erstellt".to_string())
}

#[tauri::command]
fn sftp_rename(id: i32, old_path: String, new_path: String) -> Result<String, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
        .map_err(|e| e.to_string())?;
    Ok("Umbenannt".to_string())
}

#[tauri::command]
fn sftp_delete(id: i32, path: String) -> Result<String, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let stat = sftp.stat(Path::new(&path)).map_err(|e| e.to_string())?;
    if stat.is_dir() {
        sftp.rmdir(Path::new(&path)).map_err(|e| e.to_string())?;
    } else {
        sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())?;
    }
    Ok("Gelöscht".to_string())
}

#[tauri::command]
fn sftp_read_file(id: i32, path: String) -> Result<String, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let mut file = sftp.open(Path::new(&path)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

#[tauri::command]
fn sftp_write_file(id: i32, path: String, content: String) -> Result<String, String> {
    let sess = connect_ssh_session(id)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let mut file = sftp.create(Path::new(&path)).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok("Gespeichert".to_string())
}

#[tauri::command]
fn cancel_transfer(session_id: String, state: State<'_, SshState>) {
    if let Some(flag) = state.transfers.lock().unwrap().get(&session_id) {
        flag.store(true, Ordering::Relaxed);
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
) -> Result<String, String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .transfers
        .lock()
        .unwrap()
        .insert(session_id.clone(), Arc::clone(&cancel_flag));
    let s_id = session_id.clone();
    let inner_result = tauri::async_runtime::spawn_blocking(move || {
        let sess = connect_ssh_session(id)?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let mut transferred = 0;
        upload_recursive(
            &sftp,
            Path::new(&local_path),
            Path::new(&remote_path),
            &cancel_flag,
            &app,
            &s_id,
            std::time::Instant::now(),
            &mut transferred,
        )?;
        Ok("Upload abgeschlossen!".to_string())
    })
    .await
    .map_err(|_| "Thread Error".to_string())?;
    state.transfers.lock().unwrap().remove(&session_id);
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
) -> Result<String, String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .transfers
        .lock()
        .unwrap()
        .insert(session_id.clone(), Arc::clone(&cancel_flag));
    let s_id = session_id.clone();
    let inner_result = tauri::async_runtime::spawn_blocking(move || {
        let sess = connect_ssh_session(id)?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let mut transferred = 0;
        download_recursive(
            &sftp,
            Path::new(&remote_path),
            Path::new(&local_path),
            &cancel_flag,
            &app,
            &s_id,
            std::time::Instant::now(),
            &mut transferred,
        )?;
        Ok("Download abgeschlossen!".to_string())
    })
    .await
    .map_err(|_| "Thread Error".to_string())?;
    state.transfers.lock().unwrap().remove(&session_id);
    inner_result
}

#[tauri::command]
fn write_to_pty(
    session_id: String,
    input: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    if let Some(tx) = state.txs.lock().unwrap().get(&session_id) {
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
    if let Some(tx) = state.txs.lock().unwrap().get(&session_id) {
        let _ = tx.send(SshMessage::Resize(cols, rows));
    }
    Ok(())
}
#[tauri::command]
fn close_session(session_id: String, state: State<'_, SshState>) {
    state.txs.lock().unwrap().remove(&session_id);
}
#[tauri::command]
fn ping_host(host: String, port: u16) -> Result<u128, String> {
    let start = std::time::Instant::now();
    let addr_str = format!("{}:{}", host, port);
    if let Ok(mut addrs) = addr_str.to_socket_addrs() {
        if let Some(addr) = addrs.next() {
            if let Ok(_) = TcpStream::connect_timeout(&addr, Duration::from_millis(1500)) {
                return Ok(start.elapsed().as_millis());
            }
        }
    }
    Err("Timeout".to_string())
}

fn parse_meminfo_value_kib(source: &str, key: &str) -> Option<u64> {
    source.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let label = parts.next()?;
        if label.trim_end_matches(':') != key {
            return None;
        }
        parts.next()?.parse::<u64>().ok()
    })
}

#[tauri::command]
fn get_status_bar_info(server_id: i32) -> Result<StatusBarInfo, String> {
    let sess = connect_ssh_session(server_id)?;
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel
        .exec("sh -lc 'cat /proc/loadavg && printf \"\\n--TERMSSH--\\n\" && cat /proc/meminfo'")
        .map_err(|e| e.to_string())?;

    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| e.to_string())?;
    let _ = channel.wait_close();

    let mut parts = output.split("\n--TERMSSH--\n");
    let load_part = parts.next().unwrap_or_default();
    let mem_part = parts.next().unwrap_or_default();

    let load = load_part.split_whitespace().next().map(|s| s.to_string());

    let mem_total_kib = parse_meminfo_value_kib(mem_part, "MemTotal");
    let mem_available_kib = parse_meminfo_value_kib(mem_part, "MemAvailable");

    let ram = match (mem_total_kib, mem_available_kib) {
        (Some(total), Some(available)) => {
            let used = total.saturating_sub(available) as f64 / 1024.0 / 1024.0;
            let total_gb = total as f64 / 1024.0 / 1024.0;
            Some(format!("{used:.1} / {total_gb:.1} GB"))
        }
        _ => None,
    };

    Ok(StatusBarInfo { load, ram })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // FIX: X11 wieder erzwungen!
    std::env::set_var("GDK_BACKEND", "x11");
    init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init()) // <--- DIESE ZEILE FIXT DEN BACKUP ERROR
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(SshState {
            txs: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            tunnel_runtime: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            save_connection,
            get_connections,
            update_connection,
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
            close_session,
            ping_host,
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
            get_ssh_keys,
            save_ssh_key,
            delete_ssh_key,
            generate_ssh_key,
            get_tunnels,
            save_tunnel,
            update_tunnel,
            delete_tunnel,
            open_external_url,
            copy_text_to_clipboard,
            set_tray_visible,
            start_tunnel,
            stop_tunnel,
            get_active_tunnels
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(true);
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("Termina SSH v{}", version));
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

#[tauri::command]
fn open_external_url(_app: tauri::AppHandle, url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_text_to_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}
