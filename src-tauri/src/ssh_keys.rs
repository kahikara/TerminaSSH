use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::app_paths::get_keys_dir;
use crate::host_keys::run_ssh_keygen;
use crate::open_db;

#[derive(Debug, Serialize)]
pub(crate) struct SshKeyItem {
    id: i32,
    name: String,
    public_key: String,
    private_key_path: String,
    key_type: String,
    fingerprint: String,
}

fn normalize_ssh_key_name(name: &str) -> String {
    name.trim().to_string()
}

fn normalize_ssh_key_type(key_type: &str) -> String {
    let normalized = key_type.trim().to_lowercase();
    if normalized.is_empty() {
        "imported".to_string()
    } else {
        normalized
    }
}

fn ensure_ssh_key_unique(
    conn: &Connection,
    public_key: &str,
    private_key_path: &str,
) -> Result<(), String> {
    let existing_by_path: Option<String> = conn
        .query_row(
            "SELECT name FROM ssh_keys WHERE private_key_path = ?1 LIMIT 1",
            [&private_key_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(name) = existing_by_path {
        return Err(format!("SSH key already exists for this path: {}", name));
    }

    if !public_key.trim().is_empty() {
        let existing_by_public_key: Option<String> = conn
            .query_row(
                "SELECT name FROM ssh_keys WHERE public_key = ?1 LIMIT 1",
                [&public_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(name) = existing_by_public_key {
            return Err(format!("SSH key already exists: {}", name));
        }
    }

    Ok(())
}

pub(crate) fn read_public_key_for_path(private_key_path: &str) -> String {
    let pub_path = format!("{}.pub", private_key_path);
    fs::read_to_string(pub_path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(crate) fn fingerprint_for_pubkey_path(pub_path: &str) -> String {
    match run_ssh_keygen(&["-lf", pub_path]) {
        Ok(out) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                parts[1].to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

#[tauri::command]
pub(crate) fn get_managed_keys_dir() -> Result<String, String> {
    Ok(get_keys_dir())
}

#[tauri::command]
pub(crate) fn get_ssh_keys() -> Result<Vec<SshKeyItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, public_key, private_key_path, key_type, fingerprint FROM ssh_keys ORDER BY name COLLATE NOCASE ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([], |row| {
            Ok(SshKeyItem {
                id: row.get(0)?,
                name: row.get(1)?,
                public_key: row.get(2)?,
                private_key_path: row.get(3)?,
                key_type: row.get(4)?,
                fingerprint: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut res = Vec::new();
    for item in iter {
        res.push(item.map_err(|e| e.to_string())?);
    }
    Ok(res)
}

#[tauri::command]
pub(crate) fn save_ssh_key(
    name: String,
    public_key: String,
    private_key_path: String,
    key_type: String,
) -> Result<(), String> {
    let name = normalize_ssh_key_name(&name);
    if name.is_empty() {
        return Err("Key name is empty".to_string());
    }

    if private_key_path.trim().is_empty() {
        return Err("Private key path is empty".to_string());
    }

    let path = private_key_path.trim().to_string();
    if !Path::new(&path).exists() {
        return Err(format!("Key file not found: {}", path));
    }

    let normalized_key_type = normalize_ssh_key_type(&key_type);
    let public = if public_key.trim().is_empty() {
        read_public_key_for_path(&path)
    } else {
        public_key.trim().to_string()
    };

    let fingerprint = fingerprint_for_pubkey_path(&format!("{}.pub", path));

    let conn = open_db()?;
    ensure_ssh_key_unique(&conn, &public, &path)?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&name, &public, &path, &normalized_key_type, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn generate_ssh_key(name: String, key_type: String) -> Result<(), String> {
    let normalized_name = normalize_ssh_key_name(&name);
    if normalized_name.is_empty() {
        return Err("Key name is empty".to_string());
    }

    let safe_name: String = normalized_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let normalized_key_type = normalize_ssh_key_type(&key_type);
    let key_type_final = if normalized_key_type == "imported" {
        "ed25519".to_string()
    } else {
        normalized_key_type
    };

    let key_dir = get_keys_dir();
    let private_path = format!("{}/{}", key_dir, safe_name);
    let pub_path = format!("{}.pub", private_path);

    if Path::new(&private_path).exists() || Path::new(&pub_path).exists() {
        return Err("A key with that file name already exists".to_string());
    }

    let output = run_ssh_keygen(&[
        "-t",
        &key_type_final,
        "-f",
        &private_path,
        "-N",
        "",
        "-C",
        &normalized_name,
    ])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ssh-keygen failed: {}", stderr));
    }

    let public_key = fs::read_to_string(&pub_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let fingerprint = fingerprint_for_pubkey_path(&pub_path);

    let conn = open_db()?;
    ensure_ssh_key_unique(&conn, &public_key, &private_path)?;
    conn.execute(
        "INSERT INTO ssh_keys (name, public_key, private_key_path, key_type, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&normalized_name, &public_key, &private_path, &key_type_final, &fingerprint)
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn delete_ssh_key(id: i32) -> Result<(), String> {
    let conn = open_db()?;

    let mut stmt = conn
        .prepare("SELECT private_key_path, key_type FROM ssh_keys WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (private_key_path, key_type): (String, String) = stmt
        .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "SSH key not found".to_string(),
            _ => e.to_string(),
        })?;

    let deleted = conn
        .execute("DELETE FROM ssh_keys WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("SSH key not found".to_string());
    }

    let managed_dir = get_keys_dir();
    if key_type != "imported" && private_key_path.starts_with(&managed_dir) {
        let _ = fs::remove_file(&private_key_path);
        let _ = fs::remove_file(format!("{}.pub", private_key_path));
    }

    Ok(())
}

