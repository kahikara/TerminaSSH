use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::ssh_runtime::tcp_connect_with_timeout;

#[tauri::command]
pub(crate) fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn measure_tcp_latency(host: String, port: u16) -> Result<u128, String> {
    let start = Instant::now();
    tcp_connect_with_timeout(&host, port, Duration::from_millis(1500))?;
    Ok(start.elapsed().as_millis())
}
