import React, { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  Folder,
  File,
  ArrowLeft,
  X,
  RefreshCw,
  FolderPlus,
  ChevronRight,
  Home,
  MoreHorizontal,
  ArrowUpWideNarrow,
  Eye,
  EyeOff
} from "lucide-react"
import { t } from "../lib/i18n"

type FileItem = {
  name: string
  is_dir: boolean
  size: number
}

type LocalSortMode = "folders" | "name" | "size" | "type"

const LOCAL_FILES_PANEL_WIDTH_KEY = "termina_local_files_panel_width"
const LOCAL_FILES_PANEL_MIN_WIDTH = 300
const LOCAL_FILES_PANEL_MAX_WIDTH = 720
const LOCAL_FILES_PANEL_DEFAULT_WIDTH = 352
const EDITOR_WINDOW_STATE_KEY = "termina_sftp_editor_window_state"

function clampPanelWidth(value: number) {
  return Math.max(LOCAL_FILES_PANEL_MIN_WIDTH, Math.min(LOCAL_FILES_PANEL_MAX_WIDTH, value))
}

function readStoredPanelWidth() {
  try {
    const raw = localStorage.getItem(LOCAL_FILES_PANEL_WIDTH_KEY)
    if (!raw) return LOCAL_FILES_PANEL_DEFAULT_WIDTH
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return LOCAL_FILES_PANEL_DEFAULT_WIDTH
    return clampPanelWidth(parsed)
  } catch {
    return LOCAL_FILES_PANEL_DEFAULT_WIDTH
  }
}

function persistPanelWidth(value: number) {
  try {
    localStorage.setItem(LOCAL_FILES_PANEL_WIDTH_KEY, String(clampPanelWidth(value)))
  } catch {}
}

function readStoredEditorWindowState() {
  try {
    const raw = localStorage.getItem(EDITOR_WINDOW_STATE_KEY)
    if (!raw) {
      return { width: 1100, height: 760, maximized: false }
    }

    const parsed = JSON.parse(raw)
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)

    return {
      width: Number.isFinite(width) ? Math.max(760, Math.min(2400, width)) : 1100,
      height: Number.isFinite(height) ? Math.max(520, Math.min(1600, height)) : 760,
      maximized: Boolean(parsed?.maximized)
    }
  } catch {
    return { width: 1100, height: 760, maximized: false }
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function buildLocalPath(path: string, name: string) {
  if (!path) return name
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path
  return trimmed === "" ? `/${name}` : `${trimmed}/${name}`
}

function pathParts(path: string) {
  if (!path || path === "/") return [{ label: "/", full: "/" }]

  const parts = path.split("/").filter(Boolean)
  const out = [{ label: "/", full: "/" }] as { label: string; full: string }[]
  let cur = ""

  for (const p of parts) {
    cur += "/" + p
    out.push({ label: p, full: cur })
  }

  return out
}

function sortFiles(items: FileItem[], mode: LocalSortMode) {
  const sorted = [...items]

  sorted.sort((a, b) => {
    if (mode === "folders") {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    }

    if (mode === "size") {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      if (a.size !== b.size) return b.size - a.size
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    }

    if (mode === "type") {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      const aExt = a.is_dir ? "" : (a.name.split(".").pop() || "").toLowerCase()
      const bExt = b.is_dir ? "" : (b.name.split(".").pop() || "").toLowerCase()
      const extCmp = aExt.localeCompare(bExt, undefined, { sensitivity: "base", numeric: true })
      if (extCmp !== 0) return extCmp
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
  })

  return sorted
}

function sortModeLabel(mode: LocalSortMode, lang: string) {
  if (mode === "folders") return t("foldersFirst", lang)
  if (mode === "size") return t("sortBySize", lang)
  if (mode === "type") return t("sortByType", lang)
  return t("sortByName", lang)
}

function getSmallMenuPosition(buttonRect: DOMRect, listRect: DOMRect): React.CSSProperties {
  const menuWidth = 156
  const menuHeight = 164
  const gap = 6

  const spaceBelow = listRect.bottom - buttonRect.bottom
  const openUp = spaceBelow < menuHeight + gap

  const top = openUp
    ? -(menuHeight + gap - Math.max(0, buttonRect.height - 4))
    : buttonRect.height + gap

  return {
    position: "absolute",
    top,
    right: 0,
    width: menuWidth,
    minWidth: menuWidth,
    borderRadius: 10,
    border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
    background: "color-mix(in srgb, var(--bg-app) 92%, black)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    overflow: "hidden",
    zIndex: 35
  }
}

function getMenuPosition(buttonRect: DOMRect, listRect: DOMRect): React.CSSProperties {
  const menuWidth = 140
  const menuHeight = 116
  const gap = 6

  const spaceBelow = listRect.bottom - buttonRect.bottom
  const openUp = spaceBelow < menuHeight + gap

  const top = openUp
    ? -(menuHeight + gap - Math.max(0, buttonRect.height - 4))
    : buttonRect.height + gap

  return {
    position: "absolute",
    top,
    right: 0,
    width: menuWidth,
    minWidth: menuWidth,
    borderRadius: 10,
    border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
    background: "var(--bg-app, #020617)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    overflow: "hidden",
    zIndex: 35
  }
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  background: "color-mix(in srgb, var(--bg-sidebar) 88%, var(--bg-app))",
  borderLeft: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  zIndex: 25,
  transition: "transform 220ms ease, opacity 220ms ease",
  overflow: "visible",
  boxShadow: "-14px 0 34px rgba(0,0,0,0.18)"
}

const headerStyle: React.CSSProperties = {
  padding: "8px 12px",
  minHeight: 52,
  borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "color-mix(in srgb, var(--bg-sidebar) 92%, var(--bg-app))"
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 10,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "color-mix(in srgb, var(--bg-app) 68%, var(--bg-sidebar))",
  color: "var(--text-muted, #94a3b8)",
  cursor: "pointer",
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease"
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--text-main, #e5e7eb)",
  borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 68%, transparent)"
}

const modalOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 40,
  padding: 18
}

const modalBox: React.CSSProperties = {
  width: 360,
  maxWidth: "100%",
  borderRadius: 16,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "color-mix(in srgb, var(--bg-app) 92%, black)",
  color: "var(--text-main, #e5e7eb)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
  padding: 16
}

const modalBtn: React.CSSProperties = {
  minHeight: 36,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "var(--bg-sidebar, #111827)",
  color: "var(--text-main, #e5e7eb)",
  cursor: "pointer",
  fontSize: 12,
  transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease, opacity 140ms ease"
}

const menuButtonStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  background: "transparent",
  color: "var(--text-main, #e5e7eb)",
  cursor: "pointer",
  fontSize: 12,
  transition: "background 140ms ease"
}

function entryStyle(hovered: boolean): React.CSSProperties {
  return {
    ...row,
    position: "relative",
    borderRadius: 12,
    border: hovered
      ? "1px solid color-mix(in srgb, var(--accent) 26%, var(--border-subtle))"
      : "1px solid transparent",
    background: hovered
      ? "color-mix(in srgb, var(--bg-hover) 72%, transparent)"
      : "transparent",
    borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 68%, transparent)",
    margin: 0,
    transition: "background 140ms ease, border-color 140ms ease"
  }
}

type LocalFilesPanelProps = {
  visible: boolean
  onClose?: () => void
  lang?: string
}

export default function LocalFilesPanel({ visible, onClose, lang = "de" }: LocalFilesPanelProps) {
  const [path, setPath] = useState("/")
  const [homePath, setHomePath] = useState("/")
  const [files, setFiles] = useState<FileItem[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [sortMenuStyle, setSortMenuStyle] = useState<React.CSSProperties | null>(null)
  const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth())
  const [sortMode, setSortMode] = useState<LocalSortMode>("folders")
  const [menuItem, setMenuItem] = useState<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [renameItem, setRenameItem] = useState<FileItem | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderValue, setNewFolderValue] = useState("")
  const [deleteItem, setDeleteItem] = useState<FileItem | null>(null)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const resizeDragRef = useRef(false)

  const visibleFiles = useMemo(() => {
    const filtered = showHidden ? files : files.filter((f) => !f.name.startsWith("."))
    return sortFiles(filtered, sortMode)
  }, [files, showHidden, sortMode])

  async function load(nextPath: string) {
    try {
      const res = await invoke("local_list_dir", { path: nextPath }) as FileItem[]
      setFiles(Array.isArray(res) ? res : [])
      setPath(nextPath)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (!visible) return

    invoke("get_local_home_dir")
      .then((home) => {
        const resolvedHome = String(home || "/")
        setHomePath(resolvedHome)
        return load(resolvedHome)
      })
      .catch(() => {
        setHomePath("/")
        return load("/")
      })
  }, [visible])

  useEffect(() => {
    persistPanelWidth(panelWidth)
  }, [panelWidth])

  useEffect(() => {
    const closeMenu = () => {
      setMenuItem(null)
      setMenuStyle(null)
    }

    window.addEventListener("resize", closeMenu)
    return () => window.removeEventListener("resize", closeMenu)
  }, [])

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

  async function openEditor(file: FileItem) {
    if (file.is_dir) return

    try {
      const label = `local-editor-${Date.now()}`
      const qs = new URLSearchParams({
        editor: "local",
        path: buildLocalPath(path, file.name),
        file: file.name
      })

      const editorUrl = `${window.location.origin}/?${qs.toString()}`
      const editorWindowState = readStoredEditorWindowState()

      const linuxWindowMode = await invoke("get_linux_window_mode")
        .catch(() => ({ wayland_undecorated: false })) as { wayland_undecorated?: boolean }

      const win = new WebviewWindow(label, {
        title: `Edit: ${file.name}`,
        url: editorUrl,
        width: editorWindowState.width,
        height: editorWindowState.height,
        minWidth: 760,
        minHeight: 520,
        center: !editorWindowState.maximized,
        resizable: true,
        decorations: !Boolean(linuxWindowMode?.wayland_undecorated)
      })

      if (editorWindowState.maximized) {
        win.once("tauri://created", () => {
          void win.maximize().catch((e) => {
            console.error("editor maximize restore failed", e)
          })
        })
      }

      win.once("tauri://error", (e) => {
        console.error("editor window error", e)
      })
    } catch (e) {
      console.error(e)
    }
  }

  async function doRename() {
    if (!renameItem || !renameValue.trim()) return
    try {
      await invoke("local_rename", {
        oldPath: buildLocalPath(path, renameItem.name),
        newPath: buildLocalPath(path, renameValue.trim())
      })
      setRenameItem(null)
      setRenameValue("")
      await load(path)
    } catch (e) {
      console.error(e)
    }
  }

  async function doDelete() {
    if (!deleteItem) return
    try {
      await invoke("local_delete", {
        path: buildLocalPath(path, deleteItem.name)
      })
      setDeleteItem(null)
      await load(path)
    } catch (e) {
      console.error(e)
    }
  }

  async function doNewFolder() {
    if (!newFolderValue.trim()) return
    try {
      await invoke("local_mkdir", {
        path: buildLocalPath(path, newFolderValue.trim())
      })
      setNewFolderOpen(false)
      setNewFolderValue("")
      await load(path)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div
      ref={panelRef}
      style={{
        ...panelStyle,
        width: panelWidth,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none"
      }}
      onClick={() => {
        setMenuItem(null)
        setMenuStyle(null)
        setSortMenuOpen(false)
        setSortMenuStyle(null)
      }}
    >
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

      <div style={headerStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            minWidth: 0
          }}
        >
          <button
            onClick={() => {
              invoke("get_local_home_dir")
                .then((home) => {
                  const resolvedHome = String(home || "/")
                  setHomePath(resolvedHome)
                  void load(resolvedHome)
                })
                .catch(() => {
                  setHomePath("/")
                  void load("/")
                })
            }}
            style={{ ...iconBtn, flexShrink: 0 }}
            title={lang === "de" ? "Home Verzeichnis" : "Home directory"}
          >
            <Home size={14} />
          </button>
          <button
            onClick={() => setShowHidden((prev) => !prev)}
            style={{ ...iconBtn, flexShrink: 0 }}
            title={showHidden ? t("hiddenOn", lang) : t("hiddenOff", lang)}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>

          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={(e) => {
                e.stopPropagation()

                if (sortMenuOpen) {
                  setSortMenuOpen(false)
                  setSortMenuStyle(null)
                  return
                }

                const panelEl = panelRef.current
                const buttonEl = e.currentTarget as HTMLButtonElement

                if (panelEl && buttonEl) {
                  const panelRect = panelEl.getBoundingClientRect()
                  const buttonRect = buttonEl.getBoundingClientRect()
                  setSortMenuStyle(getSmallMenuPosition(buttonRect, panelRect))
                } else {
                  setSortMenuStyle(null)
                }

                setSortMenuOpen(true)
                setMenuItem(null)
                setMenuStyle(null)
              }}
              style={{ ...iconBtn, flexShrink: 0 }}
              title={`${t("sortFiles", lang)}: ${sortModeLabel(sortMode, lang)}`}
            >
              <ArrowUpWideNarrow size={14} />
            </button>

            {sortMenuOpen && (
              <div
                style={sortMenuStyle || {
                  position: "absolute",
                  top: 40,
                  right: 0,
                  width: 156,
                  minWidth: 156,
                  borderRadius: 10,
                  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                  background: "color-mix(in srgb, var(--bg-app) 92%, black)",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                  zIndex: 35
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {(["folders", "name", "size", "type"] as LocalSortMode[]).map((mode) => (
                  <button
                    key={mode}
                    style={{
                      ...menuButtonStyle,
                      color: sortMode === mode ? "var(--text-main)" : undefined,
                      background: sortMode === mode ? "var(--bg-hover, rgba(255,255,255,0.08))" : undefined,
                      fontWeight: sortMode === mode ? 700 : 500
                    }}
                    onClick={() => {
                      setSortMode(mode)
                      setSortMenuOpen(false)
                      setSortMenuStyle(null)
                    }}
                  >
                    {sortModeLabel(mode, lang)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0
            }}
          >
            <button onClick={() => setNewFolderOpen(true)} style={iconBtn} title={t("newFolder", lang)}>
              <FolderPlus size={14} />
            </button>
            <button onClick={() => load(path)} style={iconBtn} title={t("refresh", lang)}>
              <RefreshCw size={14} />
            </button>
            <button onClick={onClose} style={iconBtn} title={t("close", lang)}>
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "10px 12px",
          fontSize: 11,
          color: "var(--text-muted, #94a3b8)",
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
          background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            minWidth: 0
          }}
        >
          {pathParts(path).map((part, i, arr) => (
            <React.Fragment key={part.full}>
              <button
                onClick={() => load(part.full)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted, #94a3b8)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                <span>{i === 0 ? "/" : part.label}</span>
              </button>
              {i < arr.length - 1 && <ChevronRight size={12} />}
            </React.Fragment>
          ))}
        </div>

        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
          <span>{visibleFiles.length} {t("visibleCount", lang)}</span>
          <span>{showHidden ? t("hiddenFilesIncluded", lang) : t("hiddenFilesFiltered", lang)}</span>
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          background: "color-mix(in srgb, var(--bg-app) 90%, var(--bg-sidebar))"
        }}
      >
        {path !== "/" && (
          <div
            style={entryStyle(hoveredItem === "__parent__")}
            onMouseEnter={() => setHoveredItem("__parent__")}
            onMouseLeave={() => setHoveredItem((current) => current === "__parent__" ? null : current)}
            onClick={() => {
              const parent = path.split("/").slice(0, -2).join("/") || "/"
              load(parent)
            }}
          >
            <ArrowLeft size={14} />
            <span style={{ flex: 1 }}>..</span>
          </div>
        )}

        {visibleFiles.length === 0 && (
          <div
            style={{
              padding: "26px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div
              style={{
                width: "100%",
                borderRadius: 16,
                border: "1px dashed var(--border-subtle, rgba(255,255,255,0.08))",
                background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                padding: "22px 16px",
                textAlign: "center"
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main, #e5e7eb)", marginBottom: 6 }}>
                {showHidden ? t("emptyFolder", lang) : t("noFilesVisible", lang)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)", lineHeight: 1.5 }}>
                {showHidden ? t("emptyFolderHint", lang) : t("noFilesVisibleHint", lang)}
              </div>
            </div>
          </div>
        )}

        {visibleFiles.map((f) => (
          <div
            key={f.name}
            style={entryStyle(hoveredItem === f.name)}
            onMouseEnter={() => setHoveredItem(f.name)}
            onMouseLeave={() => setHoveredItem((current) => current === f.name ? null : current)}
            onDoubleClick={() => {
              if (f.is_dir) {
                load(buildLocalPath(path, f.name))
              } else {
                void openEditor(f)
              }
            }}
            onClick={() => {
              if (f.is_dir) {
                load(buildLocalPath(path, f.name))
              }
            }}
          >
            {f.is_dir ? (
              <Folder size={14} color="var(--accent, #60a5fa)" />
            ) : (
              <File size={14} color="var(--text-muted, #94a3b8)" />
            )}

            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {f.name}
            </span>

            {!f.is_dir && (
              <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", minWidth: 70, textAlign: "right" }}>
                {formatBytes(f.size)}
              </span>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation()

                if (menuItem === f.name) {
                  setMenuItem(null)
                  setMenuStyle(null)
                  return
                }

                const listEl = listRef.current
                const buttonEl = e.currentTarget as HTMLButtonElement

                if (listEl && buttonEl) {
                  const listRect = listEl.getBoundingClientRect()
                  const buttonRect = buttonEl.getBoundingClientRect()
                  setMenuStyle(getMenuPosition(buttonRect, listRect))
                } else {
                  setMenuStyle(null)
                }

                setMenuItem(f.name)
              }}
              style={iconBtn}
              title={t("actions", lang)}
            >
              <MoreHorizontal size={14} />
            </button>

            {menuItem === f.name && (
              <div
                style={menuStyle || {
                  position: "absolute",
                  top: 38,
                  right: 0,
                  width: 140,
                  minWidth: 140,
                  borderRadius: 10,
                  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                  background: "var(--bg-app, #020617)",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                  zIndex: 35
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {!f.is_dir && (
                  <button style={menuButtonStyle} onClick={() => { setMenuItem(null); void openEditor(f) }}>
                    {t("edit", lang)}
                  </button>
                )}
                <button style={menuButtonStyle} onClick={() => { setMenuItem(null); setRenameItem(f); setRenameValue(f.name) }}>
                  {t("rename", lang)}
                </button>
                <button style={menuButtonStyle} onClick={() => { setMenuItem(null); setDeleteItem(f) }}>
                  {t("delete", lang)}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {renameItem && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("rename", lang)}</div>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                background: "var(--bg-sidebar, #111827)",
                color: "var(--text-main, #e5e7eb)",
                outline: "none",
                marginBottom: 12
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button style={modalBtn} onClick={() => { setRenameItem(null); setRenameValue("") }}>{t("cancel", lang)}</button>
              <button style={modalBtn} onClick={() => void doRename()}>{t("save", lang)}</button>
            </div>
          </div>
        </div>
      )}

      {newFolderOpen && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("newFolderTitle", lang)}</div>
            <input
              value={newFolderValue}
              onChange={(e) => setNewFolderValue(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                background: "var(--bg-sidebar, #111827)",
                color: "var(--text-main, #e5e7eb)",
                outline: "none",
                marginBottom: 12
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={modalBtn} onClick={() => { setNewFolderOpen(false); setNewFolderValue("") }}>{t("cancel", lang)}</button>
              <button style={modalBtn} onClick={() => void doNewFolder()}>{t("create", lang)}</button>
            </div>
          </div>
        </div>
      )}

      {deleteItem && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("deleteTitle", lang)}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)", marginBottom: 12 }}>
              {t("deleteText", lang).replace("{name}", deleteItem.name)}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={modalBtn} onClick={() => setDeleteItem(null)}>{t("cancel", lang)}</button>
              <button style={modalBtn} onClick={() => void doDelete()}>{t("delete", lang)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
