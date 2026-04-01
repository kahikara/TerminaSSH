use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::app_paths::get_app_dir;
use tauri::{PhysicalPosition, PhysicalSize, Position, Size};

#[derive(Debug, Serialize, Deserialize)]
struct MainWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

pub(crate) fn is_wayland_session() -> bool {
    #[cfg(target_os = "linux")]
    {
        if let Ok(value) = std::env::var("WINIT_UNIX_BACKEND") {
            let value = value.trim().to_ascii_lowercase();
            if value == "x11" {
                return false;
            }
            if value == "wayland" {
                return true;
            }
        }

        if let Ok(value) = std::env::var("GDK_BACKEND") {
            let backends: Vec<String> = value
                .split(',')
                .map(|part| part.trim().to_ascii_lowercase())
                .filter(|part| !part.is_empty())
                .collect();

            if backends.iter().any(|part| part == "x11") {
                return false;
            }
            if backends.iter().any(|part| part == "wayland") {
                return true;
            }
        }

        std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|value| value.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false)
    }

    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn get_main_window_state_path() -> PathBuf {
    PathBuf::from(crate::get_app_dir()).join("main-window-state.json")
}

fn load_main_window_state() -> Option<MainWindowState> {
    let path = get_main_window_state_path();
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<MainWindowState>(&content).ok()
}

pub(crate) fn save_main_window_state(window: &tauri::WebviewWindow) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    let previous = load_main_window_state();

    let mut state = previous.unwrap_or(MainWindowState {
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
        maximized: false,
    });

    state.maximized = maximized;

    if !is_wayland_session() {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        state.x = position.x;
        state.y = position.y;
        state.width = size.width;
        state.height = size.height;
    }

    let path = get_main_window_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub(crate) fn restore_main_window_state(window: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(state) = load_main_window_state() else {
        return Ok(());
    };

    if is_wayland_session() {
        if state.maximized {
            let _ = window.maximize();
        }
        return Ok(());
    }

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(state.x, state.y)));

    if state.maximized {
        let _ = window.maximize();
    } else {
        let _ = window.set_size(Size::Physical(PhysicalSize::new(state.width, state.height)));
    }

    Ok(())
}
