use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::local_fs::normalize_local_path;
use crate::ssh_runtime::{
    connect_runtime_details, connect_ssh_session, load_connection_runtime_details,
};
use crate::{SshState, VaultState};

#[derive(Debug, Serialize)]
pub(crate) struct FileItem {
    pub(crate) name: String,
    pub(crate) is_dir: bool,
    pub(crate) size: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpReadFilePayload {
    pub(crate) content_base64: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct SftpProgress {
    transferred: u64,
    total: u64,
    speed: f64,
    current_file: String,
}


const SFTP_FILE_READ_LIMIT_BYTES: u64 = 16 * 1024 * 1024;
const SFTP_FILE_WRITE_LIMIT_BYTES: usize = 16 * 1024 * 1024;

fn register_transfer_session(
    state: &State<'_, SshState>,
    session_id: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut transfers = state
        .transfers
        .lock()
        .map_err(|_| "SFTP transfer state lock failed".to_string())?;

    if transfers.contains_key(session_id) {
        return Err(format!("Transfer '{}' is already active", session_id));
    }

    transfers.insert(session_id.to_string(), cancel_flag);
    Ok(())
}

fn clear_transfer_session(state: &State<'_, SshState>, session_id: &str) {
    if let Ok(mut transfers) = state.transfers.lock() {
        transfers.remove(session_id);
    }
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

fn delete_remote_path_recursive(sftp: &ssh2::Sftp, path: &Path) -> Result<(), String> {
    let display = path.to_string_lossy().to_string();
    let stat = sftp
        .stat(path)
        .map_err(|e| map_sftp_path_error(e, "Delete target", &display))?;

    if stat.is_dir() {
        let entries = sftp
            .readdir(path)
            .map_err(|e| map_sftp_path_error(e, "List directory", &display))?;

        for (entry_path, _) in entries {
            let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };

            if name == "." || name == ".." {
                continue;
            }

            delete_remote_path_recursive(sftp, &entry_path)?;
        }

        sftp.rmdir(path)
            .map_err(|e| map_sftp_path_error(e, "Delete folder", &display))?;
    } else {
        sftp.unlink(path)
            .map_err(|e| map_sftp_path_error(e, "Delete file", &display))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn sftp_list_dir(
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
pub(crate) fn sftp_mkdir(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    sftp.mkdir(Path::new(&path), 0o755)
        .map_err(|e| map_sftp_path_error(e, "Create folder", &path))?;
    Ok("Folder created".to_string())
}

#[tauri::command]
pub(crate) fn sftp_rename(
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
pub(crate) fn sftp_delete(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    delete_remote_path_recursive(&sftp, Path::new(&path))?;
    Ok("Deleted".to_string())
}

#[tauri::command]
pub(crate) fn sftp_read_file(
    id: i32,
    path: String,
    vault_state: State<'_, VaultState>,
) -> Result<SftpReadFilePayload, String> {
    let path = normalize_remote_path(&path)?;
    let sess = connect_ssh_session(id, &vault_state)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP Fehler: {}", e))?;
    let file_path = Path::new(&path);

    let stat = sftp
        .stat(file_path)
        .map_err(|e| map_sftp_path_error(e, "Read file", &path))?;

    if stat.is_dir() {
        return Err(format!("Read file failed for {}: Path is a directory", path));
    }

    if let Some(size) = stat.size {
        if size > SFTP_FILE_READ_LIMIT_BYTES {
            return Err(format!(
                "Read file denied for {}: file is larger than {} MiB",
                path,
                SFTP_FILE_READ_LIMIT_BYTES / 1024 / 1024
            ));
        }
    }

    let mut file = sftp
        .open(file_path)
        .map_err(|e| map_sftp_path_error(e, "Read file", &path))?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        let n = file
            .read(&mut chunk)
            .map_err(|e| format!("Read failed for {}: {}", path, e))?;
        if n == 0 {
            break;
        }

        buf.extend_from_slice(&chunk[..n]);

        if buf.len() > SFTP_FILE_READ_LIMIT_BYTES as usize {
            return Err(format!(
                "Read file denied for {}: file exceeded the {} MiB safety limit",
                path,
                SFTP_FILE_READ_LIMIT_BYTES / 1024 / 1024
            ));
        }
    }

    Ok(SftpReadFilePayload {
        content_base64: STANDARD.encode(&buf),
    })
}

#[tauri::command]
pub(crate) fn sftp_write_file(
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

    if bytes.len() > SFTP_FILE_WRITE_LIMIT_BYTES {
        return Err(format!(
            "Write file denied for {}: content is larger than {} MiB",
            path,
            SFTP_FILE_WRITE_LIMIT_BYTES / 1024 / 1024
        ));
    }

    let mut file = sftp
        .create(Path::new(&path))
        .map_err(|e| map_sftp_path_error(e, "Write file", &path))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Write failed for {}: {}", path, e))?;
    Ok("Saved".to_string())
}

#[tauri::command]
pub(crate) fn cancel_transfer(session_id: String, state: State<'_, SshState>) {
    let flag = state
        .transfers
        .lock()
        .ok()
        .and_then(|transfers| transfers.get(&session_id).cloned());

    if let Some(flag) = flag {
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
pub(crate) async fn sftp_upload(
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
    register_transfer_session(&state, &session_id, Arc::clone(&cancel_flag))?;
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

    clear_transfer_session(&state, &session_id);

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
pub(crate) async fn sftp_download(
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
    register_transfer_session(&state, &session_id, Arc::clone(&cancel_flag))?;
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

    clear_transfer_session(&state, &session_id);

    let inner_result = join_result.map_err(|_| "Thread Error".to_string())?;
    inner_result
}
