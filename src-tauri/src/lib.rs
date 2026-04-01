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
mod app_state;
mod app_setup;

use crate::backup::{export_backup_bundle, import_backup_bundle};
use crate::connection_test::{check_host_key, test_connection, trust_host_key};
use crate::connections::{
    delete_connection, get_connections, save_connection, set_connection_password,
    update_connection,
};
use crate::external_commands::{
    copy_text_to_clipboard, open_external_url, reveal_path_in_file_manager, set_tray_visible,
};
use crate::local_fs::{
    get_local_home_dir, get_local_roots, local_delete, local_list_dir, local_mkdir,
    local_read_file, local_rename, local_write_file,
};
use crate::pty_commands::{
    close_session, resize_pty, start_local_pty, start_quick_ssh, start_ssh, write_to_pty,
};
use crate::sftp_commands::{
    cancel_transfer, sftp_delete, sftp_download, sftp_list_dir, sftp_mkdir, sftp_read_file,
    sftp_rename, sftp_upload, sftp_write_file,
};
use crate::snippets::{add_snippet, delete_snippet, get_snippets, update_snippet};
use crate::ssh_keys::{
    delete_ssh_key, generate_ssh_key, get_managed_keys_dir, get_ssh_keys, save_ssh_key,
};
use crate::status_bar::get_status_bar_info;
use crate::system_commands::{measure_tcp_latency, read_clipboard, write_clipboard};
use crate::tunnels::{
    delete_tunnel, get_active_tunnels, get_tunnels, save_tunnel, start_tunnel, stop_tunnel,
    update_tunnel,
};
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

pub(crate) use crate::app_paths::home_dir;
pub(crate) use crate::db_core::{
    current_export_timestamp, ensure_connection_exists, ignore_duplicate_column_error, open_db,
    open_vault_db, validate_snippet,
};
pub use crate::app_state::{AppMetaInfo, LinuxWindowModeInfo, SshMessage, SshState};
pub(crate) use crate::vault_core::{
    count_legacy_secret_entries, decode_vault_with_recovery, decode_vault_with_secret,
    delete_legacy_master_key, delete_vault_secret, ensure_vault_runtime_ready,
    finalize_legacy_master_key_cleanup_with_dek, generate_recovery_key, init_vault_db,
    load_vault_status, normalize_vault_unlock_mode, read_vault_secret_plaintext,
    require_runtime_vault_dek, upsert_vault_secret, vault_encrypt_combined,
};
pub use crate::vault_core::{
    EnableVaultProtectionResult, VaultRuntimeState, VaultState, VaultStatus,
};
pub(crate) use crate::vault_core::{
    DEFAULT_VAULT_UNLOCK_MODE, VAULT_DB_FILE_NAME, VAULT_KEY_LEN, VAULT_SALT_LEN,
    VAULT_SCHEMA_VERSION, VAULT_VALIDATION_TEXT,
};

pub(crate) const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
pub(crate) const DB_BUSY_TIMEOUT_SECS: u64 = 5;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_setup::prepare_runtime();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SshState::new())
        .manage(VaultState::new())
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
        .setup(|app| app_setup::setup_app(app))
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten");
}
