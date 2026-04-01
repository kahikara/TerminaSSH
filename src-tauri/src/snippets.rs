use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{open_db, validate_snippet};

#[derive(Debug, Serialize)]
pub struct SnippetItem {
    id: i32,
    name: String,
    command: String,
}

fn normalize_snippet_name(name: &str) -> String {
    name.trim().to_string()
}

#[tauri::command]
pub(crate) fn get_snippets() -> Result<Vec<SnippetItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, command FROM snippets ORDER BY name COLLATE NOCASE ASC")
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([], |row| {
            Ok(SnippetItem {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
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
pub(crate) fn add_snippet(name: String, command: String, app: AppHandle) -> Result<String, String> {
    let name = normalize_snippet_name(&name);
    validate_snippet(&name, &command)?;

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO snippets (name, command) VALUES (?1, ?2)",
        (&name, &command),
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit("snippets-updated", ());
    Ok("Snippet saved".to_string())
}
#[tauri::command]
pub(crate) fn update_snippet(
    id: i32,
    name: String,
    command: String,
    app: AppHandle,
) -> Result<String, String> {
    let name = normalize_snippet_name(&name);
    validate_snippet(&name, &command)?;

    let conn = open_db()?;
    let updated = conn
        .execute(
            "UPDATE snippets SET name = ?1, command = ?2 WHERE id = ?3",
            (&name, &command, &id),
        )
        .map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Snippet not found".to_string());
    }

    let _ = app.emit("snippets-updated", ());
    Ok("Snippet updated".to_string())
}
#[tauri::command]
pub(crate) fn delete_snippet(id: i32, app: AppHandle) -> Result<String, String> {
    let conn = open_db()?;
    let deleted = conn
        .execute("DELETE FROM snippets WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if deleted == 0 {
        return Err("Snippet not found".to_string());
    }

    let _ = app.emit("snippets-updated", ());
    Ok("Snippet deleted".to_string())
}

