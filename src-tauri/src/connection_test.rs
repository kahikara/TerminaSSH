use serde::Serialize;
use ssh2::{CheckResult, KnownHostFileKind, KnownHostKeyFormat};

use crate::ssh_runtime::authenticate_session;
use crate::connections::{normalize_connection_fields, validate_connection, SshConnection};
use crate::host_keys::{
    HostKeyCheckInfo, check_known_host_status_for_session, format_known_host_name,
    get_known_hosts_path, host_key_type_label, probe_host_key, read_known_hosts_file,
    remove_known_host_entry_with_ssh_keygen,
};

#[derive(Debug, Serialize)]
pub(crate) struct ConnectionTestResult {
    success: bool,
    auth_ok: bool,
    sftp_ok: bool,
    host_key_status: String,
    key_type: String,
    fingerprint: String,
    message: String,
}

#[tauri::command]
pub(crate) fn test_connection(
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
pub(crate) fn check_host_key(host: String, port: u16) -> Result<HostKeyCheckInfo, String> {
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
pub(crate) fn trust_host_key(host: String, port: u16) -> Result<(), String> {
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
