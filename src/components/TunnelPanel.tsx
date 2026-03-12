import React, { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  X,
  Plus,
  RefreshCw,
  Copy,
  Pencil,
  Trash2,
  Cable,
  ChevronRight,
  Play,
  Square
} from "lucide-react"

type TunnelItem = {
  id: number
  name: string
  server_id: number
  local_port: number
  remote_host: string
  remote_port: number
  bind_host: string
  auto_start: boolean
}

type TunnelForm = {
  name: string
  server_id: number
  local_port: number
  remote_host: string
  remote_port: number
  bind_host: string
  auto_start: boolean
}

const TUNNEL_PANEL_WIDTH_KEY = "termina_tunnel_panel_width"
const TUNNEL_PANEL_MIN_WIDTH = 300
const TUNNEL_PANEL_MAX_WIDTH = 720
const TUNNEL_PANEL_DEFAULT_WIDTH = 352

function clampTunnelPanelWidth(value: number) {
  return Math.max(TUNNEL_PANEL_MIN_WIDTH, Math.min(TUNNEL_PANEL_MAX_WIDTH, value))
}

function readStoredTunnelPanelWidth() {
  try {
    const raw = localStorage.getItem(TUNNEL_PANEL_WIDTH_KEY)
    if (!raw) return TUNNEL_PANEL_DEFAULT_WIDTH
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return TUNNEL_PANEL_DEFAULT_WIDTH
    return clampTunnelPanelWidth(parsed)
  } catch {
    return TUNNEL_PANEL_DEFAULT_WIDTH
  }
}

function persistTunnelPanelWidth(value: number) {
  try {
    localStorage.setItem(TUNNEL_PANEL_WIDTH_KEY, String(clampTunnelPanelWidth(value)))
  } catch {}
}

const shellStyle: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  background: "color-mix(in srgb, var(--bg-sidebar) 88%, var(--bg-app))",
  borderLeft: "1px solid var(--border-subtle)",
  zIndex: 25,
  transition: "transform 220ms ease, opacity 220ms ease",
  overflow: "hidden",
  boxShadow: "-14px 0 34px rgba(0,0,0,0.18)"
}

function defaultForm(serverId: number): TunnelForm {
  return {
    name: "",
    server_id: serverId,
    local_port: 5433,
    remote_host: "127.0.0.1",
    remote_port: 5432,
    bind_host: "127.0.0.1",
    auto_start: false
  }
}

function tunnelAddress(item: TunnelItem | TunnelForm) {
  return `${item.bind_host || "127.0.0.1"}:${item.local_port}`
}

function statusStyles(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 9px",
    height: 26,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: active ? "rgba(34,197,94,0.14)" : "rgba(148,163,184,0.12)",
    color: active ? "rgb(134,239,172)" : "var(--text-muted)",
    border: active ? "1px solid rgba(34,197,94,0.24)" : "1px solid var(--border-subtle)"
  }
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="ui-label">{label}</span>
      {children}
    </label>
  )
}

export default function TunnelPanel({
  server,
  visible,
  onClose,
  showToast
}: any) {
  const [items, setItems] = useState<TunnelItem[]>([])
  const [activeTunnelIds, setActiveTunnelIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<TunnelItem | null>(null)
  const [editingItem, setEditingItem] = useState<TunnelItem | null>(null)
  const [form, setForm] = useState<TunnelForm>(defaultForm(server?.id))
  const [panelWidth, setPanelWidth] = useState(readStoredTunnelPanelWidth())

  const resizeDragRef = useRef(false)

  const title = useMemo(() => {
    return server?.name || server?.host || "Server"
  }, [server])

  async function loadTunnels() {
    if (!server?.id || server?.id === "local") return

    try {
      setLoading(true)
      const res = await invoke("get_tunnels", { serverId: server.id }) as TunnelItem[]
      setItems(res)

      const active = await invoke("get_active_tunnels") as { id: number }[]
      setActiveTunnelIds(active.map((x) => x.id))
    } catch (e: any) {
      showToast?.(`Tunnel load failed: ${String(e)}`, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible && server?.id && server.id !== "local") {
      setForm(defaultForm(server.id))
      loadTunnels().then(() => {
        void ensureAutoStart()
      })
    }
  }, [visible, server?.id])

  useEffect(() => {
    persistTunnelPanelWidth(panelWidth)
  }, [panelWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeDragRef.current) return
      const next = clampTunnelPanelWidth(window.innerWidth - e.clientX)
      setPanelWidth(next)
    }

    const onUp = () => {
      if (!resizeDragRef.current) return
      resizeDragRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)

    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  function openCreate() {
    setEditingItem(null)
    setForm(defaultForm(server.id))
    setEditorOpen(true)
  }

  function openEdit(item: TunnelItem) {
    if (activeTunnelIds.includes(item.id)) {
      showToast?.("Stop the tunnel before editing it", true)
      return
    }

    setEditingItem(item)
    setForm({
      name: item.name,
      server_id: item.server_id,
      local_port: item.local_port,
      remote_host: item.remote_host,
      remote_port: item.remote_port,
      bind_host: item.bind_host,
      auto_start: item.auto_start
    })
    setEditorOpen(true)
  }

  async function saveCurrent() {
    try {
      if (!form.name.trim()) {
        showToast?.("Tunnel name is required", true)
        return
      }

      if (editingItem) {
        await invoke("update_tunnel", {
          id: editingItem.id,
          tunnel: form
        })
      } else {
        await invoke("save_tunnel", {
          tunnel: form
        })
      }

      setEditorOpen(false)
      setEditingItem(null)
      await loadTunnels()
      showToast?.(editingItem ? "Tunnel updated" : "Tunnel saved")
    } catch (e: any) {
      showToast?.(`Tunnel save failed: ${String(e)}`, true)
    }
  }

  async function deleteCurrent() {
    if (!deleteItem) return

    if (activeTunnelIds.includes(deleteItem.id)) {
      showToast?.("Stop the tunnel before deleting it", true)
      return
    }

    try {
      await invoke("delete_tunnel", { id: deleteItem.id })
      setDeleteItem(null)
      await loadTunnels()
      showToast?.("Tunnel deleted")
    } catch (e: any) {
      showToast?.(`Tunnel delete failed: ${String(e)}`, true)
    }
  }

  async function copyAddress(item: TunnelItem) {
    try {
      await invoke("copy_text_to_clipboard", {
        text: tunnelAddress(item)
      })
      showToast?.("Tunnel address copied")
    } catch (e: any) {
      showToast?.(`Copy failed: ${String(e)}`, true)
    }
  }

  async function startTunnel(item: TunnelItem) {
    try {
      const msg = await invoke("start_tunnel", { id: item.id }) as string
      showToast?.(msg)
      await loadTunnels()
    } catch (e: any) {
      const err = String(e)

      if (err.toLowerCase().includes("failed to bind")) {
        showToast?.(`Local port ${item.local_port} is already in use`, true)
        return
      }

      showToast?.(`Tunnel start failed: ${err}`, true)
    }
  }

  async function stopTunnel(item: TunnelItem) {
    try {
      const msg = await invoke("stop_tunnel", { id: item.id }) as string
      showToast?.(msg)
      await loadTunnels()
    } catch (e: any) {
      showToast?.(`Tunnel stop failed: ${String(e)}`, true)
    }
  }

  async function ensureAutoStart() {
    try {
      const tunnels = await invoke("get_tunnels", { serverId: server.id }) as TunnelItem[]
      const active = await invoke("get_active_tunnels") as { id: number }[]
      const activeIds = new Set(active.map((x) => x.id))

      for (const item of tunnels) {
        if (item.auto_start && !activeIds.has(item.id)) {
          try {
            await invoke("start_tunnel", { id: item.id })
          } catch {}
        }
      }

      await loadTunnels()
    } catch {}
  }

  return (
    <div
      style={{
        ...shellStyle,
        width: panelWidth,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: -8,
          bottom: 0,
          width: 16,
          cursor: "col-resize",
          zIndex: 60,
          background: "transparent"
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          resizeDragRef.current = true
          document.body.style.cursor = "col-resize"
          document.body.style.userSelect = "none"
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 1,
          background: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
          pointerEvents: "none",
          zIndex: 45
        }}
      />

      <div className="ui-panel-header" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ minWidth: 0 }}>
          <div className="ui-title">{server?.lang === "de" ? "Tunnels" : "Tunnels"}</div>
          <div
            className="ui-subtitle"
            style={{
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={openCreate} className="ui-icon-btn" title="New tunnel">
            <Plus size={15} />
          </button>
          <button onClick={loadTunnels} className="ui-icon-btn" title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button onClick={onClose} className="ui-icon-btn" title="Close">
            <X size={15} />
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
          background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"
        }}
      >
        <div className="ui-subtitle" style={{ lineHeight: 1.45 }}>
          Local tunnels for this server. Left side is your PC. Right side is the target reachable from the server.
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {loading ? (
          <div className="ui-subtitle" style={{ padding: 10 }}>
            {server?.lang === "de" ? "Tunnels werden geladen..." : "Loading tunnels..."}
          </div>
        ) : items.length === 0 ? (
          <div className="ui-muted-box">{server?.lang === "de" ? "Noch keine Tunnels gespeichert" : "No tunnels saved yet"}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((item) => {
              const active = activeTunnelIds.includes(item.id)

              return (
                <div
                  key={item.id}
                  className="ui-panel"
                  style={{
                    borderRadius: 14,
                    padding: 12,
                    boxShadow: "none"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          lineHeight: 1.25,
                          fontWeight: 700,
                          color: "var(--text-main)"
                        }}
                      >
                        <Cable size={14} />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.name}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                          fontSize: 12,
                          lineHeight: 1.35,
                          color: "var(--text-muted)"
                        }}
                      >
                        <span>{item.bind_host}:{item.local_port}</span>
                        <ChevronRight size={12} />
                        <span>{item.remote_host}:{item.remote_port}</span>
                      </div>

                      {item.auto_start && !active ? (
                        <div className="ui-subtitle" style={{ marginTop: 8 }}>
                          {server?.lang === "de" ? "Autostart aktiviert" : "Auto start enabled"}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                      <span style={statusStyles(active)}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: active ? "rgb(34,197,94)" : "var(--text-muted)"
                          }}
                        />
                        {active ? "Running" : "Stopped"}
                      </span>

                      {active ? (
                        <button onClick={() => stopTunnel(item)} className="ui-btn">
                          <Square size={13} />
                          Stop
                        </button>
                      ) : (
                        <button onClick={() => startTunnel(item)} className="ui-btn">
                          <Play size={13} />
                          Start
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent)",
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap"
                    }}
                  >
                    <button onClick={() => copyAddress(item)} className="ui-btn">
                      <Copy size={13} />
                      Copy address
                    </button>
                    <button onClick={() => openEdit(item)} className="ui-btn">
                      <Pencil size={13} />
                      Edit
                    </button>
                    <button onClick={() => setDeleteItem(item)} className="ui-btn">
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="ui-modal-overlay">
          <div className="ui-modal" style={{ width: "min(100%, 460px)" }}>
            <div className="ui-modal-header">
              <div>
                <div className="ui-title">{editingItem ? (server?.lang === "de" ? "Tunnel bearbeiten" : "Edit tunnel") : (server?.lang === "de" ? "Neuer Tunnel" : "New tunnel")}</div>
                <div className="ui-subtitle" style={{ marginTop: 2 }}>
                  {server?.lang === "de" ? "Wiederverwendbares lokales Port Forwarding für diesen Server" : "Reusable local port forwarding for this server"}
                </div>
              </div>

              <button onClick={() => setEditorOpen(false)} className="ui-icon-btn" title="Close">
                <X size={15} />
              </button>
            </div>

            <div className="ui-modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Tunnel name"
                  className="ui-input"
                />
              </Field>

              <div>
                <div className="ui-kicker" style={{ marginBottom: 8 }}>{server?.lang === "de" ? "Auf deinem Rechner" : "On your computer"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 116px", gap: 10 }}>
                  <Field label="Bind host">
                    <input
                      value={form.bind_host}
                      onChange={(e) => setForm({ ...form, bind_host: e.target.value })}
                      placeholder="127.0.0.1"
                      className="ui-input"
                    />
                  </Field>

                  <Field label="Local port">
                    <input
                      type="number"
                      value={form.local_port}
                      onChange={(e) => setForm({ ...form, local_port: parseInt(e.target.value || "0", 10) })}
                      placeholder="5433"
                      className="ui-input"
                    />
                  </Field>
                </div>
              </div>

              <div>
                <div className="ui-kicker" style={{ marginBottom: 8 }}>{server?.lang === "de" ? "Ziel vom Server aus" : "Target from server"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 116px", gap: 10 }}>
                  <Field label="Target host">
                    <input
                      value={form.remote_host}
                      onChange={(e) => setForm({ ...form, remote_host: e.target.value })}
                      placeholder="127.0.0.1"
                      className="ui-input"
                    />
                  </Field>

                  <Field label="Target port">
                    <input
                      type="number"
                      value={form.remote_port}
                      onChange={(e) => setForm({ ...form, remote_port: parseInt(e.target.value || "0", 10) })}
                      placeholder="5432"
                      className="ui-input"
                    />
                  </Field>
                </div>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  paddingTop: 2,
                  fontSize: 13,
                  color: "var(--text-main)",
                  cursor: "pointer"
                }}
              >
                <input
                  type="checkbox"
                  checked={form.auto_start}
                  onChange={(e) => setForm({ ...form, auto_start: e.target.checked })}
                />
                {server?.lang === "de" ? "Für diesen Server automatisch starten" : "Start automatically for this server"}
              </label>
            </div>

            <div className="ui-modal-footer">
              <button onClick={() => setEditorOpen(false)} className="ui-btn-ghost">
                Cancel
              </button>
              <button onClick={saveCurrent} className="ui-btn-primary">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div className="ui-modal-overlay">
          <div className="ui-modal">
            <div className="ui-modal-header">
              <div>
                <div className="ui-title">{server?.lang === "de" ? "Tunnel löschen" : "Delete tunnel"}</div>
                <div className="ui-subtitle" style={{ marginTop: 2 }}>
                  {server?.lang === "de" ? "Dadurch wird die gespeicherte Tunnel Konfiguration entfernt" : "This removes the saved tunnel config"}
                </div>
              </div>

              <button onClick={() => setDeleteItem(null)} className="ui-icon-btn" title="Close">
                <X size={15} />
              </button>
            </div>

            <div className="ui-modal-body">
              <div className="ui-subtitle" style={{ lineHeight: 1.45 }}>
                Delete "{deleteItem.name}"?
              </div>
            </div>

            <div className="ui-modal-footer">
              <button onClick={() => setDeleteItem(null)} className="ui-btn-ghost">
                Cancel
              </button>
              <button onClick={deleteCurrent} className="ui-btn-primary">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
