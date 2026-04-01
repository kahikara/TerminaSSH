use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::home_dir;
use crate::sftp_commands::{FileItem, SftpReadFilePayload};

pub(crate) fn normalize_local_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn map_local_fs_error(err: &std::io::Error, action: &str, path: &Path) -> String {
    let display = path.to_string_lossy();

    match err.kind() {
        std::io::ErrorKind::NotFound => format!("{} not found: {}", action, display),
        std::io::ErrorKind::PermissionDenied => {
            format!("{} permission denied: {}", action, display)
        }
        std::io::ErrorKind::AlreadyExists => format!("{} already exists: {}", action, display),
        _ => format!("{} failed for {}: {}", action, display, err),
    }
}

#[tauri::command]
pub(crate) fn local_list_dir(path: String) -> Result<Vec<FileItem>, String> {
    let path = normalize_local_path(&path)?;

    let metadata =
        fs::metadata(&path).map_err(|e| map_local_fs_error(&e, "List directory", &path))?;
    if !metadata.is_dir() {
        return Err(format!(
            "List directory failed for {}: Not a directory",
            path.to_string_lossy()
        ));
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| map_local_fs_error(&e, "List directory", &path))? {
        let entry = entry.map_err(|e| map_local_fs_error(&e, "List directory", &path))?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == "." || name == ".." {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        let link_metadata = fs::symlink_metadata(&entry_path).ok();
        let resolved_metadata = if file_type.is_symlink() {
            fs::metadata(&entry_path).ok()
        } else {
            None
        };

        let is_dir = file_type.is_dir()
            || resolved_metadata
                .as_ref()
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);

        let size = if is_dir {
            0
        } else {
            link_metadata
                .as_ref()
                .map(|metadata| metadata.len())
                .or_else(|| resolved_metadata.as_ref().map(|metadata| metadata.len()))
                .unwrap_or(0)
        };

        items.push(FileItem { name, is_dir, size });
    }

    items.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
pub(crate) fn local_mkdir(path: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    fs::create_dir(&path).map_err(|e| map_local_fs_error(&e, "Create folder", &path))?;
    Ok("Folder created".to_string())
}

#[tauri::command]
pub(crate) fn local_rename(old_path: String, new_path: String) -> Result<String, String> {
    let old_path = normalize_local_path(&old_path)?;
    let new_path = normalize_local_path(&new_path)?;
    fs::rename(&old_path, &new_path).map_err(|e| map_local_fs_error(&e, "Rename", &old_path))?;
    Ok("Renamed".to_string())
}

#[tauri::command]
pub(crate) fn local_delete(path: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    let link_metadata =
        fs::symlink_metadata(&path).map_err(|e| map_local_fs_error(&e, "Delete target", &path))?;

    if link_metadata.file_type().is_symlink() {
        fs::remove_file(&path).map_err(|e| map_local_fs_error(&e, "Delete link", &path))?;
    } else if link_metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| map_local_fs_error(&e, "Delete folder", &path))?;
    } else {
        fs::remove_file(&path).map_err(|e| map_local_fs_error(&e, "Delete file", &path))?;
    }

    Ok("Deleted".to_string())
}

#[tauri::command]
pub(crate) fn local_read_file(path: String) -> Result<SftpReadFilePayload, String> {
    let path = normalize_local_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|e| map_local_fs_error(&e, "Read file", &path))?;

    if metadata.is_dir() {
        return Err(format!(
            "Read file failed for {}: Path is a directory",
            path.to_string_lossy()
        ));
    }

    let bytes = fs::read(&path).map_err(|e| map_local_fs_error(&e, "Read file", &path))?;
    Ok(SftpReadFilePayload {
        content_base64: STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub(crate) fn local_write_file(path: String, content_base64: String) -> Result<String, String> {
    let path = normalize_local_path(&path)?;
    let bytes = STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|e| format!("Invalid base64 content: {}", e))?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| map_local_fs_error(&e, "Prepare parent folder", parent))?;
        }
    }

    fs::write(&path, bytes).map_err(|e| map_local_fs_error(&e, "Write file", &path))?;
    Ok("Saved".to_string())
}

#[tauri::command]
pub(crate) fn get_local_home_dir() -> Result<String, String> {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));

    match fs::canonicalize(&home) {
        Ok(resolved) => Ok(resolved.to_string_lossy().to_string()),
        Err(_) => Ok(home.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub(crate) fn get_local_roots() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();

        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                roots.push(root);
            }
        }

        return Ok(roots);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

