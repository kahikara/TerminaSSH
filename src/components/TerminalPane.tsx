import React, { useEffect, useRef, useState, useCallback } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { SearchAddon } from "xterm-addon-search"
import { invoke } from "@tauri-apps/api/core"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { Columns, Folder, SplitSquareVertical, SplitSquareHorizontal, Cable, ScrollText, Search as SearchIcon, ChevronUp, ChevronDown, X, FileText } from "lucide-react"
import SftpPanel from "./SftpPanel"
import TunnelPanel from "./TunnelPanel"
import SnippetsPanel from "./SnippetsPanel"
import NotesPanel from "./NotesPanel"
import { terminalStore } from "../lib/terminalStore"
import { t } from "../lib/i18n"
import "xterm/css/xterm.css"

type StoreEntry = {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  opened: boolean
  started: boolean
  starting: boolean
  unlisten?: UnlistenFn
  buffer?: string
}

const pendingDestroyTimers: Record<string, number> = {}

function scheduleDestroySession(sessionId: string) {
  cancelDestroySession(sessionId)
  pendingDestroyTimers[sessionId] = window.setTimeout(() => {
    destroyTerminal(sessionId)
    delete pendingDestroyTimers[sessionId]
  }, 250)
}

function cancelDestroySession(sessionId: string) {
  const timer = pendingDestroyTimers[sessionId]
  if (timer != null) {
    clearTimeout(timer)
    delete pendingDestroyTimers[sessionId]
  }
}

function isLocalServer(server: any) {
  return (
    !!server?.isLocal ||
    server?.type === "local" ||
    server?.kind === "local" ||
    server?.name === "Local Terminal" ||
    server?.name === "Local Session" ||
    server?.host === "__local__" ||
    server?.host === "local" ||
    server?.id === "local" ||
    server?.id == null
  )
}

function shouldCloseFromBuffer(buf: string) {
  return (
    /(?:^|\r?\n)(logout|exit)(?:\r?\n|$)/i.test(buf) ||
    /Connection to .* closed/i.test(buf) ||
    /Connection closed/i.test(buf) ||
    /\[Lokale Shell beendet\]/i.test(buf) ||
    /\[Verbindung beendet\]/i.test(buf)
  )
}

function keepBottom(term: Terminal) {
  try { term.scrollToBottom() } catch {}
  requestAnimationFrame(() => {
    try { term.scrollToBottom() } catch {}
  })
}

function createTerminalOptions(settings: any) {
  return {
    fontFamily: "JetBrains Mono, monospace",
    fontSize: Number(settings?.fontSize) || 13,
    scrollback: Number(settings?.scrollback) || 10000,
    cursorBlink: settings?.cursorBlink !== false,
    cursorStyle: settings?.cursorStyle || "bar",
    allowTransparency: true,
    convertEol: false
  } as const
}

function ensureTerminal(server: any, sessionId: string, settings: any, onClose?: () => void): StoreEntry {
  let entry: StoreEntry = terminalStore[sessionId]

  if (!entry) {
    const term = new Terminal(createTerminalOptions(settings))
    const fit = new FitAddon()
    const search = new SearchAddon()

    term.loadAddon(fit)
    term.loadAddon(search)

    entry = {
      term,
      fit,
      search,
      opened: false,
      started: false,
      starting: false,
      buffer: ""
    }

    terminalStore[sessionId] = entry

    term.onData((data) => {
      invoke("write_to_pty", { sessionId, input: data }).catch(() => {})
    })

    term.onResize((size) => {
      if (!entry!.started) return
      invoke("resize_pty", {
        sessionId,
        cols: size.cols,
        rows: size.rows
      }).catch(() => {})
      keepBottom(term)
    })

    listen(`term-output-${sessionId}`, (e: any) => {
      const text = String(e.payload ?? "")
      entry!.buffer = ((entry!.buffer || "") + text).slice(-4000)

      term.write(text, () => {
        keepBottom(term)
      })

      if (shouldCloseFromBuffer(entry!.buffer || "")) {
        setTimeout(() => onClose?.(), 120)
      }
    }).then((unlisten) => {
      entry!.unlisten = unlisten
    }).catch(() => {})
  } else {
    try {
      entry.term.options.fontSize = Number(settings?.fontSize) || 13
      entry.term.options.scrollback = Number(settings?.scrollback) || 10000
      entry.term.options.cursorBlink = settings?.cursorBlink !== false
      entry.term.options.cursorStyle = settings?.cursorStyle || "bar"
    } catch {}
  }

  return entry
}

async function startIfNeeded(server: any, sessionId: string, entry: StoreEntry) {
  if (entry.started || entry.starting) return

  entry.starting = true

  try {
    const cols = entry.term.cols > 0 ? entry.term.cols : 80
    const rows = entry.term.rows > 0 ? entry.term.rows : 24

    if (isLocalServer(server)) {
      await invoke("start_local_pty", { sessionId, cols, rows })
    } else if (server?.isQuickConnect) {
      await invoke("start_quick_ssh", {
        host: server.host,
        port: server.port || 22,
        username: server.username || "root",
        password: server.password || "",
        privateKey: server.private_key || "",
        passphrase: server.passphrase || "",
        sessionId,
        cols,
        rows
      })
    } else {
      await invoke("start_ssh", { id: server.id, sessionId, cols, rows })
    }

    entry.started = true
  } catch (e: any) {
    const msg = String(e?.message || e || "Session start failed")
    try {
      entry.term.writeln(`\r\n[Start failed] ${msg}\r\n`)
    } catch {}
    throw e
  } finally {
    entry.starting = false
  }
}

function syncSize(sessionId: string, entry: StoreEntry) {
  const cols = entry.term.cols > 0 ? entry.term.cols : 80
  const rows = entry.term.rows > 0 ? entry.term.rows : 24

  invoke("resize_pty", {
    sessionId,
    cols,
    rows
  }).catch(() => {})

  keepBottom(entry.term)
}

function destroyTerminal(sessionId: string) {
  const entry: StoreEntry | undefined = terminalStore[sessionId]
  if (!entry) return
  try { entry.unlisten?.() } catch {}
  try { invoke("close_session", { sessionId }).catch(() => {}) } catch {}
  try { (entry as any).__cleanup?.() } catch {}
  try { entry.term.dispose() } catch {}
  delete terminalStore[sessionId]
}

async function copyTerminalSelection(term: Terminal, showToast?: (msg: string, isErr?: boolean) => void, lang = "de") {
  const text = term.getSelection()
  if (!text) return

  try {
    await writeText(text)
    try { (term as any).clearSelection?.() } catch {}
    showToast?.(lang === "de" ? "Auswahl kopiert" : "Selection copied")
  } catch (e: any) {
    showToast?.(
      lang === "de"
        ? `Kopieren fehlgeschlagen: ${String(e)}`
        : `Copy failed: ${String(e)}`,
      true
    )
  }
}

async function pasteTerminalClipboard(
  sessionId: string,
  term: Terminal,
  showToast?: (msg: string, isErr?: boolean) => void,
  lang = "de"
) {
  try {
    const text = await readText()
    if (!text) return
    await invoke("write_to_pty", { sessionId, input: text })
    try { term.focus() } catch {}
    showToast?.(lang === "de" ? "Aus Zwischenablage eingefügt" : "Pasted from clipboard")
  } catch (e: any) {
    showToast?.(
      lang === "de"
        ? `Einfügen fehlgeschlagen: ${String(e)}`
        : `Paste failed: ${String(e)}`,
      true
    )
  }
}

function TerminalInstance({
  server,
  sessionId,
  settings,
  onClose,
  showToast,
  lang = "de",
  onFocus
}: {
  server: any
  sessionId: string
  settings: any
  onClose?: () => void
  showToast?: (msg: string, isErr?: boolean) => void
  lang?: string
  onFocus?: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef<(() => void) | undefined>(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    cancelDestroySession(sessionId)

    const entry = ensureTerminal(server, sessionId, settings, () => onCloseRef.current?.())
    const term = entry.term
    const fit = entry.fit

    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let fitTimer: number | null = null

    const fitAndSync = () => {
      if (disposed) return

      if (fitTimer !== null) clearTimeout(fitTimer)

      fitTimer = window.setTimeout(() => {
        if (disposed) return
        try { fit.fit() } catch {}
        if (entry.started) {
          syncSize(sessionId, entry)
        } else {
          keepBottom(term)
        }
      }, 30)
    }

    const mount = async () => {
      if (!containerRef.current) return

      if (!entry.opened) {
        term.open(containerRef.current)
        entry.opened = true
      } else {
        try {
          const termEl = (term as any).element as HTMLElement | undefined
          if (termEl && termEl.parentElement !== containerRef.current) {
            containerRef.current.innerHTML = ""
            containerRef.current.appendChild(termEl)
          }
        } catch {}
      }

      try { fit.fit() } catch {}
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      try { fit.fit() } catch {}

      await startIfNeeded(server, sessionId, entry)

      fitAndSync()
      term.focus()

      resizeObserver = new ResizeObserver(() => {
        fitAndSync()
      })

      resizeObserver.observe(containerRef.current)

      const handleWindowResize = () => {
        fitAndSync()
      }

      window.addEventListener("resize", handleWindowResize)

      ;(entry as any).__cleanup = () => {
        window.removeEventListener("resize", handleWindowResize)
        try { resizeObserver?.disconnect() } catch {}
      }
    }

    mount()

    return () => {
      disposed = true
      if (fitTimer !== null) clearTimeout(fitTimer)
      try { (entry as any).__cleanup?.() } catch {}
    }
  }, [server, sessionId, settings?.fontSize, settings?.scrollback, settings?.cursorBlink, settings?.cursorStyle])

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "hidden",
        background: "var(--bg-app, #000)"
      }}
      onClick={() => {
        try {
          onFocus?.()
          const entry = terminalStore[sessionId]
          entry?.term?.focus()
        } catch {}
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onContextMenu={async (e) => {
        e.preventDefault()
        e.stopPropagation()

        try {
          const entry = terminalStore[sessionId]
          const term = entry?.term
          if (!term) return

          term.focus()

          if (term.hasSelection()) {
            await copyTerminalSelection(term, showToast, lang)
            return
          }

          await pasteTerminalClipboard(sessionId, term, showToast, lang)
        } catch {}
      }}
      onAuxClick={async (e) => {
        if (e.button !== 1) return

        e.preventDefault()
        e.stopPropagation()

        try {
          const entry = terminalStore[sessionId]
          const term = entry?.term
          if (!term) return

          if (term.hasSelection()) return
          await pasteTerminalClipboard(sessionId, term, showToast, lang)
        } catch {}
      }}
    >
      <div ref={containerRef} style={{ flex: 1, height: "100%" }} />
    </div>
  )
}

const toolBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: 28,
  padding: "0 8px",
  borderRadius: 8,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "var(--bg-app, #111111)",
  color: "var(--text-main, #e5e7eb)",
  cursor: "pointer",
  fontSize: 11,
  whiteSpace: "nowrap",
  transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease"
}

const iconOnlyBtnStyle: React.CSSProperties = {
  ...toolBtnStyle,
  width: 28,
  padding: 0
}

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  height: 28,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 76%, transparent)",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-main, #e5e7eb)",
  fontSize: 11,
  outline: "none"
}

export default function TerminalPane(props: any) {
  const server = props.server
  const sessionId = props.sessionId
  const onClose = props.onClose || props.onCloseTab
  const settings = props.settings || {}

  const [showSftp, setShowSftp] = useState(false)
  const [showTunnels, setShowTunnels] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [pingMs, setPingMs] = useState<string>("...")
  const [splitDirection, setSplitDirection] = useState<"vertical" | "horizontal">("vertical")
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [paneIds, setPaneIds] = useState<string[]>([sessionId])
  const [splitCounter, setSplitCounter] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState(sessionId)

  const dragRef = useRef(false)
  const paneIdsRef = useRef<string[]>([sessionId])
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const isSplit = paneIds.length > 1
  const showSplit = settings.showSplit !== false
  const showSftpBtn = settings.showSftp !== false && !isLocalServer(server)
  const showTunnelsBtn = settings.showTunnels !== false && !isLocalServer(server)
  const showSnippetsBtn = settings.showSnippets !== false && !isLocalServer(server)
  const showNotesBtn = settings.showNotes !== false && !isLocalServer(server)
  const showSearchBtn = settings.showSearch !== false

  useEffect(() => {
    paneIdsRef.current = paneIds
  }, [paneIds])

  useEffect(() => {
    if (!paneIds.includes(focusedPaneId)) {
      setFocusedPaneId(paneIds[0] || sessionId)
    }
  }, [paneIds, focusedPaneId, sessionId])

  useEffect(() => {
    if (isLocalServer(server)) {
      setPingMs("local")
      return
    }

    let alive = true

    const updatePing = async () => {
      try {
        const ms = await invoke("ping_host", {
          host: server.host,
          port: server.port || 22
        })
        if (alive) setPingMs(String(ms))
      } catch {
        if (alive) setPingMs("timeout")
      }
    }

    updatePing()
    const id = window.setInterval(updatePing, 3000)

    return () => {
      alive = false
      clearInterval(id)
    }
  }, [server])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return

      const root = document.getElementById(`split-root-${sessionId}`)
      if (!root) return

      const rect = root.getBoundingClientRect()

      if (splitDirection === "vertical") {
        const next = (e.clientX - rect.left) / rect.width
        setSplitRatio(Math.max(0.2, Math.min(0.8, next)))
      } else {
        const next = (e.clientY - rect.top) / rect.height
        setSplitRatio(Math.max(0.2, Math.min(0.8, next)))
      }
    }

    const onUp = () => {
      dragRef.current = false
      document.body.style.cursor = "default"
      document.body.style.userSelect = ""
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)

    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [splitDirection, sessionId])

  useEffect(() => {
    return () => {
      for (const id of paneIdsRef.current) {
        scheduleDestroySession(id)
      }
    }
  }, [])

  const closePane = useCallback((targetSessionId: string) => {
    setPaneIds((prev) => {
      if (prev.length <= 1) {
        destroyTerminal(targetSessionId)
        onClose?.()
        return prev
      }

      destroyTerminal(targetSessionId)
      return prev.filter((id) => id !== targetSessionId)
    })
  }, [onClose])

  const toggleSplit = useCallback(() => {
    setPaneIds((prev) => {
      if (prev.length > 1) {
        const [, second] = prev
        if (second) destroyTerminal(second)
        return [prev[0]]
      }

      const newSessionId = `${sessionId}__split_${splitCounter + 1}`
      setSplitCounter((v) => v + 1)
      return [prev[0], newSessionId]
    })
  }, [sessionId, splitCounter])

  const mainPaneStyle: React.CSSProperties =
    splitDirection === "vertical"
      ? { width: `${splitRatio * 100}%`, minWidth: 0, minHeight: 0 }
      : { height: `${splitRatio * 100}%`, minWidth: 0, minHeight: 0, width: "100%" }

  const splitPaneStyle: React.CSSProperties =
    splitDirection === "vertical"
      ? { width: `${(1 - splitRatio) * 100}%`, minWidth: 0, minHeight: 0 }
      : { height: `${(1 - splitRatio) * 100}%`, minWidth: 0, minHeight: 0, width: "100%" }

  const getSearchTargetSessionId = () => {
    if (paneIds.includes(focusedPaneId)) return focusedPaneId
    return paneIds[0] || sessionId
  }

  const focusSearchInput = () => {
    setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)
  }

  const openSearchBar = () => {
    setShowSearch(true)
    focusSearchInput()
  }

  const closeSearchBar = () => {
    setShowSearch(false)
    setSearchQuery("")
    try {
      const entry = terminalStore[getSearchTargetSessionId()]
      entry?.term?.focus()
    } catch {}
  }

  const toggleSearchBar = () => {
    if (showSearch) {
      closeSearchBar()
    } else {
      openSearchBar()
    }
  }

  const runSearch = (backwards = false, queryOverride?: string, focusTerminal = false) => {
    const query = String(queryOverride ?? searchQuery)
    if (!query.trim()) return

    try {
      const targetSessionId = getSearchTargetSessionId()
      const entry = terminalStore[targetSessionId]
      if (!entry) return

      const found = backwards
        ? entry.search.findPrevious(query)
        : entry.search.findNext(query)

      if (!found) {
        props.showToast?.(
          settings?.lang === "de" ? "Kein Treffer gefunden" : "No match found"
        )
        return
      }

      if (focusTerminal) {
        entry.term.focus()
      }
    } catch {}
  }

  useEffect(() => {
    if (!props.isActive) return

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === "f") {
        e.preventDefault()
        e.stopPropagation()
        toggleSearchBar()
        return
      }

      if (!showSearch) return

      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closeSearchBar()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        runSearch(e.shiftKey)
      }
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [props.isActive, showSearch, searchQuery, focusedPaneId, paneIds, sessionId])

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        background: "var(--bg-app, #000)",
        position: "relative"
      }}
    >
      <div
        style={{
          height: "40px",
          minHeight: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
          background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-main, #cfcfcf)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {isLocalServer(server) ? "Local Session" : `${server?.username || ""}@${server?.host || ""}`}
          </div>

          {!isLocalServer(server) && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 24,
                padding: "0 8px",
                borderRadius: 999,
                border: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 76%, transparent)",
                background: "color-mix(in srgb, var(--bg-app) 76%, var(--bg-sidebar))",
                fontSize: "11px",
                color: pingMs === "timeout" ? "var(--danger, #ef4444)" : "var(--text-muted, #94a3b8)",
                whiteSpace: "nowrap",
                flexShrink: 0
              }}
              title="Ping refreshes every 3 seconds"
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "999px",
                  display: "inline-block",
                  background:
                    pingMs === "timeout"
                      ? "var(--danger, #ef4444)"
                      : Number(pingMs) < 80
                        ? "var(--success, #22c55e)"
                        : Number(pingMs) < 150
                          ? "var(--warning, #f59e0b)"
                          : "var(--danger, #ef4444)"
                }}
              />
              <span>{pingMs === "timeout" ? "timeout" : `${pingMs} ms`}</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {showSearchBtn && (
            <button
              onClick={toggleSearchBar}
              title={t("search", settings?.lang || "de")}
              style={{
                ...iconOnlyBtnStyle,
                background: showSearch ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: showSearch ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
              }}
            >
              <SearchIcon size={13} />
            </button>
          )}

          {showSftpBtn && (
            <button
              onClick={() => {
                setShowSftp((v) => {
                  const next = !v
                  if (next) {
                    setShowTunnels(false)
                    setShowSnippets(false)
                    setShowNotes(false)
                  }
                  return next
                })
              }}
              title="SFTP"
              style={{
                ...toolBtnStyle,
                background: showSftp ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: showSftp ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
              }}
            >
              <Folder size={13} />
              <span>SFTP</span>
            </button>
          )}

          {showSnippetsBtn && (
            <button
              onClick={() => {
                setShowSnippets((v) => {
                  const next = !v
                  if (next) {
                    setShowSftp(false)
                    setShowTunnels(false)
                    setShowNotes(false)
                  }
                  return next
                })
              }}
              title="Snippets"
              style={{
                ...toolBtnStyle,
                background: showSnippets ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: showSnippets ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
              }}
            >
              <ScrollText size={14} />
              <span>Snippets</span>
            </button>
          )}

          {showTunnelsBtn && (
            <button
              onClick={() => {
                setShowTunnels((v) => {
                  const next = !v
                  if (next) {
                    setShowSftp(false)
                    setShowSnippets(false)
                    setShowNotes(false)
                  }
                  return next
                })
              }}
              title="Tunnels"
              style={{
                ...toolBtnStyle,
                background: showTunnels ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: showTunnels ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
              }}
            >
              <Cable size={13} />
              <span>Tunnels</span>
            </button>
          )}

          {showNotesBtn && (
            <button
              onClick={() => {
                setShowNotes((v) => {
                  const next = !v
                  if (next) {
                    setShowSftp(false)
                    setShowSnippets(false)
                    setShowTunnels(false)
                  }
                  return next
                })
              }}
              title="Notes"
              style={{
                ...toolBtnStyle,
                background: showNotes ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                color: showNotes ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
              }}
            >
              <FileText size={13} />
              <span>Notes</span>
            </button>
          )}

          {showSplit && (
            <>
              <button
                onClick={() => setSplitDirection((v) => v === "vertical" ? "horizontal" : "vertical")}
                title="Toggle split direction"
                style={toolBtnStyle}
              >
                {splitDirection === "vertical" ? <SplitSquareVertical size={13} /> : <SplitSquareHorizontal size={13} />}
              </button>

              <button
                onClick={toggleSplit}
                title="Split View"
                style={{
                  ...toolBtnStyle,
                  background: isSplit ? "var(--bg-hover, #1f2937)" : "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                  color: isSplit ? "var(--text-main, #e5e7eb)" : "var(--text-muted, #94a3b8)"
                }}
              >
                <Columns size={13} />
                <span>Split</span>
              </button>
            </>
          )}
        </div>
      </div>

      {showSearch && (
        <div
          style={{
            minHeight: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
            background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"
          }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              const next = e.target.value
              setSearchQuery(next)
              if (next.trim()) {
                setTimeout(() => runSearch(false, next, false), 0)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                runSearch(e.shiftKey, undefined, false)
              }
            }}
            placeholder={t("search", settings?.lang || "de")}
            style={searchInputStyle}
          />

          <button
            onClick={() => runSearch(true, undefined, false)}
            title={settings?.lang === "de" ? "Vorheriger Treffer" : "Previous match"}
            style={iconOnlyBtnStyle}
          >
            <ChevronUp size={13} />
          </button>

          <button
            onClick={() => runSearch(false, undefined, false)}
            title={settings?.lang === "de" ? "Nächster Treffer" : "Next match"}
            style={iconOnlyBtnStyle}
          >
            <ChevronDown size={13} />
          </button>

          <button
            onClick={closeSearchBar}
            title={t("close", settings?.lang || "de")}
            style={iconOnlyBtnStyle}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div
        id={`split-root-${sessionId}`}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: splitDirection === "vertical" ? "row" : "column",
          background: "var(--bg-app, #000)"
        }}
      >
        <div style={isSplit ? mainPaneStyle : { flex: 1, minWidth: 0, minHeight: 0 }}>
          <TerminalInstance
            key={paneIds[0]}
            server={server}
            sessionId={paneIds[0]}
            settings={settings}
            onClose={() => closePane(paneIds[0])}
            showToast={props.showToast}
            lang={settings?.lang || "de"}
            onFocus={() => setFocusedPaneId(paneIds[0])}
          />
        </div>

        {isSplit && paneIds[1] && (
          <>
            <div
              onMouseDown={() => {
                dragRef.current = true
                document.body.style.cursor = splitDirection === "vertical" ? "col-resize" : "row-resize"
                document.body.style.userSelect = "none"
              }}
              style={
                splitDirection === "vertical"
                  ? { width: 5, cursor: "col-resize", background: "color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 82%, transparent)", flexShrink: 0 }
                  : { height: 5, cursor: "row-resize", background: "color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 82%, transparent)", flexShrink: 0 }
              }
            />

            <div style={splitPaneStyle}>
              <TerminalInstance
                key={paneIds[1]}
                server={server}
                sessionId={paneIds[1]}
                settings={settings}
                onClose={() => closePane(paneIds[1])}
                showToast={props.showToast}
                lang={settings?.lang || "de"}
                onFocus={() => setFocusedPaneId(paneIds[1])}
              />
            </div>
          </>
        )}
      </div>

      {!isLocalServer(server) && (
        <SftpPanel
          server={server}
          lang={settings?.lang || "de"}
          visible={showSftp}
          onClose={() => setShowSftp(false)}
        />
      )}

      {!isLocalServer(server) && (
        <SnippetsPanel
          lang={settings?.lang || "de"}
          showDialog={props.showDialog}
          visible={showSnippets}
          onClose={() => setShowSnippets(false)}
          onExecute={async (command: string) => {
            const targetSessionId = paneIds[0] || sessionId
            try {
              await invoke("write_to_pty", {
                sessionId: targetSessionId,
                input: command.endsWith("\n") ? command : `${command}\n`
              })
              const entry = terminalStore[targetSessionId]
              entry?.term?.focus()
            } catch {}
          }}
        />
      )}

      {!isLocalServer(server) && (
        <TunnelPanel
          server={server}
          visible={showTunnels}
          onClose={() => setShowTunnels(false)}
          showToast={props.showToast}
        />
      )}

      {!isLocalServer(server) && (
        <NotesPanel
          server={server}
          lang={settings?.lang || "de"}
          visible={showNotes}
          onClose={() => setShowNotes(false)}
          showDialog={props.showDialog}
        />
      )}
    </div>
  )
}
