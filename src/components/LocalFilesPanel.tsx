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

function getLocalSeparator(path: string) {
  const normalized = String(path || "")
  if (/^[A-Za-z]:\\/.test(normalized) || (normalized.includes("\\") && !normalized.includes("/"))) {
    return "\\"
  }
  return "/"
}

function trimTrailingLocalSeparators(path: string, separator: string) {
  let next = path
  if (!next) return next

  if (separator === "\\") {
    if (/^[A-Za-z]:\\$/.test(next)) return next
    while (next.endsWith("\\") && !/^[A-Za-z]:\\$/.test(next) && next.length > 1) {
      next = next.slice(0, -1)
    }
    return next
  }

  while (next.length > 1 && next.endsWith("/")) {
    next = next.slice(0, -1)
  }

  return next
}

function buildLocalPath(path: string, name: string) {
  if (!path) return name
  const separator = getLocalSeparator(path)
  const trimmed = trimTrailingLocalSeparators(path, separator)

  if (!trimmed) return name
  if (separator === "/" && trimmed === "/") return `/${name}`
  if (separator === "\\" && /^[A-Za-z]:\\$/.test(trimmed)) return `${trimmed}${name}`

  return `${trimmed}${separator}${name}`
}

function isValidLocalEntryName(value: string) {
  const trimmed = value.trim()
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  )
}

function pathParts(path: string) {
  const normalized = String(path || "")
  if (!normalized) return [{ label: "/", full: "/" }]

  const separator = getLocalSeparator(normalized)
  const trimmed = trimTrailingLocalSeparators(normalized, separator)

  if (separator === "\\") {
    const driveMatch = trimmed.match(/^[A-Za-z]:\\/)

    if (driveMatch) {
      const root = driveMatch[0]
      const rest = trimmed.slice(root.length).split("\\").filter(Boolean)
      const out = [{ label: root, full: root }] as { label: string; full: string }[]
      let cur = root

      for (const part of rest) {
        cur = cur.endsWith("\\") ? `${cur}${part}` : `${cur}\\${part}`
        out.push({ label: part, full: cur })
      }

      return out
    }

    const parts = trimmed.split("\\").filter(Boolean)
    if (parts.length === 0) return [{ label: "\\", full: "\\" }]

    const out = [{ label: "\\", full: "\\" }] as { label: string; full: string }[]
    let cur = "\\"

    for (const part of parts) {
      cur = cur === "\\" ? `\\${part}` : `${cur}\\${part}`
      out.push({ label: part, full: cur })
    }

    return out
  }

  if (trimmed === "/") return [{ label: "/", full: "/" }]

  const parts = trimmed.split("/").filter(Boolean)
  const out = [{ label: "/", full: "/" }] as { label: string; full: string }[]
  let cur = ""

  for (const part of parts) {
    cur += "/" + part
    out.push({ label: part, full: cur })
  }

  return out
}

function getParentLocalPath(path: string) {
  const parts = pathParts(path)
  if (parts.length <= 1) return parts[0]?.full || "/"
  return parts[parts.length - 2].full
}

function hasLocalParentPath(path: string) {
  return pathParts(path).length > 1
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

function entryStyle(hovered: boolean, selected = false): React.CSSProperties {
  return {
    ...row,
    position: "relative",
    borderRadius: 12,
    border: selected
      ? "1px solid color-mix(in srgb, var(--accent) 38%, var(--border-subtle))"
      : hovered
        ? "1px solid color-mix(in srgb, var(--accent) 26%, var(--border-subtle))"
        : "1px solid transparent",
    background: selected
      ? "color-mix(in srgb, var(--accent) 16%, transparent)"
      : hovered
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
  const [errorText, setErrorText] = useState("")
  const [successText, setSuccessText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const resizeDragRef = useRef(false)
  const loadSeqRef = useRef(0)

  const visibleFiles = useMemo(() => {
    const filtered = showHidden ? files : files.filter((f) => !f.name.startsWith("."))
    return sortFiles(filtered, sortMode)
  }, [files, showHidden, sortMode])

  const renameTrimmed = renameValue.trim()
  const newFolderTrimmed = newFolderValue.trim()
  const renameValid = Boolean(
    renameItem &&
    isValidLocalEntryName(renameTrimmed) &&
    renameTrimmed !== renameItem.name
  )
  const newFolderValid = isValidLocalEntryName(newFolderTrimmed)

  const navigableEntries = useMemo(() => {
    const entries = visibleFiles.map((f) => f.name)
    return hasLocalParentPath(path) ? ["__parent__", ...entries] : entries
  }, [path, visibleFiles])

  function clearTransientChrome() {
    setMenuItem(null)
    setMenuStyle(null)
    setSortMenuOpen(false)
    setSortMenuStyle(null)
  }

  function activateEntry(entryName: string) {
    if (entryName === "__parent__") {
      void load(getParentLocalPath(path))
      return
    }

    const entry = visibleFiles.find((f) => f.name === entryName)
    if (!entry) return

    if (entry.is_dir) {
      void load(buildLocalPath(path, entry.name))
      return
    }

    void openEditor(entry)
  }

  function toErrorText(error: unknown, deFallback: string, enFallback: string) {
    const detail = error instanceof Error ? error.message.trim() : String(error || "").trim()
    return detail || (lang === "de" ? deFallback : enFallback)
  }

  async function load(nextPath: string) {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    setIsLoading(true)
    setSuccessText("")

    try {
      const res = await invoke("local_list_dir", { path: nextPath }) as FileItem[]
      if (loadSeqRef.current !== seq) return
      setFiles(Array.isArray(res) ? res : [])
      setPath(nextPath)
      setErrorText("")
    } catch (e) {
      if (loadSeqRef.current !== seq) return
      console.error(e)
      setFiles([])
      setErrorText(toErrorText(e, "Ordner konnte nicht geladen werden", "Failed to load folder"))
      setSuccessText("")
    } finally {
      if (loadSeqRef.current === seq) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!visible) return

    invoke("get_local_home_dir")
      .then((home) => {
        const resolvedHome = String(home || "/")
        return load(resolvedHome)
      })
      .catch(() => {
        return load("/")
      })
  }, [visible])

  useEffect(() => {
    if (visible) return

    loadSeqRef.current += 1
    setIsLoading(false)
    setActionBusy(false)
    clearTransientChrome()
    setHoveredItem(null)
    setSelectedItem(null)
    setRenameItem(null)
    setRenameValue("")
    setNewFolderOpen(false)
    setNewFolderValue("")
    setDeleteItem(null)
    setErrorText("")
    setSuccessText("")
  }, [visible])

  useEffect(() => {
    if (!visible) return

    if (!navigableEntries.length) {
      setSelectedItem(null)
      return
    }

    if (selectedItem && navigableEntries.includes(selectedItem)) return
    setSelectedItem(navigableEntries[0])
  }, [visible, navigableEntries, selectedItem])

  useEffect(() => {
    if (!visible || !selectedItem) return

    const listEl = listRef.current
    if (!listEl) return

    const rows = Array.from(
      listEl.querySelectorAll<HTMLElement>("[data-local-entry-key]")
    )
    const target = rows.find((row) => row.dataset.localEntryKey === selectedItem)
    if (!target) return

    const top = target.offsetTop
    const bottom = top + target.offsetHeight
    const viewTop = listEl.scrollTop
    const viewBottom = viewTop + listEl.clientHeight

    if (top < viewTop) {
      listEl.scrollTop = top
      return
    }

    if (bottom > viewBottom) {
      listEl.scrollTop = bottom - listEl.clientHeight
    }
  }, [visible, selectedItem, path, visibleFiles])

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

  useEffect(() => {
    if (!visible) return

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping = tag === "input" || tag === "textarea" || Boolean(target?.isContentEditable)

      if (renameItem) {
        if (e.key === "Escape" && !actionBusy) {
          e.preventDefault()
          e.stopPropagation()
          setRenameItem(null)
          setRenameValue("")
          return
        }

        if (e.key === "Enter" && !actionBusy && renameValid) {
          e.preventDefault()
          e.stopPropagation()
          void doRename()
        }

        return
      }

      if (newFolderOpen) {
        if (e.key === "Escape" && !actionBusy) {
          e.preventDefault()
          e.stopPropagation()
          setNewFolderOpen(false)
          setNewFolderValue("")
          return
        }

        if (e.key === "Enter" && !actionBusy && newFolderValid) {
          e.preventDefault()
          e.stopPropagation()
          void doNewFolder()
        }

        return
      }

      if (deleteItem) {
        if (e.key === "Escape" && !actionBusy) {
          e.preventDefault()
          e.stopPropagation()
          setDeleteItem(null)
          return
        }

        if (e.key === "Enter" && !actionBusy) {
          e.preventDefault()
          e.stopPropagation()
          void doDelete()
        }

        return
      }

      if (isTyping) return

      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()

        if (menuItem || sortMenuOpen) {
          clearTransientChrome()
          return
        }

        if (errorText) {
          setErrorText("")
          return
        }

        if (successText) {
          setSuccessText("")
          return
        }

        onClose?.()
        return
      }

      if (!navigableEntries.length) return

      const current = selectedItem && navigableEntries.includes(selectedItem)
        ? selectedItem
        : navigableEntries[0]

      const currentIndex = navigableEntries.indexOf(current)

      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setSelectedItem(navigableEntries[Math.min(currentIndex + 1, navigableEntries.length - 1)])
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setSelectedItem(navigableEntries[Math.max(currentIndex - 1, 0)])
        return
      }

      if (e.key === "Enter" && current) {
        e.preventDefault()
        e.stopPropagation()
        activateEntry(current)
        return
      }

      if (e.key === "F2" && current && current !== "__parent__") {
        const entry = visibleFiles.find((f) => f.name === current)
        if (!entry) return

        e.preventDefault()
        e.stopPropagation()
        setRenameItem(entry)
        setRenameValue(entry.name)
        clearTransientChrome()
        return
      }

      if (e.key === "Delete" && current && current !== "__parent__") {
        const entry = visibleFiles.find((f) => f.name === current)
        if (!entry) return

        e.preventDefault()
        e.stopPropagation()
        setDeleteItem(entry)
        clearTransientChrome()
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [
    visible,
    renameItem,
    newFolderOpen,
    deleteItem,
    actionBusy,
    renameValid,
    newFolderValid,
    menuItem,
    sortMenuOpen,
    errorText,
    successText,
    navigableEntries,
    selectedItem,
    visibleFiles,
    lang,
    onClose
  ])

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
      setErrorText(toErrorText(e, "Editor konnte nicht geöffnet werden", "Failed to open editor"))
    }
  }

  async function doRename() {
    if (!renameItem || actionBusy) return
    if (!renameValid) {
      setErrorText(lang === "de" ? "Ungültiger Name für Umbenennen" : "Invalid rename target")
      return
    }

    const previousName = renameItem.name

    setActionBusy(true)
    try {
      await invoke("local_rename", {
        oldPath: buildLocalPath(path, renameItem.name),
        newPath: buildLocalPath(path, renameTrimmed)
      })
      setRenameItem(null)
      setRenameValue("")
      await load(path)
      setSuccessText(
        lang === "de"
          ? `Eintrag umbenannt: ${previousName}`
          : `Renamed entry: ${previousName}`
      )
    } catch (e) {
      console.error(e)
      setErrorText(toErrorText(e, "Umbenennen fehlgeschlagen", "Rename failed"))
    } finally {
      setActionBusy(false)
    }
  }

  async function doDelete() {
    if (!deleteItem || actionBusy) return

    const targetName = deleteItem.name

    setActionBusy(true)
    try {
      await invoke("local_delete", {
        path: buildLocalPath(path, deleteItem.name)
      })
      setDeleteItem(null)
      await load(path)
      setSuccessText(
        lang === "de"
          ? `Eintrag gelöscht: ${targetName}`
          : `Deleted entry: ${targetName}`
      )
    } catch (e) {
      console.error(e)
      setErrorText(toErrorText(e, "Löschen fehlgeschlagen", "Delete failed"))
    } finally {
      setActionBusy(false)
    }
  }

  async function doNewFolder() {
    if (actionBusy) return
    if (!newFolderValid) {
      setErrorText(lang === "de" ? "Ungültiger Ordnername" : "Invalid folder name")
      return
    }

    const folderName = newFolderTrimmed

    setActionBusy(true)
    try {
      await invoke("local_mkdir", {
        path: buildLocalPath(path, newFolderTrimmed)
      })
      setNewFolderOpen(false)
      setNewFolderValue("")
      await load(path)
      setSuccessText(
        lang === "de"
          ? `Ordner erstellt: ${folderName}`
          : `Created folder: ${folderName}`
      )
    } catch (e) {
      console.error(e)
      setErrorText(toErrorText(e, "Ordner konnte nicht erstellt werden", "Failed to create folder"))
    } finally {
      setActionBusy(false)
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
                  void load(resolvedHome)
                })
                .catch(() => {
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

      {errorText && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(239,68,68,0.22)",
            background: "rgba(127,29,29,0.18)",
            color: "#fecaca",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 12,
            lineHeight: 1.4
          }}
        >
          <span style={{ flex: 1 }}>{errorText}</span>
          <button
            style={{
              ...iconBtn,
              width: 28,
              height: 28,
              flexShrink: 0
            }}
            onClick={() => setErrorText("")}
            title={t("dismiss", lang)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {successText && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(34,197,94,0.22)",
            background: "rgba(21,128,61,0.16)",
            color: "#bbf7d0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 12,
            lineHeight: 1.4
          }}
        >
          <span style={{ flex: 1 }}>{successText}</span>
          <button
            style={{
              ...iconBtn,
              width: 28,
              height: 28,
              flexShrink: 0
            }}
            onClick={() => setSuccessText("")}
            title={t("dismiss", lang)}
          >
            <X size={13} />
          </button>
        </div>
      )}

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
                <span>{part.label}</span>
              </button>
              {i < arr.length - 1 && <ChevronRight size={12} />}
            </React.Fragment>
          ))}
        </div>

        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
          <span>{isLoading ? (lang === "de" ? "Lade…" : "Loading…") : `${visibleFiles.length} ${t("visibleCount", lang)}`}</span>
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
        {hasLocalParentPath(path) && (
          <div
            data-local-entry-key="__parent__"
            style={entryStyle(hoveredItem === "__parent__", selectedItem === "__parent__")}
            onMouseEnter={() => setHoveredItem("__parent__")}
            onMouseLeave={() => setHoveredItem((current) => current === "__parent__" ? null : current)}
            onClick={() => {
              setSelectedItem("__parent__")
              void load(getParentLocalPath(path))
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
            data-local-entry-key={f.name}
            style={entryStyle(hoveredItem === f.name, selectedItem === f.name)}
            onMouseEnter={() => setHoveredItem(f.name)}
            onMouseLeave={() => setHoveredItem((current) => current === f.name ? null : current)}
            onDoubleClick={() => {
              setSelectedItem(f.name)
              if (f.is_dir) {
                void load(buildLocalPath(path, f.name))
              } else {
                void openEditor(f)
              }
            }}
            onClick={() => {
              setSelectedItem(f.name)
              if (f.is_dir) {
                void load(buildLocalPath(path, f.name))
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

                setSelectedItem(f.name)

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
              disabled={actionBusy}
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
              <button
                style={{ ...modalBtn, opacity: actionBusy ? 0.6 : 1, cursor: actionBusy ? "not-allowed" : "pointer" }}
                onClick={() => { if (!actionBusy) { setRenameItem(null); setRenameValue("") } }}
                disabled={actionBusy}
              >
                {t("cancel", lang)}
              </button>
              <button
                style={{ ...modalBtn, opacity: actionBusy || !renameValid ? 0.6 : 1, cursor: actionBusy || !renameValid ? "not-allowed" : "pointer" }}
                onClick={() => void doRename()}
                disabled={actionBusy || !renameValid}
              >
                {actionBusy ? (lang === "de" ? "Speichert..." : "Saving...") : t("save", lang)}
              </button>
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
              disabled={actionBusy}
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
              <button
                style={{ ...modalBtn, opacity: actionBusy ? 0.6 : 1, cursor: actionBusy ? "not-allowed" : "pointer" }}
                onClick={() => { if (!actionBusy) { setNewFolderOpen(false); setNewFolderValue("") } }}
                disabled={actionBusy}
              >
                {t("cancel", lang)}
              </button>
              <button
                style={{ ...modalBtn, opacity: actionBusy || !newFolderValid ? 0.6 : 1, cursor: actionBusy || !newFolderValid ? "not-allowed" : "pointer" }}
                onClick={() => void doNewFolder()}
                disabled={actionBusy || !newFolderValid}
              >
                {actionBusy ? (lang === "de" ? "Erstellt..." : "Creating...") : t("create", lang)}
              </button>
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
              <button
                style={{ ...modalBtn, opacity: actionBusy ? 0.6 : 1, cursor: actionBusy ? "not-allowed" : "pointer" }}
                onClick={() => { if (!actionBusy) setDeleteItem(null) }}
                disabled={actionBusy}
              >
                {t("cancel", lang)}
              </button>
              <button
                style={{ ...modalBtn, opacity: actionBusy ? 0.6 : 1, cursor: actionBusy ? "not-allowed" : "pointer" }}
                onClick={() => void doDelete()}
                disabled={actionBusy}
              >
                {actionBusy ? (lang === "de" ? "Löscht..." : "Deleting...") : t("delete", lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
