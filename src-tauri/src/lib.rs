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
mod db_core;
mod vault_core;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::{Emitter, Manager, WindowEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};


use crate::backup::{export_backup_bundle, import_backup_bundle};
pub(crate) use crate::app_paths::home_dir;
pub(crate) use crate::vault_core::{
    count_legacy_secret_entries, decode_vault_with_recovery, decode_vault_with_secret,
    delete_legacy_master_key, delete_vault_secret, ensure_vault_runtime_ready,
    finalize_legacy_master_key_cleanup_with_dek, generate_recovery_key, init_vault_db,
    load_vault_status, migrate_legacy_master_key_to_vault, normalize_vault_unlock_mode,
    read_vault_secret_plaintext, require_runtime_vault_dek, upsert_vault_secret,
    vault_encrypt_combined,
};
pub use crate::vault_core::{
    EnableVaultProtectionResult, VaultRuntimeState, VaultState, VaultStatus,
};
pub(crate) use crate::vault_core::{
    DEFAULT_VAULT_UNLOCK_MODE, VAULT_DB_FILE_NAME, VAULT_KEY_LEN, VAULT_SALT_LEN,
    VAULT_SCHEMA_VERSION, VAULT_VALIDATION_TEXT,
};

pub(crate) use crate::db_core::{
    current_export_timestamp, ensure_connection_exists, ignore_duplicate_column_error, init_db,
    open_db, open_vault_db, validate_snippet,
};

use crate::app_paths::maybe_relaunch_appimage_with_wayland_preload;
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

pub(crate) const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
const DB_BUSY_TIMEOUT_SECS: u64 = 5;

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
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

