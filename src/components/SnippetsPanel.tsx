import React, { useEffect, useRef, useState } from "react"
import { Play, Plus, Trash2, Pencil, X, ScrollText } from "lucide-react"
const TERMINA_SNIPPETS_PANEL_WIDTH_KEY = "termina_snippets_panel_width"
const TERMINA_SNIPPETS_PANEL_MIN_WIDTH = 300
const TERMINA_SNIPPETS_PANEL_MAX_WIDTH = 720
const TERMINA_SNIPPETS_PANEL_DEFAULT_WIDTH = 352

function clampPanelWidth(value: number) {
  return Math.max(TERMINA_SNIPPETS_PANEL_MIN_WIDTH, Math.min(TERMINA_SNIPPETS_PANEL_MAX_WIDTH, value))
}

function readStoredPanelWidth() {
  try {
    const raw = localStorage.getItem(TERMINA_SNIPPETS_PANEL_WIDTH_KEY)
    if (!raw) return TERMINA_SNIPPETS_PANEL_DEFAULT_WIDTH
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return TERMINA_SNIPPETS_PANEL_DEFAULT_WIDTH
    return clampPanelWidth(parsed)
  } catch {
    return TERMINA_SNIPPETS_PANEL_DEFAULT_WIDTH
  }
}

function persistPanelWidth(value: number) {
  try {
    localStorage.setItem(TERMINA_SNIPPETS_PANEL_WIDTH_KEY, String(clampPanelWidth(value)))
  } catch {}
}

import { invoke } from "@tauri-apps/api/core"
import { t } from "../lib/i18n"

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

export default function SnippetsPanel({
  onExecute,
  lang,
  showDialog,
  visible,
  onClose
}: any) {
  const [snippets, setSnippets] = useState<any[]>([])
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: "", command: "" })
  const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth())
  const resizeDragRef = useRef(false)

  const loadSnippets = async () => {
    try {
      setSnippets(await invoke("get_snippets"))
    } catch {}
  }

  useEffect(() => {
    if (visible) loadSnippets()
  }, [visible])

  async function handleSave() {
    const name = form.name.trim()
    const command = form.command.trim()

    if (!name || !command) return

    try {
      if (editingId !== null) {
        await invoke("update_snippet", {
          id: editingId,
          name,
          command
        })
      } else {
        await invoke("add_snippet", {
          name,
          command
        })
      }

      setForm({ name: "", command: "" })
      setEditingId(null)
      setIsEditorOpen(false)
      await loadSnippets()
    } catch {}
  }

  function resetEditor() {
    setForm({ name: "", command: "" })
    setEditingId(null)
    setIsEditorOpen(false)
  }

  function startCreate() {
    setForm({ name: "", command: "" })
    setEditingId(null)
    setIsEditorOpen(true)
  }

  function startEdit(item: any) {
    setForm({ name: item.name, command: item.command })
    setEditingId(item.id)
    setIsEditorOpen(true)
  }

  useEffect(() => {
    persistPanelWidth(panelWidth)
  }, [panelWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeDragRef.current) return
      const next = clampPanelWidth(window.innerWidth - e.clientX)
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
          <div className="ui-title">{lang === "de" ? "Snippets" : "Snippets"}</div>
          <div className="ui-subtitle" style={{ marginTop: 2 }}>
            Reusable terminal commands
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={startCreate} className="ui-icon-btn" title={t("add", lang) || "New"}>
            <Plus size={15} />
          </button>
          <button onClick={onClose} className="ui-icon-btn" title={t("close", lang)}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {isEditorOpen && (
          <div
            className="ui-panel"
            style={{
              borderRadius: 14,
              padding: 12,
              boxShadow: "none"
            }}
          >
            <div className="ui-kicker" style={{ marginBottom: 10 }}>
              {editingId !== null ? t("edit", lang) : t("add", lang)}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "block" }}>
                <span className="ui-label">{t("name", lang)}</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("name", lang)}
                  className="ui-input"
                />
              </label>

              <label style={{ display: "block" }}>
                <span className="ui-label">{t("command", lang)}</span>
                <textarea
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder={t("command", lang)}
                  style={{
                    width: "100%",
                    minHeight: 96,
                    resize: "vertical",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border-subtle)",
                    background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                    color: "var(--text-main)",
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box"
                  }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={resetEditor} className="ui-btn-ghost">
                  {t("cancel", lang)}
                </button>
                <button onClick={handleSave} className="ui-btn-primary">
                  {t("save", lang)}
                </button>
              </div>
            </div>
          </div>
        )}

        {snippets.length === 0 ? (
          <div className="ui-muted-box">No snippets yet. Save reusable commands for quick reuse here.</div>
        ) : (
          snippets.map((s) => (
            <div
              key={s.id}
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
                    <ScrollText size={14} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name}
                    </span>
                  </div>

                  <code
                    style={{
                      display: "block",
                      marginTop: 8,
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0
                    }}
                  >
                    {s.command}
                  </code>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => onExecute(s.command)} className="ui-icon-btn" title="Run">
                    <Play size={14} />
                  </button>

                  <button onClick={() => startEdit(s)} className="ui-icon-btn" title={t("edit", lang)}>
                    <Pencil size={14} />
                  </button>

                  <button
                    onClick={() =>
                      showDialog({
                        type: "confirm",
                        title: t("confirmDelete", lang),
                        onConfirm: async () => {
                          await invoke("delete_snippet", { id: s.id })
                          loadSnippets()
                        }
                      })
                    }
                    className="ui-icon-btn"
                    title={t("delete", lang)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
