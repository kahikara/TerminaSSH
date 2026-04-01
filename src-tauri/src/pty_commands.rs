use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use ssh2::Session;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, TryRecvError};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::host_keys::ensure_known_host_match_for_session;
use crate::{
    SSH_CONNECT_TIMEOUT_SECS, SshMessage, SshState, VaultState, authenticate_session,
    connect_ssh_session_with_password_override, tcp_connect_with_timeout,
};

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



#[tauri::command]
pub(crate) fn start_local_pty(
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
pub(crate) fn start_quick_ssh(
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
pub(crate) fn start_ssh(
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
pub(crate) fn write_to_pty(
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
pub(crate) fn resize_pty(
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
pub(crate) fn close_session(session_id: String, state: State<'_, SshState>) {
    if let Ok(mut txs) = state.txs.lock() {
        txs.remove(&session_id);
    }
}


