use tauri::{AppHandle, Manager};

use crate::window_state::save_main_window_state;
use crate::{AppMetaInfo, LinuxWindowModeInfo};

#[tauri::command]
pub(crate) fn get_linux_window_mode() -> Result<LinuxWindowModeInfo, String> {
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|value| value.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false);

        return Ok(LinuxWindowModeInfo {
            wayland_undecorated: is_wayland,
        });
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(LinuxWindowModeInfo {
            wayland_undecorated: false,
        })
    }
}

#[tauri::command]
pub(crate) fn get_app_meta(app: AppHandle) -> Result<AppMetaInfo, String> {
    Ok(AppMetaInfo {
        app_version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) fn window_minimize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn window_toggle_maximize(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;

    let is_maximized = window.is_maximized().map_err(|e| e.to_string())?;

    if is_maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub(crate) fn window_is_maximized(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn save_window_state_all(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    save_main_window_state(&window)
}

#[tauri::command]
pub(crate) fn window_close_main(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;
    let _ = save_main_window_state(&window);
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn current_window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn current_window_toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
    let is_maximized = window.is_maximized().map_err(|e| e.to_string())?;

    if is_maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub(crate) fn current_window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn current_window_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}
