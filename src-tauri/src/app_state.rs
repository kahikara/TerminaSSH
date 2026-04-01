use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use crate::tunnels::TunnelRuntimeEntry;

#[derive(Debug, Serialize)]
pub struct LinuxWindowModeInfo {
    pub(crate) wayland_undecorated: bool,
}

#[derive(Debug, Serialize)]
pub struct AppMetaInfo {
    pub(crate) app_version: String,
}

pub enum SshMessage {
    Input(String),
    Resize(u32, u32),
}

pub struct SshState {
    pub(crate) txs: Mutex<HashMap<String, Sender<SshMessage>>>,
    pub(crate) transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub(crate) tunnel_runtime: Mutex<HashMap<i32, TunnelRuntimeEntry>>,
}

impl SshState {
    pub(crate) fn new() -> Self {
        Self {
            txs: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            tunnel_runtime: Mutex::new(HashMap::new()),
        }
    }
}
