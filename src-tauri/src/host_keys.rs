use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use ssh2::{CheckResult, HashType, HostKeyType, KnownHostFileKind, Session};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::ssh_runtime::tcp_connect_with_timeout;
use crate::{home_dir, SSH_CONNECT_TIMEOUT_SECS};

#[derive(Debug, Serialize)]
pub struct HostKeyCheckInfo {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) display_host: String,
    pub(crate) key_type: String,
    pub(crate) fingerprint: String,
    pub(crate) status: String,
    pub(crate) known_hosts_path: String,
}

pub(crate) fn get_known_hosts_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or("Could not determine home directory".to_string())?;
    let ssh_dir = home.join(".ssh");
    fs::create_dir_all(&ssh_dir).map_err(|e| e.to_string())?;
    Ok(ssh_dir.join("known_hosts"))
}

pub(crate) fn format_known_host_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

pub(crate) fn host_key_type_label(kind: HostKeyType) -> String {
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

pub(crate) fn read_known_hosts_file(known_hosts: &mut ssh2::KnownHosts, path: &Path) -> Result<(), String> {
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

pub(crate) fn run_ssh_keygen(args: &[&str]) -> Result<std::process::Output, String> {
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

pub(crate) fn remove_known_host_entry_with_ssh_keygen(host: &str, port: u16, path: &Path) {
    let path_str = path.to_string_lossy().to_string();
    let target = format_known_host_name(host, port);

    let _ = run_ssh_keygen(&["-R", &target, "-f", &path_str]);

    if port == 22 {
        let _ = run_ssh_keygen(&["-R", host, "-f", &path_str]);
    }
}

pub(crate) fn check_known_host_status_for_session(
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

pub(crate) fn ensure_known_host_match_for_session(
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

pub(crate) fn probe_host_key(
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


