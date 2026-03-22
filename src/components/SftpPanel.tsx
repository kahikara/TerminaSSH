import React, { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { open, save } from "@tauri-apps/plugin-dialog"
import {
  Folder,
  File,
  Upload,
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
import { getPathBaseName } from "../lib/settingsHelpers"

type FileItem = {
  name: string
  is_dir: boolean
  size: number
}

type TransferProgress = {
  transferred: number
  total: number
  speed: number
  current_file: string
}

type ConflictAction = "overwrite" | "rename" | "skip" | "cancel"

type ConflictState = {
  open: boolean
  fileName: string
  renameValue: string
  applyToAll: boolean
  resolve?: (value: { action: ConflictAction; applyToAll: boolean; renameValue?: string }) => void
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

function buildRemotePath(path: string, name: string) {
  return path + (path.endsWith("/") ? "" : "/") + name
}

function uniqueRenamedName(original: string, files: FileItem[]) {
  const dot = original.lastIndexOf(".")
  const hasExt = dot > 0
  const base = hasExt ? original.slice(0, dot) : original
  const ext = hasExt ? original.slice(dot) : ""

  let i = 1
  let candidate = `${base} (${i})${ext}`
  while (files.some((f) => !f.is_dir && f.name === candidate)) {
    i++
    candidate = `${base} (${i})${ext}`
  }
  return candidate
}

function pathParts(path: string) {
  if (path === "/" || !path) return [{ label: "/", full: "/" }]
  const parts = path.split("/").filter(Boolean)
  const out = [{ label: "/", full: "/" }] as { label: string; full: string }[]
  let cur = ""
  for (const p of parts) {
    cur += "/" + p
    out.push({ label: p, full: cur })
  }
  return out
}

type SftpSortMode = "folders" | "name" | "size" | "type"

const SFTP_PANEL_WIDTH_KEY = "termina_sftp_panel_width"
const SFTP_PANEL_MIN_WIDTH = 300
const SFTP_PANEL_MAX_WIDTH = 720
const SFTP_PANEL_DEFAULT_WIDTH = 352
const SFTP_EDITOR_WINDOW_STATE_KEY = "termina_sftp_editor_window_state"

function clampSftpPanelWidth(value: number) {
  return Math.max(SFTP_PANEL_MIN_WIDTH, Math.min(SFTP_PANEL_MAX_WIDTH, value))
}

function readStoredSftpPanelWidth() {
  try {
    const raw = localStorage.getItem(SFTP_PANEL_WIDTH_KEY)
    if (!raw) return SFTP_PANEL_DEFAULT_WIDTH
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return SFTP_PANEL_DEFAULT_WIDTH
    return clampSftpPanelWidth(parsed)
  } catch {
    return SFTP_PANEL_DEFAULT_WIDTH
  }
}

function persistSftpPanelWidth(value: number) {
  try {
    localStorage.setItem(SFTP_PANEL_WIDTH_KEY, String(clampSftpPanelWidth(value)))
  } catch {}
}

function readStoredEditorWindowState() {
  try {
    const raw = localStorage.getItem(SFTP_EDITOR_WINDOW_STATE_KEY)
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

function readTerminaSettings() {
  try {
    const raw = localStorage.getItem("termina_settings")
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (parsed?.sftpSort === "az" || parsed?.sftpSort === "za") {
      parsed.sftpSort = "name"
    }
    return parsed
  } catch {
    return {}
  }
}

function writeTerminaSettings(patch: Record<string, unknown>) {
  try {
    const current = readTerminaSettings()
    localStorage.setItem("termina_settings", JSON.stringify({ ...current, ...patch }))
  } catch (e) {
    console.error("failed to persist sftp settings", e)
  }
}

function sortFiles(items: FileItem[], mode: SftpSortMode) {
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

function sortModeLabel(mode: SftpSortMode, lang: string) {
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
  const menuHeight = 150
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

export default function SftpPanel({ server, visible, onClose, lang = "de" }: any) {
  const [path, setPath] = useState("/")
  const [files, setFiles] = useState<FileItem[]>([])
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const [conflict, setConflict] = useState<ConflictState>({
    open: false,
    fileName: "",
    renameValue: "",
    applyToAll: false
  })
  const [renameItem, setRenameItem] = useState<FileItem | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderValue, setNewFolderValue] = useState("")
  const [deleteItem, setDeleteItem] = useState<FileItem | null>(null)

  const initialSettings = readTerminaSettings()
  const [showHidden, setShowHidden] = useState(Boolean(initialSettings.sftpHidden))
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [sortMenuStyle, setSortMenuStyle] = useState<React.CSSProperties | null>(null)
  const [panelWidth, setPanelWidth] = useState(readStoredSftpPanelWidth())
  const [sortMode, setSortMode] = useState<SftpSortMode>(
    ["folders", "name", "size", "type"].includes(initialSettings.sftpSort)
      ? initialSettings.sftpSort
      : initialSettings.sftpSort === "az"
        ? "name"
        : "folders"
  )

  const [menuItem, setMenuItem] = useState<string | null>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const resizeDragRef = useRef(false)
  const transferSessionId = useMemo(
    () => `sftp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    []
  )

  const visibleFiles = useMemo(() => {
    const filtered = showHidden ? files : files.filter((f) => !f.name.startsWith("."))
    return sortFiles(filtered, sortMode)
  }, [files, showHidden, sortMode])

  async function load(p: string) {
    try {
      const res: FileItem[] = await invoke("sftp_list_dir", {
        id: server.id,
        path: p
      })
      setFiles(res)
      setPath(p)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (visible && server?.id) {
      load(path || "/")
    }
  }, [visible, server])

  useEffect(() => {
    writeTerminaSettings({
      sftpHidden: showHidden,
      sftpSort: sortMode
    })
  }, [showHidden, sortMode])

  useEffect(() => {
    let clearTimer: number | null = null

    const setup = async () => {
      const unlisten = await listen(`sftp-progress-${transferSessionId}`, (event) => {
        const payload = event.payload as TransferProgress
        setProgress(payload)
        setIsTransferring(true)

        if (clearTimer) {
          clearTimeout(clearTimer)
          clearTimer = null
        }

        const looksFinished = payload.total > 0 && payload.transferred >= payload.total
        if (looksFinished) {
          clearTimer = window.setTimeout(() => {
            setIsTransferring(false)
            setProgress(null)
          }, 1200)
        }
      })

      return () => {
        if (clearTimer) clearTimeout(clearTimer)
        unlisten()
      }
    }

    let cleanup: (() => void) | undefined
    setup().then((fn) => {
      cleanup = fn
    }).catch(console.error)

    return () => {
      if (cleanup) cleanup()
    }
  }, [transferSessionId])

  function clearProgressSoon() {
    window.setTimeout(() => {
      setIsTransferring(false)
      setProgress(null)
    }, 1200)
  }

  async function cancelTransfer() {
    try {
      await invoke("cancel_transfer", {
        sessionId: transferSessionId
      })
    } catch (e) {
      console.error(e)
    } finally {
      setIsTransferring(false)
      setProgress(null)
    }
  }

  function askConflict(fileName: string, suggestedRename: string) {
    return new Promise<{ action: ConflictAction; applyToAll: boolean; renameValue?: string }>((resolve) => {
      setConflict({
        open: true,
        fileName,
        renameValue: suggestedRename,
        applyToAll: false,
        resolve
      })
    })
  }

  function closeConflict(action: ConflictAction, renameVal?: string) {
    if (!conflict.resolve) return

    const payload = {
      action,
      applyToAll: conflict.applyToAll,
      renameValue: renameVal
    }

    const resolve = conflict.resolve

    setConflict({
      open: false,
      fileName: "",
      renameValue: "",
      applyToAll: false
    })

    resolve(payload)
  }

  async function openEditor(file: FileItem) {
    if (file.is_dir) return

    try {
      const label = `sftp-editor-${Date.now()}`
      const qs = new URLSearchParams({
        editor: "sftp",
        serverId: String(server.id),
        path: buildRemotePath(path, file.name),
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




  async function download(file: FileItem) {
    try {
      const target = await save({
        title: t("downloadFileTitle", lang),
        defaultPath: file.name
      })

      if (!target) return

      const remote = buildRemotePath(path, file.name)

      setIsTransferring(true)
      setProgress({
        transferred: 0,
        total: file.size || 0,
        speed: 0,
        current_file: file.name
      })

      await invoke("sftp_download", {
        id: server.id,
        sessionId: transferSessionId,
        remotePath: remote,
        localPath: target
      })

      await load(path)
      clearProgressSoon()
    } catch (e) {
      console.error(e)
      setIsTransferring(false)
      setProgress(null)
    }
  }

  async function uploadSingle(local: string, remoteName: string) {
    const remote = buildRemotePath(path, remoteName)

    setIsTransferring(true)
    setProgress({
      transferred: 0,
      total: 0,
      speed: 0,
      current_file: remoteName
    })

    await invoke("sftp_upload", {
      id: server.id,
      sessionId: transferSessionId,
      localPath: local,
      remotePath: remote
    })
  }

  async function handleUploads(pathsToUpload: string[]) {
    if (!pathsToUpload.length) return

    let applyAll = false
    let rememberedAction: ConflictAction | null = null
    let rememberedRenameMode = false

    for (const local of pathsToUpload) {
      const name = getPathBaseName(local) || "upload.tmp"
      const exists = files.some((f) => !f.is_dir && f.name === name)

      if (!exists) {
        await uploadSingle(local, name)
        continue
      }

      let action: ConflictAction = "cancel"
      let renameVal = name

      if (applyAll && rememberedAction) {
        action = rememberedAction
        if (rememberedRenameMode) {
          renameVal = uniqueRenamedName(name, files)
        }
      } else {
        const answer = await askConflict(name, uniqueRenamedName(name, files))
        action = answer.action
        renameVal = answer.renameValue || name

        if (answer.applyToAll) {
          applyAll = true
          rememberedAction = action
          rememberedRenameMode = action === "rename"
        }
      }

      if (action === "cancel") {
        setIsTransferring(false)
        setProgress(null)
        return
      }

      if (action === "skip") continue
      if (action === "overwrite") {
        await uploadSingle(local, name)
        continue
      }
      if (action === "rename") {
        await uploadSingle(local, renameVal)
      }
    }

    await load(path)
    clearProgressSoon()
  }

  async function upload() {
    try {
      const selected = await open({
        multiple: true,
        directory: false
      })

      if (!selected) return

      const list = Array.isArray(selected) ? selected : [selected]
      await handleUploads(list)
    } catch (e) {
      console.error(e)
      setIsTransferring(false)
      setProgress(null)
    }
  }

  async function doRename() {
    if (!renameItem || !renameValue.trim()) return
    try {
      await invoke("sftp_rename", {
        id: server.id,
        oldPath: buildRemotePath(path, renameItem.name),
        newPath: buildRemotePath(path, renameValue.trim())
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
      await invoke("sftp_delete", {
        id: server.id,
        path: buildRemotePath(path, deleteItem.name)
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
      await invoke("sftp_mkdir", {
        id: server.id,
        path: buildRemotePath(path, newFolderValue.trim())
      })
      setNewFolderOpen(false)
      setNewFolderValue("")
      await load(path)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    const win = getCurrentWindow()

    const unlistenPromise = win.onDragDropEvent(async (event) => {
      if (!visible) return
      if (event.payload.type !== "drop") return
      if (!panelRef.current) return

      const position = (event.payload as any).position
      const paths = (event.payload as any).paths || []
      if (!position || !paths.length) return

      const rect = panelRef.current.getBoundingClientRect()
      const inside =
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom

      if (!inside) return

      try {
        await handleUploads(paths)
      } catch (e) {
        console.error(e)
        setIsTransferring(false)
        setProgress(null)
      }
    })

    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {})
    }
  }, [visible, path, files, server, conflict])

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
      const next = clampSftpPanelWidth(window.innerWidth - e.clientX)
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

  useEffect(() => {
    persistSftpPanelWidth(panelWidth)
  }, [panelWidth])

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
                {(["folders", "name", "size", "type"] as SftpSortMode[]).map((mode) => (
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
            <button onClick={upload} style={iconBtn} title={t("upload", lang)}>
              <Upload size={14} />
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
                {i === 0 ? <Home size={12} /> : null}
                <span>{part.label}</span>
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
            style={row}
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
            style={{ ...row, position: "relative" }}
            onDoubleClick={() => {
              if (f.is_dir) {
                const next = path + (path.endsWith("/") ? "" : "/") + f.name
                load(next)
              } else {
                openEditor(f)
              }
            }}
            onClick={() => {
              if (f.is_dir) {
                const next = path + (path.endsWith("/") ? "" : "/") + f.name
                load(next)
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
                  <button style={menuButtonStyle} onClick={() => { setMenuItem(null); openEditor(f) }}>
                    {t("edit", lang)}
                  </button>
                )}
                <button style={menuButtonStyle} onClick={() => { setMenuItem(null); setRenameItem(f); setRenameValue(f.name) }}>
                  {t("rename", lang)}
                </button>
                <button style={menuButtonStyle} onClick={() => { setMenuItem(null); setDeleteItem(f) }}>
                  {t("delete", lang)}
                </button>
                {!f.is_dir && (
                  <button style={menuButtonStyle} onClick={() => { setMenuItem(null); download(f) }}>
                    {t("download", lang)}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {(progress || isTransferring) && (
        <div
          style={{
            borderTop: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
            background: "color-mix(in srgb, var(--bg-app) 88%, var(--bg-sidebar))",
            padding: "10px 12px",
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text-main, #e5e7eb)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 8 }}>
            {progress?.current_file || t("transfer", lang)}
          </div>

          <div style={{ height: 6, borderRadius: 999, background: "var(--bg-hover, rgba(255,255,255,0.08))", overflow: "hidden", marginBottom: 8 }}>
            <div
              style={{
                height: "100%",
                width: progress && progress.total > 0 ? `${Math.min(100, (progress.transferred / progress.total) * 100)}%` : "100%",
                background: "var(--accent, #60a5fa)",
                transition: "width 120ms linear"
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
              <span>{formatBytes(progress?.transferred || 0)}</span>
              <span>{formatBytes(progress?.speed || 0)}/s</span>
            </div>

            <button
              onClick={cancelTransfer}
              style={{
                minHeight: 30,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: "var(--text-main, #e5e7eb)",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              {t("cancel", lang)}
            </button>
          </div>
        </div>
      )}

      {conflict.open && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("fileAlreadyExistsTitle", lang)}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)", marginBottom: 12 }}>
              {t("fileAlreadyExistsText", lang).replace("{name}", conflict.fileName)}
            </div>

            <div style={{ fontSize: 12, marginBottom: 6 }}>{t("renameTarget", lang)}</div>

            <input
              value={conflict.renameValue}
              onChange={(e) => setConflict((prev) => ({ ...prev, renameValue: e.target.value }))}
              style={{
                width: "100%",
                boxSizing: "border-box",
                height: 36,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: "var(--text-main, #e5e7eb)",
                outline: "none",
                marginBottom: 12
              }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-main, #e5e7eb)", marginBottom: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={conflict.applyToAll}
                onChange={(e) => setConflict((prev) => ({ ...prev, applyToAll: e.target.checked }))}
              />
              {t("applyToRemainingConflicts", lang)}
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
              <button style={modalBtn} onClick={() => closeConflict("overwrite")}>{t("overwrite", lang)}</button>
              <button style={modalBtn} onClick={() => closeConflict("rename", conflict.renameValue)}>{t("rename", lang)}</button>
              <button style={modalBtn} onClick={() => closeConflict("skip")}>{t("skip", lang)}</button>
              <button style={modalBtn} onClick={() => closeConflict("cancel")}>{t("cancel", lang)}</button>
            </div>
          </div>
        </div>
      )}

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
              <button style={modalBtn} onClick={doRename}>{t("save", lang)}</button>
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
              <button style={modalBtn} onClick={doNewFolder}>{t("create", lang)}</button>
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
              <button style={modalBtn} onClick={doDelete}>{t("delete", lang)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
