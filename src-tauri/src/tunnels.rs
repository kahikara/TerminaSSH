use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, TcpListener};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::State;

use crate::app_state::SshState;
use crate::db_core::{ensure_connection_exists, open_db};
use crate::ssh_runtime::{connect_runtime_details, load_connection_runtime_details};
use crate::vault_core::VaultState;

#[derive(Debug, Serialize, Deserialize)]
pub struct SshTunnel {
    name: String,
    server_id: i32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_host: String,
    auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct TunnelItem {
    id: i32,
    name: String,
    server_id: i32,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_host: String,
    auto_start: bool,
}

#[derive(Debug, Serialize)]
pub struct ActiveTunnelItem {
    id: i32,
}


pub(crate) struct TunnelRuntimeEntry {
    pub(crate) stop_flag: Arc<AtomicBool>,
    pub(crate) handle: JoinHandle<()>,
}

fn take_finished_tunnel_entries(
    state: &State<'_, SshState>,
) -> Result<Vec<TunnelRuntimeEntry>, String> {
    let mut map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;

    let finished_ids: Vec<i32> = map
        .iter()
        .filter_map(|(id, entry)| entry.handle.is_finished().then_some(*id))
        .collect();

    let mut entries = Vec::new();
    for id in finished_ids {
        if let Some(entry) = map.remove(&id) {
            entries.push(entry);
        }
    }

    Ok(entries)
}

fn normalize_tunnel_fields(tunnel: &mut SshTunnel) {
    tunnel.name = tunnel.name.trim().to_string();
    tunnel.remote_host = tunnel.remote_host.trim().to_string();
    tunnel.bind_host = tunnel.bind_host.trim().to_string();
}


pub(crate) fn normalize_bind_host_value(bind_host: &str) -> String {
    let trimmed = bind_host.trim();
    if trimmed.is_empty() {
        "127.0.0.1".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn ensure_loopback_bind_host(bind_host: &str) -> Result<(), String> {
    let normalized = normalize_bind_host_value(bind_host);

    if normalized.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }

    if let Ok(addr) = normalized.parse::<IpAddr>() {
        if addr.is_loopback() {
            return Ok(());
        }
    }

    Err("Only loopback tunnel bind addresses are allowed. Use 127.0.0.1, ::1, or localhost.".to_string())
}

fn ensure_tunnel_route_is_unique(
    conn: &Connection,
    tunnel: &SshTunnel,
    bind_host: &str,
    exclude_id: Option<i32>,
) -> Result<(), String> {
    let existing: Option<String> = if let Some(exclude_id) = exclude_id {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE server_id = ?1 AND local_port = ?2 AND remote_host = ?3 AND remote_port = ?4 AND bind_host = ?5 AND id != ?6 LIMIT 1",
            (
                &tunnel.server_id,
                &tunnel.local_port,
                &tunnel.remote_host,
                &tunnel.remote_port,
                &bind_host,
                &exclude_id,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE server_id = ?1 AND local_port = ?2 AND remote_host = ?3 AND remote_port = ?4 AND bind_host = ?5 LIMIT 1",
            (
                &tunnel.server_id,
                &tunnel.local_port,
                &tunnel.remote_host,
                &tunnel.remote_port,
                &bind_host,
            ),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(name) = existing {
        Err(format!(
            "A tunnel with the same route already exists: {}",
            name
        ))
    } else {
        Ok(())
    }
}

fn ensure_tunnel_bind_target_is_unique(
    conn: &Connection,
    bind_host: &str,
    local_port: u16,
    exclude_id: Option<i32>,
) -> Result<(), String> {
    let existing: Option<String> = if let Some(exclude_id) = exclude_id {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE bind_host = ?1 AND local_port = ?2 AND id != ?3 LIMIT 1",
            (&bind_host, &local_port, &exclude_id),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT name FROM ssh_tunnels WHERE bind_host = ?1 AND local_port = ?2 LIMIT 1",
            (&bind_host, &local_port),
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(name) = existing {
        Err(format!(
            "Local bind address is already used by tunnel: {}",
            name
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn get_tunnels(server_id: i32) -> Result<Vec<TunnelItem>, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, server_id, local_port, remote_host, remote_port, bind_host, auto_start
         FROM ssh_tunnels
         WHERE server_id = ?1
         ORDER BY name ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt
        .query_map([&server_id], |row| {
            let auto_start_raw: i32 = row.get(7)?;
            Ok(TunnelItem {
                id: row.get(0)?,
                name: row.get(1)?,
                server_id: row.get(2)?,
                local_port: row.get(3)?,
                remote_host: row.get(4)?,
                remote_port: row.get(5)?,
                bind_host: row.get(6)?,
                auto_start: auto_start_raw != 0,
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
pub(crate) fn save_tunnel(mut tunnel: SshTunnel) -> Result<String, String> {
    normalize_tunnel_fields(&mut tunnel);

    if tunnel.name.is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }
    let bind_host = normalize_bind_host_value(&tunnel.bind_host);
    ensure_loopback_bind_host(&bind_host)?;

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, None)?;
    ensure_tunnel_route_is_unique(&conn, &tunnel, &bind_host, None)?;

    conn.execute(
        "INSERT INTO ssh_tunnels (server_id, name, local_port, remote_host, remote_port, bind_host, auto_start)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            &tunnel.server_id,
            &tunnel.name,
            &tunnel.local_port,
            &tunnel.remote_host,
            &tunnel.remote_port,
            &bind_host,
            &(if tunnel.auto_start { 1 } else { 0 }),
        )
    ).map_err(|e| e.to_string())?;

    Ok("Tunnel saved".to_string())
}
#[tauri::command]
pub(crate) fn update_tunnel(
    id: i32,
    mut tunnel: SshTunnel,
    state: State<'_, SshState>,
) -> Result<String, String> {
    normalize_tunnel_fields(&mut tunnel);

    if tunnel.name.is_empty() {
        return Err("Tunnel name is empty".to_string());
    }
    if tunnel.remote_host.is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Ports must be greater than 0".to_string());
    }

    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    {
        let map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        if map.contains_key(&id) {
            return Err("Stop the tunnel before editing it".to_string());
        }
    }
    let bind_host = normalize_bind_host_value(&tunnel.bind_host);
    ensure_loopback_bind_host(&bind_host)?;

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, Some(id))?;
    ensure_tunnel_route_is_unique(&conn, &tunnel, &bind_host, Some(id))?;

    let updated = conn.execute(
        "UPDATE ssh_tunnels
         SET server_id = ?1, name = ?2, local_port = ?3, remote_host = ?4, remote_port = ?5, bind_host = ?6, auto_start = ?7
         WHERE id = ?8",
        (
            &tunnel.server_id,
            &tunnel.name,
            &tunnel.local_port,
            &tunnel.remote_host,
            &tunnel.remote_port,
            &bind_host,
            &(if tunnel.auto_start { 1 } else { 0 }),
            &id,
        )
    ).map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Tunnel not found".to_string());
    }

    Ok("Tunnel updated".to_string())
}
#[tauri::command]
pub(crate) fn delete_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
    let entry = {
        let mut map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        map.remove(&id)
    };

    if let Some(entry) = entry {
        entry.stop_flag.store(true, Ordering::Relaxed);
        let _ = entry.handle.join();
    }

    let conn = open_db()?;
    let deleted = conn
        .execute("DELETE FROM ssh_tunnels WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Err("Tunnel not found".to_string());
    }
    Ok("Tunnel deleted".to_string())
}

fn get_tunnel_by_id(id: i32) -> Result<TunnelItem, String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, server_id, local_port, remote_host, remote_port, bind_host, auto_start
         FROM ssh_tunnels
         WHERE id = ?1"
    ).map_err(|e| e.to_string())?;

    stmt.query_row([&id], |row| {
        let auto_start_raw: i32 = row.get(7)?;
        Ok(TunnelItem {
            id: row.get(0)?,
            name: row.get(1)?,
            server_id: row.get(2)?,
            local_port: row.get(3)?,
            remote_host: row.get(4)?,
            remote_port: row.get(5)?,
            bind_host: row.get(6)?,
            auto_start: auto_start_raw != 0,
        })
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "Tunnel not found".to_string(),
        _ => e.to_string(),
    })
}

#[tauri::command]
pub(crate) fn get_active_tunnels(state: State<'_, SshState>) -> Result<Vec<ActiveTunnelItem>, String> {
    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    let map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    let items = map.keys().map(|id| ActiveTunnelItem { id: *id }).collect();
    Ok(items)
}

#[tauri::command]
pub(crate) fn start_tunnel(
    id: i32,
    state: State<'_, SshState>,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let finished_entries = take_finished_tunnel_entries(&state)?;
    for entry in finished_entries {
        let _ = entry.handle.join();
    }

    {
        let map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        if map.contains_key(&id) {
            return Ok("Tunnel already running".to_string());
        }
    }

    let tunnel = get_tunnel_by_id(id)?;
    if tunnel.remote_host.trim().is_empty() {
        return Err("Remote host is empty".to_string());
    }
    if tunnel.local_port == 0 || tunnel.remote_port == 0 {
        return Err("Tunnel ports must be greater than 0".to_string());
    }

    let conn = open_db()?;
    ensure_connection_exists(&conn, tunnel.server_id)?;
    let tunnel_runtime_details =
        load_connection_runtime_details(tunnel.server_id, None, &vault_state)?;
    let bind_host = normalize_bind_host_value(&tunnel.bind_host);
    ensure_loopback_bind_host(&bind_host)?;
    ensure_tunnel_bind_target_is_unique(&conn, &bind_host, tunnel.local_port, Some(id))?;
    let bind_addr = format!("{}:{}", bind_host, tunnel.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .map_err(|e| format!("Failed to bind {}: {}", bind_addr, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_thread = Arc::clone(&stop_flag);

    let remote_host = tunnel.remote_host.trim().to_string();
    let remote_port = tunnel.remote_port;

    let handle = thread::spawn(move || loop {
        if stop_flag_thread.load(Ordering::Relaxed) {
            break;
        }

        match listener.accept() {
            Ok((inbound, _addr)) => {
                let remote_host_clone = remote_host.clone();
                let connection_details = tunnel_runtime_details.clone();
                thread::spawn(move || {
                    let sess = match connect_runtime_details(&connection_details) {
                        Ok(s) => s,
                        Err(_) => return,
                    };

                    let mut channel =
                        match sess.channel_direct_tcpip(&remote_host_clone, remote_port, None) {
                            Ok(c) => c,
                            Err(_) => return,
                        };

                    let mut inbound_read = match inbound.try_clone() {
                        Ok(s) => s,
                        Err(_) => return,
                    };

                    let mut inbound_write = inbound;

                    let mut channel_clone = channel.stream(0);

                    let t1 = thread::spawn(move || {
                        let _ = std::io::copy(&mut inbound_read, &mut channel);
                    });

                    let _ = std::io::copy(&mut channel_clone, &mut inbound_write);
                    let _ = t1.join();
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                break;
            }
        }
    });

    let mut map = state
        .tunnel_runtime
        .lock()
        .map_err(|_| "Tunnel state lock failed".to_string())?;
    map.insert(id, TunnelRuntimeEntry { stop_flag, handle });

    Ok(format!("Tunnel running on {}", bind_addr))
}

#[tauri::command]
pub(crate) fn stop_tunnel(id: i32, state: State<'_, SshState>) -> Result<String, String> {
    let entry = {
        let mut map = state
            .tunnel_runtime
            .lock()
            .map_err(|_| "Tunnel state lock failed".to_string())?;
        map.remove(&id)
    };

    if let Some(entry) = entry {
        entry.stop_flag.store(true, Ordering::Relaxed);
        let _ = entry.handle.join();
        return Ok("Tunnel stopped".to_string());
    }

    let conn = open_db()?;
    let exists: Option<i32> = conn
        .query_row(
            "SELECT id FROM ssh_tunnels WHERE id = ?1 LIMIT 1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if exists.is_some() {
        Ok("Tunnel was not running".to_string())
    } else {
        Err("Tunnel not found".to_string())
    }
}