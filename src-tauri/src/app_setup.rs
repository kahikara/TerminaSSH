use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

use crate::app_paths::maybe_relaunch_appimage_with_wayland_preload;
use crate::db_core::init_db;
use crate::vault_core::{
    ensure_vault_runtime_ready, init_vault_db, migrate_legacy_master_key_to_vault, VaultState,
};
use crate::window_state::{is_wayland_session, restore_main_window_state, save_main_window_state};

fn setup_main_window(app: &tauri::AppHandle) {
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
}

fn setup_tray(app: &mut tauri::App) -> Result<(), tauri::Error> {
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
}

pub(crate) fn prepare_runtime() {
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
}

pub(crate) fn setup_app(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Err(e) = ensure_vault_runtime_ready(&app.state::<VaultState>()) {
        eprintln!("Vault runtime init failed: {}", e);
    }

    setup_main_window(&app.handle());
    setup_tray(app)?;

    Ok(())
}
