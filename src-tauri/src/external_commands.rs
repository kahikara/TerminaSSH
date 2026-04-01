use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub(crate) fn open_external_url(_app: AppHandle, url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn reveal_path_in_file_manager(path: String) -> Result<(), String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("Path is empty".to_string());
    }

    let target = PathBuf::from(raw);
    if !target.exists() {
        return Err(format!("Path not found: {}", raw));
    }

    #[cfg(target_os = "windows")]
    {
        let normalized = target.to_string_lossy().replace("/", "\\");
        let mut cmd = Command::new("explorer");
        if target.is_file() {
            cmd.arg("/select,").arg(&normalized);
        } else {
            cmd.arg(&normalized);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if target.is_file() {
            cmd.arg("-R").arg(&target);
        } else {
            cmd.arg(&target);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let open_target = if target.is_dir() {
            target.clone()
        } else {
            target
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| target.clone())
        };

        Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn copy_text_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_tray_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}
