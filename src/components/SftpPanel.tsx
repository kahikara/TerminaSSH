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

function buildLocalTargetPath(path: string, name: string) {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/"
  const trimmed = separator === "\\"
    ? path.replace(/\\+$/, "")
    : path.replace(/\/+$/, "")

  return `${trimmed}${separator}${name}`
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

type CompactBreadcrumbPart = {
  label: string
  full: string
  collapsed: boolean
  hiddenParts?: { label: string; full: string }[]
}

function compactBreadcrumbParts(parts: { label: string; full: string }[]): CompactBreadcrumbPart[] {
  if (parts.length <= 4) {
    return parts.map((part) => ({ ...part, collapsed: false, hiddenParts: [] }))
  }

  return [
    { ...parts[0], collapsed: false, hiddenParts: [] },
    { label: "…", full: "", collapsed: true, hiddenParts: parts.slice(1, -2) },
    ...parts.slice(-2).map((part) => ({ ...part, collapsed: false, hiddenParts: [] }))
  ]
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

function getBreadcrumbMenuPosition(
  buttonRect: DOMRect,
  panelRect: DOMRect,
  itemCount: number
): React.CSSProperties {
  const menuWidth = 188
  const menuHeight = Math.min(220, Math.max(44, itemCount * 34 + 8))
  const gap = 6

  const spaceBelow = panelRect.bottom - buttonRect.bottom
  const openUp = spaceBelow < menuHeight + gap

  const top = openUp
    ? -(menuHeight + gap - Math.max(0, buttonRect.height - 4))
    : buttonRect.height + gap

  return {
    position: "absolute",
    top,
    left: 0,
    width: menuWidth,
    minWidth: menuWidth,
    maxHeight: 220,
    borderRadius: 10,
    border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
    background: "color-mix(in srgb, var(--bg-app) 92%, black)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    overflowX: "hidden",
    overflowY: "auto",
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

function getPanelContextMenuPosition(
  panelRect: DOMRect,
  clientX: number,
  clientY: number,
  width: number,
  height: number
): React.CSSProperties {
  const left = Math.max(8, Math.min(clientX - panelRect.left, panelRect.width - width - 8))
  const top = Math.max(8, Math.min(clientY - panelRect.top, panelRect.height - height - 8))

  return {
    position: "absolute",
    left,
    top,
    width,
    minWidth: width,
    borderRadius: 10,
    border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
    background: "var(--bg-app, #020617)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    overflow: "hidden",
    zIndex: 80
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
  padding: "6px 10px",
  minHeight: 46,
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
  width: 32,
  height: 32,
  borderRadius: 8,
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
  minHeight: 34,
  padding: "0 10px",
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

function sftpEntryStyle(hovered: boolean, selected = false): React.CSSProperties {
  return {
    ...row,
    position: "relative",
    background: selected
      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
      : hovered
        ? "color-mix(in srgb, var(--bg-hover) 84%, transparent)"
        : "transparent",
    transition: "background 120ms ease"
  }
}

export default function SftpPanel({
  server,
  visible,
  onClose,
  lang = "de",
  showStatusBar = true
}: any) {
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
  const [deleteItems, setDeleteItems] = useState<FileItem[]>([])

  const initialSettings = readTerminaSettings()
  const [showHidden, setShowHidden] = useState(Boolean(initialSettings.sftpHidden))
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [sortMenuStyle, setSortMenuStyle] = useState<React.CSSProperties | null>(null)
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false)
  const [browserMenuStyle, setBrowserMenuStyle] = useState<React.CSSProperties | null>(null)
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
  const [selectionMenuStyle, setSelectionMenuStyle] = useState<React.CSSProperties | null>(null)
  const [breadcrumbMenuParts, setBreadcrumbMenuParts] = useState<{ label: string; full: string }[]>([])
  const [breadcrumbMenuStyle, setBreadcrumbMenuStyle] = useState<React.CSSProperties | null>(null)
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
  const [contextMenuItem, setContextMenuItem] = useState<string | null>(null)
  const [contextMenuStyle, setContextMenuStyle] = useState<React.CSSProperties | null>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)

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

  const navigableEntries = useMemo(() => {
    const entries = visibleFiles.map((f) => f.name)
    return path !== "/" ? ["__parent__", ...entries] : entries
  }, [path, visibleFiles])

  const hasTransientMenuOpen = Boolean(menuItem || contextMenuItem || sortMenuOpen || browserMenuOpen || selectionMenuOpen || breadcrumbMenuParts.length > 0)

  const visibleFolderCount = useMemo(
    () => visibleFiles.filter((file) => file.is_dir).length,
    [visibleFiles]
  )
  const visibleFileCount = useMemo(
    () => visibleFiles.filter((file) => !file.is_dir).length,
    [visibleFiles]
  )
  const selectedVisibleEntries = useMemo(
    () => visibleFiles.filter((file) => selectedItems.includes(file.name)),
    [visibleFiles, selectedItems]
  )
  const selectedDownloadableEntries = useMemo(
    () => selectedVisibleEntries.filter((file) => !file.is_dir),
    [selectedVisibleEntries]
  )
  const allSelectedEntriesAreFiles = useMemo(
    () => selectedVisibleEntries.length > 0 && selectedDownloadableEntries.length === selectedVisibleEntries.length,
    [selectedVisibleEntries, selectedDownloadableEntries]
  )
  const selectedEntryCount = selectedVisibleEntries.length
  const selectedFileBytes = useMemo(
    () => selectedVisibleEntries.reduce((sum, file) => sum + (file.is_dir ? 0 : file.size), 0),
    [selectedVisibleEntries]
  )
  const visibleStatusText = useMemo(
    () => lang === "de"
      ? `${visibleFolderCount} Ordner, ${visibleFileCount} Dateien`
      : `${visibleFolderCount} folders, ${visibleFileCount} files`,
    [lang, visibleFolderCount, visibleFileCount]
  )
  const selectedStatusText = useMemo(() => {
    if (selectedEntryCount === 0) return ""

    const parts = [
      lang === "de"
        ? `${selectedEntryCount} ausgewählt`
        : `${selectedEntryCount} selected`
    ]

    if (selectedFileBytes > 0) {
      parts.push(formatBytes(selectedFileBytes))
    }

    return parts.join(", ")
  }, [lang, selectedEntryCount, selectedFileBytes])
  const deleteFolderCount = useMemo(
    () => deleteItems.filter((item) => item.is_dir).length,
    [deleteItems]
  )
  const deleteFileCount = useMemo(
    () => deleteItems.filter((item) => !item.is_dir).length,
    [deleteItems]
  )
  const deleteFileBytes = useMemo(
    () => deleteItems.reduce((sum, item) => sum + (item.is_dir ? 0 : item.size), 0),
    [deleteItems]
  )
  const deleteSummaryPrimary = useMemo(() => {
    if (deleteItems.length <= 1) return ""

    return lang === "de"
      ? `${deleteItems.length} ausgewählt`
      : `${deleteItems.length} selected`
  }, [deleteItems, lang])
  const deleteSummarySecondary = useMemo(() => {
    if (deleteItems.length <= 1) return ""

    const parts: string[] = []

    if (deleteFolderCount > 0) {
      parts.push(lang === "de" ? `${deleteFolderCount} Ordner` : `${deleteFolderCount} folders`)
    }

    if (deleteFileCount > 0) {
      parts.push(lang === "de" ? `${deleteFileCount} Dateien` : `${deleteFileCount} files`)
    }

    if (deleteFileBytes > 0) {
      parts.push(formatBytes(deleteFileBytes))
    }

    return parts.join(", ")
  }, [deleteItems, deleteFolderCount, deleteFileCount, deleteFileBytes, lang])

  function isItemSelected(itemName: string) {
    return selectedItems.includes(itemName)
  }

  function isNavigableItem(itemName: string | null) {
    return Boolean(itemName && navigableEntries.includes(itemName))
  }

  function selectSingleItem(itemName: string | null) {
    setSelectedItems(itemName ? [itemName] : [])
    setActiveItem(itemName)
    setSelectionAnchor(itemName)
  }

  function selectRangeToItem(itemName: string) {
    if (itemName === "__parent__") {
      selectSingleItem("__parent__")
      return
    }

    const anchor = isNavigableItem(selectionAnchor) && selectionAnchor !== "__parent__"
      ? selectionAnchor
      : isNavigableItem(activeItem) && activeItem !== "__parent__"
        ? activeItem
        : itemName

    const startIndex = navigableEntries.indexOf(anchor || itemName)
    const endIndex = navigableEntries.indexOf(itemName)

    if (startIndex === -1 || endIndex === -1) {
      selectSingleItem(itemName)
      return
    }

    const from = Math.min(startIndex, endIndex)
    const to = Math.max(startIndex, endIndex)

    setSelectedItems(
      navigableEntries.slice(from, to + 1).filter((entry) => entry !== "__parent__")
    )
    setActiveItem(itemName)
    setSelectionAnchor(anchor || itemName)
  }

  function toggleItemSelection(itemName: string) {
    if (itemName === "__parent__") {
      selectSingleItem("__parent__")
      return
    }

    const exists = selectedItems.includes(itemName)

    if (!exists) {
      setSelectedItems([...selectedItems, itemName])
      setActiveItem(itemName)
      setSelectionAnchor(itemName)
      return
    }

    const next = selectedItems.filter((item) => item !== itemName)
    setSelectedItems(next)
    setActiveItem(next.length ? (next.includes(activeItem || "") ? activeItem : next[next.length - 1]) : null)
    setSelectionAnchor(itemName)
  }

  function selectAllItems() {
    const nextItems = visibleFiles.map((file) => file.name)
    if (!nextItems.length) {
      selectSingleItem(null)
      return
    }

    const nextActive = activeItem && nextItems.includes(activeItem) ? activeItem : nextItems[0]
    setSelectedItems(nextItems)
    setActiveItem(nextActive)
    setSelectionAnchor(nextActive)
  }

  function clearTransientChrome() {
    setMenuItem(null)
    setMenuStyle(null)
    setContextMenuItem(null)
    setContextMenuStyle(null)
    setSortMenuOpen(false)
    setSortMenuStyle(null)
    setBrowserMenuOpen(false)
    setBrowserMenuStyle(null)
    setSelectionMenuOpen(false)
    setSelectionMenuStyle(null)
    setBreadcrumbMenuParts([])
    setBreadcrumbMenuStyle(null)
  }

  function openBrowserContextMenu(clientX: number, clientY: number) {
    const panelRect = panelRef.current?.getBoundingClientRect()
    if (!panelRect) return

    setBrowserMenuStyle(getPanelContextMenuPosition(panelRect, clientX, clientY, 176, 160))
    setBrowserMenuOpen(true)
  }

  function openSelectionContextMenu(clientX: number, clientY: number) {
    const panelRect = panelRef.current?.getBoundingClientRect()
    if (!panelRect) return

    const actionCount = (allSelectedEntriesAreFiles ? 1 : 0) + (selectedVisibleEntries.length > 0 ? 1 : 0)
    const menuHeight = actionCount > 1 ? 90 : 54

    setSelectionMenuStyle(getPanelContextMenuPosition(panelRect, clientX, clientY, 176, menuHeight))
    setSelectionMenuOpen(true)
  }

  function openEntryContextMenu(entry: FileItem, clientX: number, clientY: number) {
    const panelRect = panelRef.current?.getBoundingClientRect()
    if (!panelRect) return

    if (selectedVisibleEntries.length > 1 && selectedItems.includes(entry.name)) {
      setContextMenuItem(null)
      setContextMenuStyle(null)
      openSelectionContextMenu(clientX, clientY)
      return
    }

    selectSingleItem(entry.name)
    setContextMenuItem(entry.name)
    setContextMenuStyle(getPanelContextMenuPosition(panelRect, clientX, clientY, 156, entry.is_dir ? 118 : 190))
  }

  function activateEntry(entryName: string) {
    if (entryName === "__parent__") {
      selectSingleItem("__parent__")
      const parent = path.split("/").slice(0, -2).join("/") || "/"
      void load(parent)
      return
    }

    const entry = visibleFiles.find((f) => f.name === entryName)
    if (!entry) return

    if (!isItemSelected(entry.name)) {
      selectSingleItem(entry.name)
    } else {
      setActiveItem(entry.name)
    }

    if (entry.is_dir) {
      const next = path + (path.endsWith("/") ? "" : "/") + entry.name
      void load(next)
      return
    }

    void openEditor(entry)
  }

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
    if (!visible || !server?.id) return

    setPath("/")
    void load("/")
  }, [visible, server?.id])

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
      const label = `sftp-editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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
    let knownFiles = [...files]

    for (const local of pathsToUpload) {
      const name = getPathBaseName(local) || "upload.tmp"
      const exists = knownFiles.some((f) => !f.is_dir && f.name === name)

      if (!exists) {
        await uploadSingle(local, name)
        knownFiles.push({ name, is_dir: false, size: 0 })
        continue
      }

      let action: ConflictAction = "cancel"
      let renameVal = name

      if (applyAll && rememberedAction) {
        action = rememberedAction
        if (rememberedRenameMode) {
          renameVal = uniqueRenamedName(name, knownFiles)
        }
      } else {
        const answer = await askConflict(name, uniqueRenamedName(name, knownFiles))
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
        knownFiles.push({ name: renameVal, is_dir: false, size: 0 })
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

  async function downloadSelected() {
    if (!allSelectedEntriesAreFiles) return

    const targets = selectedDownloadableEntries
    if (!targets.length) return

    if (targets.length === 1) {
      await download(targets[0])
      return
    }

    try {
      const targetDir = await open({
        directory: true,
        multiple: false,
        title: lang === "de" ? "Zielordner wählen" : "Choose target folder"
      })

      if (!targetDir || Array.isArray(targetDir)) return

      setIsTransferring(true)
      setProgress({
        transferred: 0,
        total: 0,
        speed: 0,
        current_file: targets[0].name
      })

      for (const file of targets) {
        setProgress({
          transferred: 0,
          total: file.size || 0,
          speed: 0,
          current_file: file.name
        })

        await invoke("sftp_download", {
          id: server.id,
          sessionId: transferSessionId,
          remotePath: buildRemotePath(path, file.name),
          localPath: buildLocalTargetPath(targetDir, file.name)
        })
      }

      clearProgressSoon()
    } catch (e) {
      console.error(e)
      setIsTransferring(false)
      setProgress(null)
    }
  }

  function openDeleteSelection(items?: FileItem[]) {
    const targets = (items && items.length ? items : selectedVisibleEntries).filter((item) => !item.is_dir || item.is_dir)
    if (!targets.length) return
    setDeleteItems(targets)
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
    if (!deleteItems.length) return
    try {
      for (const item of deleteItems) {
        await invoke("sftp_delete", {
          id: server.id,
          path: buildRemotePath(path, item.name)
        })
      }
      setDeleteItems([])
      selectSingleItem(null)
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
      clearTransientChrome()
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

  useEffect(() => {
    if (!visible) return

    if (!navigableEntries.length) {
      selectSingleItem(null)
      return
    }

    if (activeItem && navigableEntries.includes(activeItem)) {
      setSelectedItems((prev) => {
        const filtered = prev.filter((item) => navigableEntries.includes(item))
        return filtered.includes(activeItem) ? filtered : [activeItem, ...filtered]
      })
      return
    }

    selectSingleItem(navigableEntries[0])
  }, [visible, navigableEntries, activeItem])

  useEffect(() => {
    if (!visible || !activeItem) return

    const listEl = listRef.current
    if (!listEl) return

    const rows = Array.from(
      listEl.querySelectorAll<HTMLElement>("[data-sftp-entry-key]")
    )
    const target = rows.find((row) => row.dataset.sftpEntryKey === activeItem)
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
  }, [visible, activeItem, path, visibleFiles])

  useEffect(() => {
    if (!visible) return

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping = tag === "input" || tag === "textarea" || Boolean(target?.isContentEditable)

      if (conflict.open) {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          closeConflict("cancel")
        }
        return
      }

      if (renameItem) {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          setRenameItem(null)
          setRenameValue("")
          return
        }

        if (e.key === "Enter" && renameValue.trim()) {
          e.preventDefault()
          e.stopPropagation()
          void doRename()
        }
        return
      }

      if (newFolderOpen) {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          setNewFolderOpen(false)
          setNewFolderValue("")
          return
        }

        if (e.key === "Enter" && newFolderValue.trim()) {
          e.preventDefault()
          e.stopPropagation()
          void doNewFolder()
        }
        return
      }

      if (deleteItems.length > 0) {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          setDeleteItems([])
          return
        }

        if (e.key === "Enter") {
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

        if (selectedItems.length > 0) {
          selectSingleItem(null)
          return
        }

        if (hasTransientMenuOpen) {
          clearTransientChrome()
          return
        }

        onClose?.()
        return
      }

      if (e.key === "Backspace" && path !== "/") {
        e.preventDefault()
        e.stopPropagation()
        clearTransientChrome()
        selectSingleItem("__parent__")
        const parent = path.split("/").slice(0, -2).join("/") || "/"
        void load(parent)
        return
      }

      if (!navigableEntries.length) return

      const mod = e.ctrlKey || e.metaKey

      const current = activeItem && navigableEntries.includes(activeItem)
        ? activeItem
        : navigableEntries[0]

      const currentIndex = navigableEntries.indexOf(current)
      const nextDown = navigableEntries[Math.min(currentIndex + 1, navigableEntries.length - 1)]
      const nextUp = navigableEntries[Math.max(currentIndex - 1, 0)]

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault()
        e.stopPropagation()
        clearTransientChrome()
        selectAllItems()
        return
      }

      if (e.key === " " || e.code === "Space") {
        e.preventDefault()
        e.stopPropagation()

        if (e.shiftKey) {
          selectRangeToItem(current)
          return
        }

        if (mod) {
          toggleItemSelection(current)
          return
        }

        selectSingleItem(current)
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          selectRangeToItem(nextDown)
        } else {
          selectSingleItem(nextDown)
        }
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          selectRangeToItem(nextUp)
        } else {
          selectSingleItem(nextUp)
        }
        return
      }

      if (e.key === "Enter" && current) {
        e.preventDefault()
        e.stopPropagation()
        clearTransientChrome()
        activateEntry(current)
        return
      }

      if (e.key === "F2" && current && current !== "__parent__") {
        const entry = visibleFiles.find((f) => f.name === current)
        if (!entry) return

        e.preventDefault()
        e.stopPropagation()
        clearTransientChrome()
        setRenameItem(entry)
        setRenameValue(entry.name)
        return
      }

      if (e.key === "Delete" && selectedVisibleEntries.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        clearTransientChrome()
        openDeleteSelection()
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [visible, hasTransientMenuOpen, conflict.open, renameItem, renameValue, newFolderOpen, newFolderValue, deleteItems, navigableEntries, activeItem, selectedItems, path, visibleFiles, onClose])

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
        clearTransientChrome()
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
          padding: "8px 10px",
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
            gap: 5,
            overflowX: "auto",
            minWidth: 0
          }}
        >
          {compactBreadcrumbParts(pathParts(path)).map((part, i, arr) => (
            <React.Fragment key={part.collapsed ? `collapsed-${i}` : part.full}>
              {part.collapsed ? (
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()

                      if (breadcrumbMenuParts.length > 0) {
                        setBreadcrumbMenuParts([])
                        setBreadcrumbMenuStyle(null)
                        return
                      }

                      const hiddenParts = part.hiddenParts || []
                      if (!hiddenParts.length) return

                      const panelEl = panelRef.current
                      const buttonEl = e.currentTarget as HTMLButtonElement

                      setMenuItem(null)
                      setMenuStyle(null)
                      setContextMenuItem(null)
                      setContextMenuStyle(null)
                      setSortMenuOpen(false)
                      setSortMenuStyle(null)
                      setBrowserMenuOpen(false)
                      setBrowserMenuStyle(null)
                      setSelectionMenuOpen(false)
                      setSelectionMenuStyle(null)

                      if (panelEl && buttonEl) {
                        const panelRect = panelEl.getBoundingClientRect()
                        const buttonRect = buttonEl.getBoundingClientRect()
                        setBreadcrumbMenuStyle(getBreadcrumbMenuPosition(buttonRect, panelRect, hiddenParts.length))
                      } else {
                        setBreadcrumbMenuStyle(null)
                      }

                      setBreadcrumbMenuParts(hiddenParts)
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      background: "transparent",
                      color: "var(--text-muted, #94a3b8)",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      flexShrink: 0
                    }}
                    title={lang === "de" ? "Versteckte Ebenen anzeigen" : "Show hidden levels"}
                  >
                    {part.label}
                  </button>

                  {breadcrumbMenuParts.length > 0 && (
                    <div
                      style={breadcrumbMenuStyle || {
                        position: "absolute",
                        top: 22,
                        left: 0,
                        width: 188,
                        minWidth: 188,
                        maxHeight: 220,
                        borderRadius: 10,
                        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                        background: "color-mix(in srgb, var(--bg-app) 92%, black)",
                        boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                        overflowX: "hidden",
                        overflowY: "auto",
                        zIndex: 35
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {breadcrumbMenuParts.map((hiddenPart) => (
                        <button
                          key={hiddenPart.full}
                          style={menuButtonStyle}
                          title={hiddenPart.full}
                          onClick={() => {
                            clearTransientChrome()
                            void load(hiddenPart.full)
                          }}
                        >
                          {hiddenPart.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    clearTransientChrome()
                    void load(part.full)
                  }}
                  title={part.full}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    border: "none",
                    background: "transparent",
                    color: i === arr.length - 1 ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 12,
                    fontWeight: i === arr.length - 1 ? 600 : 500,
                    whiteSpace: "nowrap",
                    maxWidth: i === arr.length - 1 ? 220 : 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flexShrink: i === arr.length - 1 ? 0 : 1
                  }}
                >
                  {i === 0 ? <Home size={12} /> : null}
                  <span>{part.label}</span>
                </button>
              )}
              {i < arr.length - 1 && <ChevronRight size={11} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest("[data-sftp-entry-key]")) return
          if (target?.closest("[data-sftp-context-menu]")) return

          e.preventDefault()
          e.stopPropagation()
          clearTransientChrome()
          openBrowserContextMenu(e.clientX, e.clientY)
        }}
        onClick={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest("[data-sftp-entry-key]")) return
          if (target?.closest("[data-sftp-context-menu]")) return

          if (hasTransientMenuOpen) {
            clearTransientChrome()
            return
          }

          selectSingleItem(null)
        }}
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          background: "color-mix(in srgb, var(--bg-app) 90%, var(--bg-sidebar))"
        }}
      >
        {path !== "/" && (
          <div
            data-sftp-entry-key="__parent__"
            style={sftpEntryStyle(hoveredItem === "__parent__", isItemSelected("__parent__"))}
            onMouseEnter={() => setHoveredItem("__parent__")}
            onMouseLeave={() => setHoveredItem((current) => current === "__parent__" ? null : current)}
            onDoubleClick={() => {
              if (hasTransientMenuOpen) {
                clearTransientChrome()
                return
              }

              activateEntry("__parent__")
            }}
            onClick={() => {
              if (hasTransientMenuOpen) {
                clearTransientChrome()
                return
              }

              selectSingleItem("__parent__")
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
            data-sftp-entry-key={f.name}
            style={sftpEntryStyle(hoveredItem === f.name, isItemSelected(f.name))}
            onMouseEnter={() => setHoveredItem(f.name)}
            onMouseLeave={() => setHoveredItem((current) => current === f.name ? null : current)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              clearTransientChrome()
              openEntryContextMenu(f, e.clientX, e.clientY)
            }}
            onDoubleClick={() => {
              if (hasTransientMenuOpen) {
                clearTransientChrome()
                return
              }

              activateEntry(f.name)
            }}
            onClick={(e) => {
              if (hasTransientMenuOpen) {
                clearTransientChrome()
                return
              }

              if (e.shiftKey) {
                selectRangeToItem(f.name)
                return
              }

              if (e.ctrlKey || e.metaKey) {
                toggleItemSelection(f.name)
                return
              }

              selectSingleItem(f.name)
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

                selectSingleItem(f.name)

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
              style={{ ...iconBtn, display: "none" }}
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
                <button
                  style={menuButtonStyle}
                  onClick={() => {
                    clearTransientChrome()
                    if (f.is_dir) {
                      const next = path + (path.endsWith("/") ? "" : "/") + f.name
                      void load(next)
                    } else {
                      void openEditor(f)
                    }
                  }}
                >
                  {f.is_dir ? (lang === "de" ? "Öffnen" : "Open") : t("edit", lang)}
                </button>
                {!f.is_dir && (
                  <button
                    style={menuButtonStyle}
                    onClick={() => {
                      clearTransientChrome()
                      void download(f)
                    }}
                  >
                    {t("download", lang)}
                  </button>
                )}
                <button
                  style={menuButtonStyle}
                  onClick={() => {
                    clearTransientChrome()
                    setRenameItem(f)
                    setRenameValue(f.name)
                  }}
                >
                  {t("rename", lang)}
                </button>
                <button
                  style={{ ...menuButtonStyle, color: "var(--danger, #ef4444)" }}
                  onClick={() => {
                    clearTransientChrome()
                    setDeleteItems([f])
                  }}
                >
                  {t("delete", lang)}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showStatusBar && (
        <div
          style={{
            minHeight: 28,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            borderTop: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
            background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))",
            fontSize: 11,
            color: "var(--text-muted, #94a3b8)",
            flexShrink: 0
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            <span>{visibleStatusText}</span>
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {selectedStatusText ? <span>{selectedStatusText}</span> : null}
          </div>
        </div>
      )}

      {contextMenuItem && (() => {
        const entry = visibleFiles.find((f) => f.name === contextMenuItem)
        if (!entry) return null

        return (
          <div
            data-sftp-context-menu="true"
            style={contextMenuStyle || {
              position: "absolute",
              left: 8,
              top: 8,
              width: 156,
              minWidth: 156,
              borderRadius: 10,
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              background: "var(--bg-app, #020617)",
              boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
              overflow: "hidden",
              zIndex: 80
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={menuButtonStyle}
              onClick={() => {
                clearTransientChrome()
                if (entry.is_dir) {
                  const next = path + (path.endsWith("/") ? "" : "/") + entry.name
                  void load(next)
                } else {
                  void openEditor(entry)
                }
              }}
            >
              {entry.is_dir ? (lang === "de" ? "Öffnen" : "Open") : t("edit", lang)}
            </button>
            {!entry.is_dir && (
              <button
                style={menuButtonStyle}
                onClick={() => {
                  clearTransientChrome()
                  void download(entry)
                }}
              >
                {t("download", lang)}
              </button>
            )}
            <button
              style={menuButtonStyle}
              onClick={() => {
                clearTransientChrome()
                setRenameItem(entry)
                setRenameValue(entry.name)
              }}
            >
              {t("rename", lang)}
            </button>
            <button
              style={{ ...menuButtonStyle, color: "var(--danger, #ef4444)" }}
              onClick={() => {
                clearTransientChrome()
                setDeleteItems([entry])
              }}
            >
              {t("delete", lang)}
            </button>
          </div>
        )
      })()}

      {selectionMenuOpen && (
        <div
          data-sftp-context-menu="true"
          style={selectionMenuStyle || {
            position: "absolute",
            left: 8,
            top: 8,
            width: 176,
            minWidth: 176,
            borderRadius: 10,
            border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
            background: "var(--bg-app, #020617)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
            overflow: "hidden",
            zIndex: 80
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {allSelectedEntriesAreFiles && (
            <button
              style={menuButtonStyle}
              onClick={() => {
                clearTransientChrome()
                void downloadSelected()
              }}
            >
              {lang === "de" ? "Auswahl herunterladen" : "Download selected"}
            </button>
          )}

          {selectedVisibleEntries.length > 0 && (
            <button
              style={{ ...menuButtonStyle, color: "var(--danger, #ef4444)" }}
              onClick={() => {
                clearTransientChrome()
                openDeleteSelection()
              }}
            >
              {lang === "de" ? "Auswahl löschen" : "Delete selected"}
            </button>
          )}
        </div>
      )}

      {browserMenuOpen && (
        <div
          data-sftp-context-menu="true"
          style={browserMenuStyle || {
            position: "absolute",
            left: 8,
            top: 8,
            width: 176,
            minWidth: 176,
            borderRadius: 10,
            border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
            background: "var(--bg-app, #020617)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
            overflow: "hidden",
            zIndex: 80
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={menuButtonStyle}
            onClick={() => {
              clearTransientChrome()
              void upload()
            }}
          >
            {t("upload", lang)}
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              clearTransientChrome()
              setNewFolderOpen(true)
            }}
          >
            {t("newFolder", lang)}
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              clearTransientChrome()
              void load(path)
            }}
          >
            {t("refresh", lang)}
          </button>
          <button
            style={menuButtonStyle}
            onClick={() => {
              setShowHidden((prev) => !prev)
              clearTransientChrome()
            }}
          >
            {showHidden ? (lang === "de" ? "Versteckte ausblenden" : "Hide hidden files") : (lang === "de" ? "Versteckte anzeigen" : "Show hidden files")}
          </button>
        </div>
      )}

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

      {deleteItems.length > 0 && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{t("deleteTitle", lang)}</div>
            {deleteItems.length === 1 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)", marginBottom: 12 }}>
                {t("deleteText", lang).replace("{name}", deleteItems[0].name)}
              </div>
            ) : (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))"
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main, #e5e7eb)", marginBottom: 4 }}>
                  {deleteSummaryPrimary}
                </div>
                {deleteSummarySecondary ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)" }}>
                    {deleteSummarySecondary}
                  </div>
                ) : null}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={modalBtn} onClick={() => setDeleteItems([])}>{t("cancel", lang)}</button>
              <button style={modalBtn} onClick={doDelete}>{t("delete", lang)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
