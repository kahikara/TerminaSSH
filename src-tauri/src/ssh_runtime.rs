use ssh2::Session;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

use crate::host_keys::ensure_known_host_match_for_session;
use crate::{
    ensure_vault_runtime_ready, home_dir, init_vault_db, open_db, open_vault_db,
    read_vault_secret_plaintext, require_runtime_vault_dek, SSH_CONNECT_TIMEOUT_SECS, VaultState,
};

#[derive(Debug, Clone)]
pub(crate) struct ConnectionRuntimeDetails {
    host: String,
    port: u16,
    username: String,
    password: String,
    private_key: String,
    passphrase: String,
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

pub(crate) fn tcp_connect_with_timeout(
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<TcpStream, String> {
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

pub(crate) fn connect_ssh_session(
    id: i32,
    vault_state: &State<'_, VaultState>,
) -> Result<Session, String> {
    connect_ssh_session_with_password_override(id, None, vault_state)
}
