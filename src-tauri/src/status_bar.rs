use serde::Serialize;
use std::io::Read;
use tauri::State;

use crate::ssh_runtime::connect_ssh_session;
use crate::VaultState;

#[derive(Debug, Serialize)]
pub(crate) struct StatusBarInfo {
    load: Option<String>,
    ram: Option<String>,
}

fn parse_meminfo_value_kib(source: &str, key: &str) -> Option<u64> {
    source.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let label = parts.next()?;
        if label.trim_end_matches(':') != key {
            return None;
        }
        parts.next()?.parse::<u64>().ok()
    })
}

#[tauri::command]
pub(crate) fn get_status_bar_info(
    server_id: i32,
    vault_state: State<'_, VaultState>,
) -> Result<StatusBarInfo, String> {
    const STATUS_SPLIT_MARKER: &str = "--TERMSSH--";

    let sess = connect_ssh_session(server_id, &vault_state)?;
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel
        .exec("sh -c 'if [ -r /proc/loadavg ] && [ -r /proc/meminfo ]; then cat /proc/loadavg && printf \"\\n--TERMSSH--\\n\" && cat /proc/meminfo; else printf \"--TERMSSH--\\n\"; fi'")
        .map_err(|e| e.to_string())?;

    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| e.to_string())?;
    let _ = channel.wait_close();

    let normalized_output = output.replace("\r\n", "\n");
    let marker_with_newlines = format!("\n{}\n", STATUS_SPLIT_MARKER);

    let (load_part, mem_part) = if let Some((left, right)) =
        normalized_output.split_once(&marker_with_newlines)
    {
        (left, right)
    } else if let Some(rest) = normalized_output.strip_prefix(&format!("{STATUS_SPLIT_MARKER}\n")) {
        ("", rest)
    } else {
        (normalized_output.as_str(), "")
    };

    let load = load_part
        .split_whitespace()
        .next()
        .filter(|value| *value != STATUS_SPLIT_MARKER)
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return None;
            }

            match trimmed.parse::<f64>() {
                Ok(_) => Some(trimmed.to_string()),
                Err(_) => None,
            }
        });

    let mem_total_kib = parse_meminfo_value_kib(mem_part, "MemTotal");
    let mem_available_kib = parse_meminfo_value_kib(mem_part, "MemAvailable");

    let ram = match (mem_total_kib, mem_available_kib) {
        (Some(total), Some(available)) => {
            let used = total.saturating_sub(available) as f64 / 1024.0 / 1024.0;
            let total_gb = total as f64 / 1024.0 / 1024.0;
            Some(format!("{used:.1} / {total_gb:.1} GB"))
        }
        _ => None,
    };

    Ok(StatusBarInfo { load, ram })
}
