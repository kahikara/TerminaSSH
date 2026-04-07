import React, { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"
import { RotateCcw, Save, X, Search, Replace, List, Minus, Square } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { t } from "../lib/i18n"
import InputContextMenu from "./InputContextMenu"
import { useInputContextMenu } from "../hooks/useInputContextMenu"

function qp(name: string) {
  return new URLSearchParams(window.location.search).get(name) || ""
}

type EditorStatus = "idle" | "saved" | "modified"
type PendingAction = null | "reload" | "close"
type ReadOnlyReason = "" | "binary" | "invalid-utf8"

const EDITOR_FONT_SIZE = 13
const EDITOR_LINE_HEIGHT = 1.45
const EDITOR_PADDING_Y = 16
const EDITOR_PADDING_X = 16
const SFTP_EDITOR_WINDOW_STATE_KEY = "termina_sftp_editor_window_state"

type CursorInfo = {
  line: number
  column: number
  lines: number
  chars: number
}

type BinaryCheckResult = {
  isBinary: boolean
  reason: string
}

type SftpReadFilePayload = {
  content_base64?: string
  contentBase64?: string
}

type StoredEditorWindowState = {
  width?: number
  height?: number
  maximized?: boolean
}

type EditorStateMessage = {
  type: "editor-state"
  label: string
  fileName: string
  remotePath: string
  dirty: boolean
}

type EditorClosedMessage = {
  type: "editor-closed"
  label: string
}

type MainRequestCloseEditorsMessage = {
  type: "main-request-close-editors"
  force: boolean
}

function isMainRequestCloseEditorsMessage(value: unknown): value is MainRequestCloseEditorsMessage {
  if (!value || typeof value !== "object") return false

  const raw = value as Record<string, unknown>
  return raw.type === "main-request-close-editors" && typeof raw.force === "boolean"
}

function readStoredEditorWindowState(): StoredEditorWindowState {
  try {
    const raw = localStorage.getItem(SFTP_EDITOR_WINDOW_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)

    return {
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
      maximized: Boolean(parsed?.maximized)
    }
  } catch {
    return {}
  }
}

function persistEditorWindowState(patch: StoredEditorWindowState) {
  try {
    const current = readStoredEditorWindowState()
    localStorage.setItem(
      SFTP_EDITOR_WINDOW_STATE_KEY,
      JSON.stringify({ ...current, ...patch })
    )
  } catch {}
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function utf8ToBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return btoa(binary)
}

function detectBinaryContent(text: string): BinaryCheckResult {
  if (!text) {
    return { isBinary: false, reason: "" }
  }

  const sample = text.slice(0, 200000)

  let nullBytes = 0
  let replacementChars = 0
  let suspiciousControls = 0

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)

    if (code === 0) {
      nullBytes++
      continue
    }

    if (code === 0xfffd) {
      replacementChars++
      continue
    }

    const isAllowedControl =
      code === 9 || code === 10 || code === 13

    if (!isAllowedControl && code < 32) {
      suspiciousControls++
    }
  }

  const len = sample.length || 1
  const replacementRatio = replacementChars / len
  const controlRatio = suspiciousControls / len

  if (nullBytes > 0) {
    return { isBinary: true, reason: "null-bytes" }
  }

  if (replacementChars >= 8 && replacementRatio > 0.002) {
    return { isBinary: true, reason: "replacement-chars" }
  }

  if (suspiciousControls >= 12 && controlRatio > 0.01) {
    return { isBinary: true, reason: "control-chars" }
  }

  return { isBinary: false, reason: "" }
}

function getCursorInfo(text: string, cursor: number): CursorInfo {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  const before = text.slice(0, safeCursor)
  const line = before.split("\n").length
  const lastBreak = before.lastIndexOf("\n")
  const column = safeCursor - lastBreak

  return {
    line,
    column,
    lines: text ? text.split("\n").length : 1,
    chars: text.length
  }
}

function countOccurrences(text: string, query: string) {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let idx = 0
  let count = 0

  while (true) {
    idx = haystack.indexOf(needle, idx)
    if (idx === -1) break
    count++
    idx += needle.length
  }

  return count
}

function getLineColAtIndex(text: string, index: number) {
  const safeIndex = Math.max(0, Math.min(index, text.length))
  const before = text.slice(0, safeIndex)
  const line = before.split("\n").length
  const lastBreak = before.lastIndexOf("\n")
  const col = safeIndex - lastBreak
  return { line, col }
}

function normalizeEditorPasteText(text: string) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export default function SftpEditorWindow() {
  const editorMode = useMemo(() => qp("editor") || "sftp", [])
  const isLocalEditor = editorMode === "local"
  const serverId = useMemo(() => Number(qp("serverId")), [])
  const remotePath = useMemo(() => qp("path"), [])
  const fileName = useMemo(() => qp("file"), [])
  const windowLabel = useMemo(() => getCurrentWindow().label, [])

  const initialSettings = useMemo(() => {
    try {
      const raw = localStorage.getItem("termina_settings")
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }, [])

  const lang = initialSettings?.lang || "de"
  const { inputMenu, runInputMenuAction, closeInputMenu } = useInputContextMenu({ lang })
  const themeName = String(initialSettings?.theme || "catppuccin")
  const isLightTheme = themeName === "light"

  const [useCustomWindowChrome, setUseCustomWindowChrome] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  const [content, setContent] = useState("")
  const [original, setOriginal] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<EditorStatus>("idle")
  const [errorText, setErrorText] = useState("")
  const [largeFileNotice, setLargeFileNotice] = useState("")
  const [utf8Unsafe, setUtf8Unsafe] = useState(false)
  const [editorReadOnlyReason, setEditorReadOnlyReason] = useState<ReadOnlyReason>("")
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [cursorInfo, setCursorInfo] = useState<CursorInfo>({
    line: 1,
    column: 1,
    lines: 1,
    chars: 0
  })

  const [searchOpen, setSearchOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [replaceText, setReplaceText] = useState("")
  const [searchInfo, setSearchInfo] = useState("")

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [binaryPromptOpen, setBinaryPromptOpen] = useState(false)
  const [binaryPromptText, setBinaryPromptText] = useState("")
  const [pendingBinaryText, setPendingBinaryText] = useState<string | null>(null)
  const [pendingBinaryReason, setPendingBinaryReason] = useState<ReadOnlyReason>("")

  const dirtyRef = useRef(false)
  const closingRef = useRef(false)
  const confirmOpenRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef("")
  const originalRef = useRef("")
  const channelRef = useRef<BroadcastChannel | null>(null)
  const uiTimerRef = useRef<number | null>(null)
  const loadSeqRef = useRef(0)

  async function applyTheme() {
    try {
      const saved = localStorage.getItem("termina_settings")
      if (!saved) return
      const settings = JSON.parse(saved)
      if (settings?.theme) {
        document.documentElement.setAttribute("data-theme", settings.theme)
      }
    } catch (e) {
      console.error(e)
    }
  }

  function replaceUiTimer(callback: () => void) {
    if (uiTimerRef.current !== null) {
      clearTimeout(uiTimerRef.current)
      uiTimerRef.current = null
    }

    uiTimerRef.current = window.setTimeout(() => {
      uiTimerRef.current = null
      callback()
    }, 0)
  }

  function updateCursor() {
    const ta = textareaRef.current
    if (!ta) {
      setCursorInfo(getCursorInfo(contentRef.current, 0))
      return
    }
    setCursorInfo(getCursorInfo(contentRef.current, ta.selectionStart || 0))
  }

  function syncGutterScroll() {
    const ta = textareaRef.current
    const gutter = gutterRef.current
    if (!ta || !gutter) return
    gutter.scrollTop = ta.scrollTop
  }

  function handleGutterWheel(e: React.WheelEvent<HTMLDivElement>) {
    const ta = textareaRef.current
    if (!ta) return

    e.preventDefault()
    ta.scrollTop += e.deltaY
    ta.scrollLeft += e.deltaX
    syncGutterScroll()
  }

  function setEditorContent(next: string) {
    contentRef.current = next
    setContent(next)
    dirtyRef.current = next !== originalRef.current
  }

  function setEditorOriginal(next: string) {
    originalRef.current = next
    setOriginal(next)
    dirtyRef.current = contentRef.current !== next
  }

  function showError(message: string, error: unknown) {
    console.error(message, error)
    const detail = error instanceof Error ? error.message : String(error)
    setErrorText(`${message}${detail ? ` ${detail}` : ""}`)
  }

  async function syncWindowChromeState() {
    let isWaylandUndecorated = false

    try {
      const linuxWindowMode = await invoke("get_linux_window_mode")
        .catch(() => ({ wayland_undecorated: false })) as { wayland_undecorated?: boolean }

      isWaylandUndecorated = Boolean(linuxWindowMode?.wayland_undecorated)
      setUseCustomWindowChrome(isWaylandUndecorated)
    } catch {
      setUseCustomWindowChrome(false)
    }

    try {
      const maximized = await invoke("current_window_is_maximized") as boolean
      setIsWindowMaximized(Boolean(maximized))
      persistEditorWindowState({ maximized: Boolean(maximized) })

      if (!isWaylandUndecorated && !maximized) {
        persistEditorWindowState({
          width: window.innerWidth,
          height: window.innerHeight
        })
      }
    } catch {}
  }

  function startWindowDrag() {
    void invoke("current_window_start_dragging").catch((e) => {
      console.error("editor drag failed", e)
    })
  }

  async function copySelectedText() {
    const ta = textareaRef.current
    if (!ta) return

    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    if (end <= start) return

    const selected = contentRef.current.slice(start, end)
    if (!selected) return

    await writeText(selected)
  }

  function insertPastedText(rawText: string) {
    const ta = textareaRef.current
    if (!ta) return
    if (editorReadOnlyReason) return

    const normalized = normalizeEditorPasteText(rawText)
    if (!normalized) return

    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0

    const next =
      contentRef.current.slice(0, start) +
      normalized +
      contentRef.current.slice(end)

    setEditorContent(next)

    setTimeout(() => {
      const pos = start + normalized.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
      updateCursor()
      syncGutterScroll()
      evaluateLargeFileNotice(next)
    }, 0)
  }


  function replaceEditorSelection(nextText: string) {
    const ta = textareaRef.current
    if (!ta) return

    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0

    const next =
      contentRef.current.slice(0, start) +
      nextText +
      contentRef.current.slice(end)

    setEditorContent(next)

    setTimeout(() => {
      const pos = start + nextText.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
      updateCursor()
      syncGutterScroll()
      evaluateLargeFileNotice(next)
    }, 0)
  }

  async function pasteFromClipboard() {
    const clip = await readText()
    if (!clip) return
    insertPastedText(clip)
  }

  function publishEditorState() {
    const message: EditorStateMessage = {
      type: "editor-state",
      label: windowLabel,
      fileName,
      remotePath,
      dirty: dirtyRef.current
    }

    channelRef.current?.postMessage(message)
  }

  function publishEditorClosed() {
    const message: EditorClosedMessage = {
      type: "editor-closed",
      label: windowLabel
    }

    channelRef.current?.postMessage(message)
  }

  function evaluateLargeFileNotice(text: string) {
    const chars = text.length
    const lines = text ? text.split("\n").length : 1
    const isVeryLarge = chars >= 500000 || lines >= 12000
    const isLarge = chars >= 200000 || lines >= 5000

    if (isVeryLarge) {
      setLargeFileNotice(t("largeFileDetected", lang))
      setShowLineNumbers(false)
      return
    }

    if (isLarge) {
      setLargeFileNotice(t("largeFileHint", lang))
      setShowLineNumbers(false)
      return
    }

    setLargeFileNotice("")
  }

  async function loadFile(force = false) {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    try {
      if (!force && dirtyRef.current) {
        openConfirm("reload", t("unsavedChangesLostReload", lang))
        return
      }

      closeBinaryPrompt()
      setErrorText("")
      setLoading(true)
      setUtf8Unsafe(false)
      setEditorReadOnlyReason("")

      const payload = await invoke(
        isLocalEditor ? "local_read_file" : "sftp_read_file",
        isLocalEditor
          ? { path: remotePath }
          : { id: serverId, path: remotePath }
      ) as SftpReadFilePayload

      const contentBase64 = String(payload?.content_base64 || payload?.contentBase64 || "")
      const bytes = base64ToBytes(contentBase64)

      let text = ""
      let utf8Valid = true

      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      } catch {
        utf8Valid = false
        text = new TextDecoder("utf-8").decode(bytes)
      }

      setUtf8Unsafe(!utf8Valid)

      const binaryCheck = detectBinaryContent(text)

      if (loadSeqRef.current !== seq) return

      if (!utf8Valid) {
        openBinaryPrompt(text, "invalid-utf8")
        setStatus("idle")
        setSearchInfo("")
        setCursorInfo(getCursorInfo("", 0))
        evaluateLargeFileNotice("")
        return
      }

      if (binaryCheck.isBinary) {
        openBinaryPrompt(text, binaryCheck.reason)
        setStatus("idle")
        setSearchInfo("")
        setCursorInfo(getCursorInfo("", 0))
        evaluateLargeFileNotice("")
        return
      }

      setEditorContent(text)
      setEditorOriginal(text)
      setStatus("idle")
      setSearchInfo("")
      setCursorInfo(getCursorInfo(text, 0))
      evaluateLargeFileNotice(text)
    } catch (e) {
      if (loadSeqRef.current !== seq) return
      showError(t("failedToLoadFile", lang), e)
    } finally {
      if (loadSeqRef.current !== seq) return
      setLoading(false)
      setTimeout(() => {
        updateCursor()
        syncGutterScroll()
      }, 0)
    }
  }

  async function saveFile() {
    try {
      const nextContent = contentRef.current

      if (editorReadOnlyReason === "invalid-utf8") {
        setErrorText(
          lang === "de"
            ? "Diese Datei enthält ungültiges UTF 8 und ist deshalb nur lesbar geöffnet. Speichern bleibt gesperrt, damit keine Daten beschädigt werden."
            : "This file contains invalid UTF 8 and was opened as read only. Saving stays blocked to avoid corrupting the file."
        )
        return
      }

      if (editorReadOnlyReason === "binary") {
        setErrorText(
          lang === "de"
            ? "Diese Datei wurde als potenziell binär erkannt und deshalb nur lesbar geöffnet. Speichern bleibt gesperrt."
            : "This file was detected as potentially binary and opened as read only. Saving stays blocked."
        )
        return
      }

      if (utf8Unsafe) {
        setErrorText(
          lang === "de"
            ? "Diese Datei ist kein sauberes UTF 8. Speichern ist blockiert, damit keine Daten beschädigt werden."
            : "This file is not valid UTF 8. Saving is blocked to avoid corrupting the file."
        )
        return
      }

      setErrorText("")
      setSaving(true)

      await invoke(
        isLocalEditor ? "local_write_file" : "sftp_write_file",
        isLocalEditor
          ? {
              path: remotePath,
              contentBase64: utf8ToBase64(nextContent)
            }
          : {
              id: serverId,
              path: remotePath,
              contentBase64: utf8ToBase64(nextContent)
            }
      )

      setEditorOriginal(nextContent)
      setStatus("saved")
      publishEditorState()
    } catch (e) {
      showError(t("failedToSaveFile", lang), e)
    } finally {
      setSaving(false)
    }
  }

  function openSearchOnly() {
    if (searchOpen && !replaceOpen) {
      closeSearchAndReplace()
      return
    }

    setSearchOpen(true)
    setReplaceOpen(false)
    replaceUiTimer(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }

  function toggleReplace() {
    if (replaceOpen) {
      setReplaceOpen(false)
      setSearchOpen(true)
      replaceUiTimer(() => {
        searchInputRef.current?.focus()
      })
      return
    }

    setSearchOpen(true)
    setReplaceOpen(true)
    replaceUiTimer(() => {
      replaceInputRef.current?.focus()
      replaceInputRef.current?.select()
    })
  }

  function closeSearchAndReplace() {
    setSearchOpen(false)
    setReplaceOpen(false)
    setSearchInfo("")
    replaceUiTimer(() => {
      textareaRef.current?.focus()
    })
  }

  function findNext(backwards = false) {
    const ta = textareaRef.current
    if (!ta) return
    const query = searchText
    if (!query) {
      setSearchInfo("")
      return
    }

    const text = ta.value
    const haystack = text.toLowerCase()
    const needle = query.toLowerCase()

    let start = backwards ? ta.selectionStart - 1 : ta.selectionEnd
    if (start < 0) start = 0

    let idx = -1

    if (backwards) {
      idx = haystack.lastIndexOf(needle, start)
      if (idx === -1) idx = haystack.lastIndexOf(needle)
    } else {
      idx = haystack.indexOf(needle, start)
      if (idx === -1) idx = haystack.indexOf(needle)
    }

    if (idx === -1) {
      setSearchInfo(t("noMatch", lang))
      return
    }

    ta.focus()
    ta.setSelectionRange(idx, idx + query.length)
    const pos = getLineColAtIndex(text, idx)
    setSearchInfo(
      t("matchAtLineCol", lang)
        .replace("{line}", String(pos.line))
        .replace("{col}", String(pos.col))
    )
    setTimeout(updateCursor, 0)
  }

  function replaceCurrent() {
    const ta = textareaRef.current
    const query = searchText
    if (!ta || !query) return

    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = contentRef.current.slice(start, end)

    if (selected.toLowerCase() !== query.toLowerCase()) {
      findNext(false)
      return
    }

    const next =
      contentRef.current.slice(0, start) +
      replaceText +
      contentRef.current.slice(end)

    setEditorContent(next)
    setSearchInfo(t("replacedOneMatch", lang))

    setTimeout(() => {
      const newPos = start + replaceText.length
      ta.focus()
      ta.setSelectionRange(start, newPos)
      updateCursor()
      syncGutterScroll()
      evaluateLargeFileNotice(next)
    }, 0)
  }

  function replaceAll() {
    const query = searchText
    if (!query) return

    const source = contentRef.current
    const count = countOccurrences(source, query)
    if (count === 0) {
      setSearchInfo(t("noMatch", lang))
      return
    }

    const next = source.replace(new RegExp(escapeRegExp(query), "gi"), replaceText)

    setEditorContent(next)
    setSearchInfo(t("replacedManyMatches", lang).replace("{count}", String(count)))
    evaluateLargeFileNotice(next)

    setTimeout(() => {
      textareaRef.current?.focus()
      updateCursor()
      syncGutterScroll()
    }, 0)
  }

  function openConfirm(action: PendingAction, text: string) {
    if (confirmOpenRef.current) return
    setPendingAction(action)
    setConfirmText(text)
    setConfirmOpen(true)
    confirmOpenRef.current = true
  }

  function closeConfirm() {
    setConfirmOpen(false)
    setConfirmText("")
    setPendingAction(null)
    confirmOpenRef.current = false
  }

  function openBinaryPrompt(text: string, reason: string) {
    setPendingBinaryText(text)
    setPendingBinaryReason(reason === "invalid-utf8" ? "invalid-utf8" : "binary")
    setBinaryPromptText(
      reason === "null-bytes"
        ? (
            lang === "de"
              ? "Diese Datei enthält Null Bytes und wirkt nicht wie normaler Text. Du kannst sie zur Ansicht öffnen, sie bleibt dann aber nur lesbar."
              : "This file contains null bytes and does not look like normal text. You can open it for inspection, but it will stay read only."
          )
        : reason === "invalid-utf8"
          ? (
              lang === "de"
                ? "Die Datei enthält ungültiges UTF 8. Du kannst sie ansehen, sie wird aber nur lesbar geöffnet und Speichern bleibt gesperrt, damit keine Daten beschädigt werden."
                : "The file contains invalid UTF 8. You can view it, but it will open as read only and saving stays blocked to avoid corrupting the file."
            )
          : (
              lang === "de"
                ? "Diese Datei wirkt nicht wie normaler Text. Du kannst sie zur Ansicht öffnen, sie bleibt dann aber nur lesbar."
                : "This file does not look like normal text. You can open it for inspection, but it will stay read only."
            )
    )
    setBinaryPromptOpen(true)
  }

  function closeBinaryPrompt() {
    setBinaryPromptOpen(false)
    setBinaryPromptText("")
    setPendingBinaryText(null)
    setPendingBinaryReason("")
  }

  function confirmBinaryOpen() {
    const text = pendingBinaryText
    const reason = pendingBinaryReason
    closeBinaryPrompt()

    if (text == null) return

    setEditorReadOnlyReason(reason || "binary")
    setEditorContent(text)
    setEditorOriginal(text)
    setStatus("idle")
    setSearchInfo("")
    setCursorInfo(getCursorInfo(text, 0))
    evaluateLargeFileNotice(text)

    setTimeout(() => {
      updateCursor()
      syncGutterScroll()
    }, 0)
  }

  async function reallyClose() {
    if (closingRef.current) return
    closingRef.current = true
    try {
      publishEditorClosed()
      const win = getCurrentWindow()
      await win.close()
    } catch (e) {
      showError(t("failedToCloseEditor", lang), e)
      closingRef.current = false
    }
  }

  function requestClose() {
    if (closingRef.current) return
    if (dirtyRef.current) {
      openConfirm("close", t("discardUnsavedChanges", lang))
      return
    }
    void reallyClose()
  }

  async function confirmYes() {
    const action = pendingAction
    closeConfirm()

    if (action === "reload") {
      await loadFile(true)
      return
    }

    if (action === "close") {
      await reallyClose()
    }
  }


  async function handleEditorInputMenuAction(action: "copy" | "paste" | "cut" | "selectAll") {
    const target = inputMenu.target
    const ta = textareaRef.current

    if (!target || !ta || target !== ta) {
      await runInputMenuAction(action)
      return
    }

    try {
      ta.focus()

      if (action === "selectAll") {
        ta.select()
        return
      }

      if (action === "copy") {
        await copySelectedText()
        return
      }

      if (action === "paste") {
        await pasteFromClipboard()
        return
      }

      if (action === "cut") {
        if (editorReadOnlyReason) return

        const start = ta.selectionStart ?? 0
        const end = ta.selectionEnd ?? 0
        if (end <= start) return

        const selected = contentRef.current.slice(start, end)
        if (!selected) return

        await writeText(selected)
        replaceEditorSelection("")
      }
    } finally {
      closeInputMenu()
    }
  }

  useEffect(() => {
    applyTheme()
    void loadFile(true)
  }, [])

  useEffect(() => {
    return () => {
      if (uiTimerRef.current !== null) {
        clearTimeout(uiTimerRef.current)
        uiTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    void syncWindowChromeState()

    const onResize = () => {
      void syncWindowChromeState()
    }

    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
    }
  }, [])

  useEffect(() => {
    const channel = new BroadcastChannel("termina-editor-sync")
    channelRef.current = channel

    channel.onmessage = (event) => {
      const msg = event.data
      if (!isMainRequestCloseEditorsMessage(msg)) return

      if (msg.force) {
        void reallyClose()
        return
      }

      requestClose()
    }

    publishEditorState()

    return () => {
      publishEditorClosed()
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    contentRef.current = content
    originalRef.current = original
    dirtyRef.current = content !== original

    if (!loading) {
      if (content !== original) {
        setStatus("modified")
      } else if (status === "modified") {
        setStatus("idle")
      }
    }

    publishEditorState()
  }, [content, original, loading, status])

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined

    win.onCloseRequested(async (event) => {
      if (closingRef.current) return

      event.preventDefault()

      if (confirmOpenRef.current) return

      if (dirtyRef.current) {
        openConfirm("close", t("discardUnsavedChanges", lang))
        return
      }

      await reallyClose()
    }).then((fn) => {
      unlisten = fn
    }).catch(console.error)

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === "f") {
        e.preventDefault()
        e.stopPropagation()
        openSearchOnly()
        return
      }

      if (mod && key === "h") {
        e.preventDefault()
        e.stopPropagation()
        toggleReplace()
        return
      }

      if (mod && key === "l") {
        e.preventDefault()
        e.stopPropagation()
        setShowLineNumbers((prev) => !prev)
        return
      }

      if (mod && e.shiftKey && key === "c") {
        e.preventDefault()
        e.stopPropagation()
        void copySelectedText().catch(console.error)
        return
      }

      if (mod && key === "v") {
        e.preventDefault()
        e.stopPropagation()
        void pasteFromClipboard().catch(console.error)
        return
      }

      if (mod && e.shiftKey && key === "v") {
        e.preventDefault()
        e.stopPropagation()
        void pasteFromClipboard().catch(console.error)
        return
      }

      if (!mod && e.shiftKey && key === "insert") {
        e.preventDefault()
        e.stopPropagation()
        void pasteFromClipboard().catch(console.error)
        return
      }

      if (mod && key === "s") {
        e.preventDefault()
        e.stopPropagation()
        if (!loading && !saving) {
          void saveFile()
        }
        return
      }

      if (mod && key === "w") {
        e.preventDefault()
        e.stopPropagation()
        requestClose()
        return
      }

      if (e.key === "Escape") {
        if (binaryPromptOpen) {
          e.preventDefault()
          e.stopPropagation()
          closeBinaryPrompt()
          return
        }
        if (confirmOpen) {
          e.preventDefault()
          e.stopPropagation()
          closeConfirm()
          return
        }
        if (searchOpen || replaceOpen) {
          e.preventDefault()
          e.stopPropagation()
          closeSearchAndReplace()
          return
        }
      }

      if (searchOpen && e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        findNext(e.shiftKey)
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [searchOpen, replaceOpen, searchText, confirmOpen, binaryPromptOpen, loading, saving])

  const lineNumbers = useMemo(() => {
    return Array.from({ length: Math.max(cursorInfo.lines, 1) }, (_, i) => i + 1)
  }, [cursorInfo.lines])

  const gutterWidth = useMemo(() => {
    const digits = String(Math.max(cursorInfo.lines, 1)).length
    return Math.max(36, 20 + digits * 8)
  }, [cursorInfo.lines])

  const readOnlyBadge =
    editorReadOnlyReason === "invalid-utf8"
      ? (lang === "de" ? "Nur lesen · Ungültiges UTF 8" : "Read only · Invalid UTF 8")
      : editorReadOnlyReason === "binary"
        ? (lang === "de" ? "Nur lesen · Binär oder unsicher" : "Read only · Binary or unsafe")
        : ""

  const readOnlyNotice =
    editorReadOnlyReason === "invalid-utf8"
      ? (
          lang === "de"
            ? "Diese Datei wurde nur lesbar geöffnet, weil sie ungültiges UTF 8 enthält. Speichern bleibt gesperrt, damit keine Daten beschädigt werden."
            : "This file was opened as read only because it contains invalid UTF 8. Saving stays blocked to avoid corrupting the file."
        )
      : editorReadOnlyReason === "binary"
        ? (
            lang === "de"
              ? "Diese Datei wurde nur lesbar geöffnet, weil sie nicht wie normaler Text wirkt. Speichern bleibt vorsorglich gesperrt."
              : "This file was opened as read only because it does not look like normal text. Saving stays blocked as a safety measure."
          )
        : ""

  const editorRootBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-app) 96%, white)"
    : "color-mix(in srgb, var(--bg-app, #020617) 80%, #4a4d52)"

  const editorChromeBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-sidebar) 86%, white)"
    : "color-mix(in srgb, var(--bg-sidebar, #111827) 72%, #565a61)"

  const editorHeaderBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-sidebar) 90%, white)"
    : "color-mix(in srgb, var(--bg-sidebar, #111827) 76%, #4e535a)"

  const editorSearchBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-app) 92%, var(--bg-sidebar))"
    : "color-mix(in srgb, var(--bg-app, #020617) 78%, #4c5057)"

  const editorGutterBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-sidebar) 82%, white)"
    : "color-mix(in srgb, var(--bg-sidebar, #0f172a) 72%, #50545b)"

  const editorTextareaBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-app) 98%, white)"
    : "color-mix(in srgb, var(--bg-app, #020617) 74%, #3b3f45)"

  const editorFooterBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-sidebar) 90%, white)"
    : "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"

  const editorDialogBackground = isLightTheme
    ? "color-mix(in srgb, var(--bg-app) 96%, white)"
    : "color-mix(in srgb, var(--bg-app) 92%, black)"

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: editorRootBackground,
        color: "var(--text-main, #e5e7eb)",
        position: "relative",
        boxSizing: "border-box",
        border: useCustomWindowChrome
          ? "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 88%, transparent)"
          : undefined,
        boxShadow: useCustomWindowChrome
          ? "0 0 0 1px rgba(255,255,255,0.02) inset"
          : undefined
      }}
    >
      <div
        data-tauri-drag-region
        onDoubleClick={(e) => {
          if (!useCustomWindowChrome) return
          if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return
          e.preventDefault()
          e.stopPropagation()
          void (async () => {
            try {
              const maximized = await invoke("current_window_toggle_maximize") as boolean
              setIsWindowMaximized(Boolean(maximized))
              persistEditorWindowState({ maximized: Boolean(maximized) })
            } catch (err) {
              console.error("editor titlebar double click maximize failed", err)
            }
          })()
        }}
        onMouseDown={(e) => {
          if (!useCustomWindowChrome) return
          if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return
          if (e.detail > 1) return
          startWindowDrag()
        }}
        style={{
          minHeight: 30,
          height: 30,
          padding: "0 4px 0 8px",
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: editorChromeBackground,
          userSelect: "none",
          cursor: useCustomWindowChrome ? "grab" : "default"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <img
            src="/app-icon.svg"
            alt="logo"
            style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }}
            onError={(e) => {
              const target = e.currentTarget
              target.style.display = "none"
            }}
          />
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-main, #e5e7eb)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            Termina SSH · {fileName || (isLocalEditor ? (lang === "de" ? "Lokaler Editor" : "Local Editor") : "Editor")}
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted, #94a3b8)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
            minWidth: 0,
            flex: 1,
            marginLeft: 10
          }}
        >
          {loading
            ? t("loading", lang)
            : status === "saved"
              ? t("savedState", lang)
              : status === "modified"
                ? t("unsavedChanges", lang)
                : t("ready", lang)}
          {readOnlyBadge ? ` · ${readOnlyBadge}` : ""}
        </div>

        {useCustomWindowChrome && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <button
              data-window-control="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                void invoke("current_window_minimize").catch((e) => {
                  console.error("editor minimize failed", e)
                })
              }}
              className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              title={lang === "de" ? "Minimieren" : "Minimize"}
            >
              <Minus size={11} />
            </button>

            <button
              data-window-control="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                void (async () => {
                  try {
                    const maximized = await invoke("current_window_toggle_maximize") as boolean
                    setIsWindowMaximized(Boolean(maximized))
                    persistEditorWindowState({ maximized: Boolean(maximized) })
                  } catch (e) {
                    console.error("editor maximize toggle failed", e)
                  }
                })()
              }}
              className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              title={isWindowMaximized
                ? (lang === "de" ? "Wiederherstellen" : "Restore")
                : (lang === "de" ? "Maximieren" : "Maximize")}
            >
              <Square size={9.5} className={isWindowMaximized ? "scale-90" : ""} />
            </button>

            <button
              data-window-control="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={requestClose}
              className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:bg-[var(--danger)] hover:text-white transition-colors shrink-0"
              title={lang === "de" ? "Schließen" : "Close"}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          minHeight: 52,
          padding: "0 14px",
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: editorHeaderBackground
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.25,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {fileName || (isLocalEditor ? (lang === "de" ? "Lokale Datei" : "Local file") : "")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
            {remotePath}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={btn} onClick={openSearchOnly}>
            <Search size={14} />
            <span>{t("search", lang)}</span>
          </button>
          <button style={btn} onClick={toggleReplace}>
            <Replace size={14} />
            <span>{replaceOpen ? t("hideReplace", lang) : t("replace", lang)}</span>
          </button>
          <button style={btn} onClick={() => setShowLineNumbers((prev) => !prev)}>
            <List size={14} />
            <span>{showLineNumbers ? t("hideLines", lang) : t("showLines", lang)}</span>
          </button>
          <button style={btn} onClick={() => void loadFile(false)} disabled={loading || saving}>
            <RotateCcw size={14} />
            <span>{t("refresh", lang)}</span>
          </button>
          <button style={btn} onClick={() => void saveFile()} disabled={loading || saving || utf8Unsafe || Boolean(editorReadOnlyReason)}>
            <Save size={14} />
            <span>{saving ? t("save", lang) + "..." : t("save", lang)}</span>
          </button>
          <button style={btn} onClick={requestClose}>
            <X size={14} />
            <span>{t("close", lang)}</span>
          </button>
        </div>
      </div>

      {errorText && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(127,29,29,0.22)",
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
          <button style={btn} onClick={() => setErrorText("")}>{t("dismiss", lang)}</button>
        </div>
      )}

      {readOnlyNotice && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(245,158,11,0.25)",
            background: "rgba(120,53,15,0.18)",
            color: "#fde68a",
            fontSize: 12,
            lineHeight: 1.4
          }}
        >
          {readOnlyNotice}
        </div>
      )}

      {largeFileNotice && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(245,158,11,0.25)",
            background: "rgba(120,53,15,0.18)",
            color: "#fde68a",
            fontSize: 12,
            lineHeight: 1.4
          }}
        >
          {largeFileNotice}
        </div>
      )}

      {searchOpen && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
            background: editorSearchBackground,
            display: "flex",
            flexDirection: "column",
            gap: 8
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: replaceOpen
                ? "minmax(160px,1fr) minmax(160px,1fr) auto auto auto auto auto"
                : "minmax(220px,1fr) auto auto auto",
              alignItems: "center",
              gap: 8
            }}
          >
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value)
                setSearchInfo("")
              }}
              placeholder={t("search", lang)}
              style={inputStyle}
            />

            {replaceOpen && (
              <input
                ref={replaceInputRef}
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={t("replace", lang)}
                style={inputStyle}
              />
            )}

            <button style={compactBtn} onClick={() => findNext(true)}>{t("prev", lang)}</button>
            <button style={compactBtn} onClick={() => findNext(false)}>{t("next", lang)}</button>

            {replaceOpen && (
              <>
                <button style={compactBtn} onClick={replaceCurrent}>{t("replaceOne", lang)}</button>
                <button style={compactBtn} onClick={replaceAll}>{t("replaceAll", lang)}</button>
              </>
            )}

            <button style={compactBtn} onClick={closeSearchAndReplace}>{t("close", lang)}</button>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted, #94a3b8)",
              minHeight: 16,
              lineHeight: 1.35
            }}
          >
            {searchInfo}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {loading ? (
          <div style={{ padding: 16, fontSize: 12, color: "var(--text-muted, #94a3b8)" }}>
            {t("loading", lang)}
          </div>
        ) : (
          <>
            {showLineNumbers && (
              <div
                ref={gutterRef}
                onWheel={handleGutterWheel}
                style={{
                  width: gutterWidth,
                  overflow: "hidden",
                  borderRight: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
                  background: editorGutterBackground,
                  color: "var(--text-muted, #94a3b8)",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: EDITOR_FONT_SIZE,
                  lineHeight: EDITOR_LINE_HEIGHT,
                  padding: `${EDITOR_PADDING_Y}px 6px ${EDITOR_PADDING_Y}px 0`,
                  textAlign: "right",
                  userSelect: "none",
                  whiteSpace: "pre"
                }}
              >
                {lineNumbers.map((line) => (
                  <div
                    key={line}
                    style={{
                      color: line === cursorInfo.line ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              wrap="off"
              readOnly={Boolean(editorReadOnlyReason)}
              value={content}
              onPaste={(e) => {
                if (editorReadOnlyReason) return
                const pasted = e.clipboardData?.getData("text")
                if (typeof pasted !== "string" || pasted.length === 0) return
                e.preventDefault()
                insertPastedText(pasted)
              }}
              onChange={(e) => {
                setEditorContent(e.target.value)
                setTimeout(() => {
                  updateCursor()
                  syncGutterScroll()
                }, 0)
              }}
              onClick={() => setTimeout(updateCursor, 0)}
              onKeyUp={() => setTimeout(updateCursor, 0)}
              onSelect={() => setTimeout(updateCursor, 0)}
              onScroll={syncGutterScroll}
              spellCheck={false}
              style={{
                width: "100%",
                height: "100%",
                resize: "none",
                boxSizing: "border-box",
                border: "none",
                outline: "none",
                background: editorTextareaBackground,
                color: "var(--text-main, #e5e7eb)",
                padding: `${EDITOR_PADDING_Y}px ${EDITOR_PADDING_X}px`,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: EDITOR_FONT_SIZE,
                lineHeight: EDITOR_LINE_HEIGHT,
                whiteSpace: "pre",
                overflow: "auto"
              }}
            />
          </>
        )}
      </div>

      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
          background: editorFooterBackground,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 11,
          color: "var(--text-muted, #94a3b8)",
          flexWrap: "wrap"
        }}
      >
        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {remotePath}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap", flexWrap: "wrap" }}>
          <span>{status === "modified" ? t("dirty", lang) : status === "saved" ? t("savedState", lang) : t("ready", lang)}</span>
          {readOnlyBadge ? <span>{readOnlyBadge}</span> : null}
          <span>{t("utf8", lang)}</span>
          <span>Ln {cursorInfo.line}, Col {cursorInfo.column}</span>
          <span>{cursorInfo.lines} {t("lines", lang)}</span>
          <span>{cursorInfo.chars} {t("chars", lang)}</span>
          <span>{showLineNumbers ? t("linesOn", lang) : t("linesOff", lang)}</span>
        </div>
      </div>

      {binaryPromptOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 51,
            padding: 18
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: "100%",
              borderRadius: 16,
              border: "1px solid rgba(245,158,11,0.25)",
              background: editorDialogBackground,
              color: "var(--text-main, #e5e7eb)",
              boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
              padding: 16
            }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, marginBottom: 8 }}>
              {t("binaryFileDetectedTitle", lang)}
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text-muted, #94a3b8)", marginBottom: 14, whiteSpace: "pre-line" }}>
              {binaryPromptText}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                style={btn}
                onClick={() => {
                  closeBinaryPrompt()
                  requestClose()
                }}
              >
                {t("cancel", lang)}
              </button>
              <button
                style={{ ...btn, background: "var(--accent)", color: "black", border: "1px solid transparent" }}
                onClick={confirmBinaryOpen}
              >
                {lang === "de" ? "Nur lesbar öffnen" : "Open read only"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 18
          }}
        >
          <div
            style={{
              width: 360,
              maxWidth: "100%",
              borderRadius: 16,
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              background: editorDialogBackground,
              color: "var(--text-main, #e5e7eb)",
              boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
              padding: 16
            }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, marginBottom: 8 }}>
              {t("confirm", lang)}
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--text-muted, #94a3b8)", marginBottom: 14 }}>
              {confirmText}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={btn} onClick={closeConfirm}>
                {t("cancel", lang)}
              </button>
              <button style={{ ...btn, background: "var(--accent)", color: "black", border: "1px solid transparent" }} onClick={() => void confirmYes()}>
                {t("ok", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      <InputContextMenu
        inputMenu={inputMenu}
        lang={lang}
        onAction={handleEditorInputMenuAction}
        extraActions={[
          {
            key: "editor-search",
            label: t("search", lang),
            onClick: () => {
              closeInputMenu()
              openSearchOnly()
            }
          },
          {
            key: "editor-replace",
            label: t("replace", lang),
            onClick: () => {
              closeInputMenu()
              toggleReplace()
            }
          }
        ]}
      />
    </div>
  )
}

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 34,
  padding: "0 11px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 78%, transparent)",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-muted, #94a3b8)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease"
}

const compactBtn: React.CSSProperties = {
  ...btn,
  minHeight: 34,
  padding: "0 10px"
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 36,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-main, #e5e7eb)",
  outline: "none",
  fontSize: 13
}
