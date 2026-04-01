use std::fs;
use std::path::{Path, PathBuf};

const APP_DIR_NAME: &str = "terminassh";
const LEGACY_APP_DIR_NAME: &str = "ssh-mgr";

#[cfg(target_os = "linux")]
pub(crate) fn maybe_relaunch_appimage_with_wayland_preload() {
    use std::process::Command;

    let appimage = match std::env::var("APPIMAGE") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return,
    };

    if std::env::var_os("TERMSSH_APPIMAGE_RELAUNCHED").is_some() {
        return;
    }

    if std::env::var_os("LD_PRELOAD").is_some() {
        return;
    }

    let candidates = [
        "/usr/lib/libwayland-client.so",
        "/usr/lib64/libwayland-client.so",
        "/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/lib64/libwayland-client.so.0",
    ];

    let preload = candidates
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .map(|candidate| (*candidate).to_string());

    let Some(preload) = preload else {
        return;
    };

    let args: Vec<String> = std::env::args().skip(1).collect();

    let spawn_result = Command::new(&appimage)
        .args(args)
        .env("LD_PRELOAD", &preload)
        .env("TERMSSH_APPIMAGE_RELAUNCHED", "1")
        .spawn();

    if spawn_result.is_ok() {
        std::process::exit(0);
    }
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn maybe_relaunch_appimage_with_wayland_preload() {}

pub(crate) fn home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        return Some(PathBuf::from(home));
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        return Some(PathBuf::from(user_profile));
    }

    None
}

#[cfg(target_os = "windows")]
fn get_platform_config_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata);
    }

    if let Some(home) = home_dir() {
        return home.join("AppData").join("Roaming");
    }

    PathBuf::from(".")
}

#[cfg(target_os = "macos")]
fn get_platform_config_root() -> PathBuf {
    if let Some(home) = home_dir() {
        return home.join("Library").join("Application Support");
    }

    PathBuf::from(".")
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn get_platform_config_root() -> PathBuf {
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg_config_home);
    }

    if let Some(home) = home_dir() {
        return home.join(".config");
    }

    PathBuf::from(".")
}

fn legacy_app_dirs(config_root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![config_root.join(LEGACY_APP_DIR_NAME)];

    if let Some(home) = home_dir() {
        let legacy_home_config = home.join(".config").join(LEGACY_APP_DIR_NAME);
        if !dirs.iter().any(|p| p == &legacy_home_config) {
            dirs.push(legacy_home_config);
        }
    }

    dirs
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src = entry.path();
        let dst = to.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else if file_type.is_file() {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

fn migrate_legacy_app_dir(legacy_dir: &Path, new_dir: &Path) {
    if new_dir.exists() || !legacy_dir.exists() {
        return;
    }

    if fs::rename(legacy_dir, new_dir).is_ok() {
        return;
    }

    let _ = copy_dir_recursive(legacy_dir, new_dir);
}

pub(crate) fn get_app_dir() -> String {
    let config_root = get_platform_config_root();
    let new_dir = config_root.join(APP_DIR_NAME);

    if !new_dir.exists() {
        for legacy_dir in legacy_app_dirs(&config_root) {
            migrate_legacy_app_dir(&legacy_dir, &new_dir);
            if new_dir.exists() {
                break;
            }
        }
    }

    let _ = fs::create_dir_all(&new_dir);
    new_dir.to_string_lossy().to_string()
}

pub(crate) fn get_db_path() -> String {
    format!("{}/connections.db", get_app_dir())
}

pub(crate) fn get_vault_db_path() -> String {
    format!("{}/{}", get_app_dir(), crate::VAULT_DB_FILE_NAME)
}

pub(crate) fn get_key_path() -> String {
    format!("{}/master.key", get_app_dir())
}

pub(crate) fn get_keys_dir() -> String {
    let dir = format!("{}/keys", get_app_dir());
    let _ = fs::create_dir_all(&dir);
    dir
}

pub(crate) fn read_file_base64_if_exists(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if !Path::new(trimmed).exists() {
        return String::new();
    }

    fs::read(trimmed)
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        .unwrap_or_default()
}

pub(crate) fn sanitize_key_file_stem(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if cleaned.is_empty() {
        "imported_key".to_string()
    } else {
        cleaned
    }
}

pub(crate) fn ensure_unique_key_path(dir: &str, stem: &str) -> String {
    let mut candidate = format!("{}/{}", dir, stem);
    let mut index = 1usize;

    while Path::new(&candidate).exists() || Path::new(&format!("{}.pub", candidate)).exists() {
        candidate = format!("{}/{}_{}", dir, stem, index);
        index += 1;
    }

    candidate
}

pub(crate) fn cleanup_imported_key_files(paths: &[String]) {
    for private_path in paths {
        let _ = fs::remove_file(private_path);
        let _ = fs::remove_file(format!("{}.pub", private_path));
    }
}
