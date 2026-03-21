import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react"

import { invoke } from "@tauri-apps/api/core"

import { Columns, Folder, SplitSquareVertical, SplitSquareHorizontal, Cable, ScrollText, Search as SearchIcon, FileText, ArrowLeftRight, X } from "lucide-react"
import SftpPanel from "./SftpPanel"
import TunnelPanel from "./TunnelPanel"
import SnippetsPanel from "./SnippetsPanel"
import NotesPanel from "./NotesPanel"
import TerminalStatusBar from "./TerminalStatusBar"
import TerminalSearchBar from "./TerminalSearchBar"
import { terminalStore } from "../lib/terminalStore"
import {
  cancelDestroySession,
  copyTerminalSelection,
  destroyTerminal,
  ensureTerminal,
  formatSessionDuration,
  isLocalServer,
  keepBottom,
  pasteTerminalClipboard,
  scheduleDestroySession,
  startIfNeeded,
  syncSize
} from "../lib/terminalSession"
import { t } from "../lib/i18n"
import "xterm/css/xterm.css"



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



const toolBtnStyle: CSSProperties = {
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

const iconOnlyBtnStyle: CSSProperties = {
  ...toolBtnStyle,
  width: 28,
  padding: 0
}

const paneHeaderBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 76%, transparent)",
  background: "color-mix(in srgb, var(--bg-app) 76%, var(--bg-sidebar))",
  color: "var(--text-muted, #94a3b8)",
  cursor: "pointer",
  transition: "background 140ms ease, color 140ms ease, border-color 140ms ease"
}

function getPaneLabel(server: any) {
  if (!server) return "Unknown"
  if (isLocalServer(server)) return "Local Terminal"
  const user = server?.username || "user"
  const host = server?.host || server?.name || "host"
  return `${user}@${host}`
}

export default function TerminalPane(props: any) {
  const server = props.server
  const sessionId = props.sessionId
  const onClose = props.onClose || props.onCloseTab
  const settings = props.settings || {}
  const initialPaneServers =
    server?.splitMode && Array.isArray(server?.paneServers) && server.paneServers.length >= 2
      ? server.paneServers
      : [server]
  const initialPaneSessionIds =
    server?.splitMode && Array.isArray(server?.paneSessionIds) && server.paneSessionIds.length >= 2
      ? server.paneSessionIds
      : [sessionId]

  const [showSftp, setShowSftp] = useState(false)
  const [showTunnels, setShowTunnels] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [pingMs, setPingMs] = useState<string>("...")
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [activeTunnelLabel, setActiveTunnelLabel] = useState("")
  const [statusMetrics, setStatusMetrics] = useState<{ load?: string; ram?: string }>({})
  const [splitDirection, setSplitDirection] = useState<"vertical" | "horizontal">("vertical")
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [paneIds, setPaneIds] = useState<string[]>(initialPaneSessionIds)
  const [paneServers, setPaneServers] = useState<any[]>(initialPaneServers)
  const [splitCounter, setSplitCounter] = useState(0)
  const [focusedPaneId, setFocusedPaneId] = useState(initialPaneSessionIds[0] || sessionId)

  const dragRef = useRef(false)
  const paneIdsRef = useRef<string[]>(initialPaneSessionIds)
  const paneServersRef = useRef<any[]>(initialPaneServers)
  const focusedPaneIdRef = useRef(initialPaneSessionIds[0] || sessionId)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const isSplit = paneIds.length > 1
  const isMultiServerSplit = Boolean(server?.splitMode && paneServers.length > 1)
  const focusedPaneIndex = Math.max(0, paneIds.indexOf(focusedPaneId))
  const activePaneServer =
    paneServers[focusedPaneIndex] ||
    paneServers[0] ||
    server
  const isActive = Boolean(props.isActive)
  const showSplit = settings.showSplit !== false && !isMultiServerSplit
  const showSftpBtn = settings.showSftp !== false && !isLocalServer(server)
  const showTunnelsBtn = settings.showTunnels !== false && !isLocalServer(server)
  const showSnippetsBtn = settings.showSnippets !== false && !isLocalServer(server)
  const showNotesBtn = settings.showNotes !== false && !isLocalServer(server)
  const showSearchBtn = settings.showSearch !== false
  const showStatusBar = settings.showStatusBar !== false
  const showStatusBarSession = settings.showStatusBarSession !== false
  const showStatusBarTunnel = settings.showStatusBarTunnel !== false
  const showStatusBarLoad = settings.showStatusBarLoad !== false
  const showStatusBarRam = settings.showStatusBarRam !== false
  const statusLang = settings?.lang || "en"

  useEffect(() => {
    paneIdsRef.current = paneIds
  }, [paneIds])

  useEffect(() => {
    paneServersRef.current = paneServers
  }, [paneServers])

  useEffect(() => {
    focusedPaneIdRef.current = focusedPaneId
  }, [focusedPaneId])

  useEffect(() => {
    if (server?.splitMode && Array.isArray(server?.paneServers) && Array.isArray(server?.paneSessionIds)) {
      setPaneServers(server.paneServers)
      setPaneIds(server.paneSessionIds)
      setFocusedPaneId((prev: string) =>
        server.paneSessionIds.includes(prev) ? prev : server.paneSessionIds[0] || sessionId
      )
      return
    }

    setPaneServers([server])
    setPaneIds([sessionId])
    setFocusedPaneId(sessionId)
  }, [server, sessionId])

  useEffect(() => {
    if (!paneIds.includes(focusedPaneId)) {
      setFocusedPaneId(paneIds[0] || sessionId)
    }
  }, [paneIds, focusedPaneId, sessionId])

  useEffect(() => {
    if (paneServers.length > paneIds.length) {
      setPaneServers((prev) => prev.slice(0, paneIds.length))
      return
    }

    if (paneIds.length > paneServers.length) {
      setPaneServers((prev) => {
        const next = [...prev]
        while (next.length < paneIds.length) {
          next.push(server)
        }
        return next
      })
    }
  }, [paneIds, paneServers.length, server])

  useEffect(() => {
    if (!isActive) return

    if (isLocalServer(activePaneServer)) {
      setPingMs("local")
      return
    }

    let alive = true

    const updatePing = async () => {
      try {
        const ms = await invoke("ping_host", {
          host: activePaneServer.host,
          port: activePaneServer.port || 22
        })
        if (alive) setPingMs(String(ms))
      } catch {
        if (alive) setPingMs("timeout")
      }
    }

    void updatePing()
    const id = window.setInterval(updatePing, 3000)

    return () => {
      alive = false
      clearInterval(id)
    }
  }, [isActive, activePaneServer])

  useEffect(() => {
    setSessionSeconds(0)

    const id = window.setInterval(() => {
      setSessionSeconds((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(id)
  }, [sessionId])

  useEffect(() => {
    if (!isActive) return

    if (isLocalServer(activePaneServer) || (!showStatusBarLoad && !showStatusBarRam) || !activePaneServer?.id) {
      setStatusMetrics({})
      return
    }

    let alive = true

    const updateStatusMetrics = async () => {
      try {
        const info = await invoke("get_status_bar_info", { serverId: activePaneServer.id }) as { load?: string; ram?: string }

        if (!alive) return

        setStatusMetrics({
          load: info?.load != null && String(info.load).trim() ? String(info.load) : undefined,
          ram: info?.ram != null && String(info.ram).trim() ? String(info.ram) : undefined
        })
      } catch {
        if (alive) setStatusMetrics({})
      }
    }

    void updateStatusMetrics()
    const id = window.setInterval(updateStatusMetrics, 5000)

    return () => {
      alive = false
      clearInterval(id)
    }
  }, [isActive, activePaneServer?.id, showStatusBarLoad, showStatusBarRam])

  useEffect(() => {
    if (!isActive) return

    if (isLocalServer(activePaneServer) || !showStatusBarTunnel || !activePaneServer?.id) {
      setActiveTunnelLabel("")
      return
    }

    let alive = true

    const updateTunnelStatus = async () => {
      try {
        const [allTunnels, activeTunnels] = await Promise.all([
          invoke("get_tunnels", { serverId: activePaneServer.id }) as Promise<any[]>,
          invoke("get_active_tunnels") as Promise<{ id: number }[]>
        ])

        if (!alive) return

        const activeIds = new Set((activeTunnels || []).map((item) => item.id))
        const activeForServer = (allTunnels || []).filter((item) => activeIds.has(item.id))

        if (activeForServer.length === 0) {
          setActiveTunnelLabel("")
          return
        }

        if (activeForServer.length === 1) {
          const tunnelName = activeForServer[0]?.name || "Tunnel"
          setActiveTunnelLabel(`(${tunnelName})`)
          return
        }

        setActiveTunnelLabel(String(activeForServer.length))
      } catch {
        if (alive) setActiveTunnelLabel("")
      }
    }

    void updateTunnelStatus()
    const id = window.setInterval(updateTunnelStatus, 3000)

    return () => {
      alive = false
      clearInterval(id)
    }
  }, [isActive, activePaneServer?.id, showStatusBarTunnel, statusLang])

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

  const sessionDuration = formatSessionDuration(sessionSeconds)

  const statusBarRightItems = [
    showStatusBarLoad && statusMetrics.load ? { kind: "load", value: statusMetrics.load } : null,
    showStatusBarRam && statusMetrics.ram ? { kind: "ram", value: statusMetrics.ram } : null
  ].filter(Boolean) as { kind: "load" | "ram"; value: string }[]

  const closePane = useCallback((targetSessionId: string) => {
    const currentPaneIds = paneIdsRef.current
    const currentPaneServers = paneServersRef.current
    const currentFocusedPaneId = focusedPaneIdRef.current

    if (currentPaneIds.length <= 1) {
      destroyTerminal(targetSessionId)
      onClose?.()
      return
    }

    const removedIndex = currentPaneIds.indexOf(targetSessionId)
    if (removedIndex == -1) return

    const nextPaneIds = currentPaneIds.filter((id) => id !== targetSessionId)
    const nextPaneServers = currentPaneServers.filter((_, index) => index !== removedIndex)
    const nextFocusedPaneId =
      currentFocusedPaneId === targetSessionId
        ? (nextPaneIds[0] || null)
        : currentFocusedPaneId

    destroyTerminal(targetSessionId)

    paneIdsRef.current = nextPaneIds
    paneServersRef.current = nextPaneServers
    focusedPaneIdRef.current = nextFocusedPaneId || ""

    setPaneIds(nextPaneIds)
    setPaneServers(nextPaneServers)
    if (nextFocusedPaneId) {
      setFocusedPaneId(nextFocusedPaneId)
    }

    props.onPaneStateChange?.({
      paneServers: nextPaneServers,
      paneSessionIds: nextPaneIds,
      focusedPaneId: nextFocusedPaneId
    })
  }, [onClose, props])

  const swapPanes = useCallback(() => {
    if (paneIds.length < 2 || paneServers.length < 2) return

    const nextPaneIds = [paneIds[1], paneIds[0]]
    const nextPaneServers = [paneServers[1], paneServers[0]]
    const nextFocusedPaneId =
      focusedPaneId === paneIds[0]
        ? paneIds[1]
        : focusedPaneId === paneIds[1]
          ? paneIds[0]
          : focusedPaneId

    setPaneIds(nextPaneIds)
    setPaneServers(nextPaneServers)
    if (nextFocusedPaneId) {
      setFocusedPaneId(nextFocusedPaneId)
    }

    props.onPaneStateChange?.({
      paneServers: nextPaneServers,
      paneSessionIds: nextPaneIds,
      focusedPaneId: nextFocusedPaneId
    })
  }, [paneIds, paneServers, focusedPaneId, props])

  const toggleSplit = useCallback(() => {
    setPaneIds((prev) => {
      if (prev.length > 1) {
        const [, second] = prev
        if (second) destroyTerminal(second)
        setPaneServers((prevServers) => [prevServers[0] || server])
        return [prev[0]]
      }

      const newSessionId = `${sessionId}__split_${splitCounter + 1}`
      setSplitCounter((v) => v + 1)
      setPaneServers((prevServers) => [prevServers[0] || server, prevServers[0] || server])
      return [prev[0], newSessionId]
    })
  }, [sessionId, splitCounter, server])

  const mainPaneStyle: CSSProperties =
    splitDirection === "vertical"
      ? { width: `${splitRatio * 100}%`, minWidth: 0, minHeight: 0 }
      : { height: `${splitRatio * 100}%`, minWidth: 0, minHeight: 0, width: "100%" }

  const splitPaneStyle: CSSProperties =
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
    if (!isActive) return

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
  }, [isActive, showSearch, searchQuery, focusedPaneId, paneIds, sessionId])

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
            {isLocalServer(activePaneServer) ? "Local Session" : `${activePaneServer?.username || ""}@${activePaneServer?.host || ""}`}
          </div>

          {!isLocalServer(activePaneServer) && (
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
              title={t("search", settings?.lang || "en")}
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
        <TerminalSearchBar
          lang={settings?.lang || "en"}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          runSearch={runSearch}
          closeSearchBar={closeSearchBar}
        />
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
        <div
          style={isSplit ? mainPaneStyle : { flex: 1, minWidth: 0, minHeight: 0 }}
          onMouseDown={() => setFocusedPaneId(paneIds[0])}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              border: isMultiServerSplit && focusedPaneId === paneIds[0]
                ? "1px solid color-mix(in srgb, var(--accent) 42%, var(--border-subtle))"
                : "1px solid transparent",
              borderRadius: 10,
              overflow: "hidden"
            }}
          >
            {isMultiServerSplit && (
              <div
                style={{
                  height: 30,
                  minHeight: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px",
                  borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
                  background: focusedPaneId === paneIds[0]
                    ? "color-mix(in srgb, var(--accent) 12%, var(--bg-sidebar))"
                    : "color-mix(in srgb, var(--bg-sidebar) 92%, var(--bg-app))"
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: focusedPaneId === paneIds[0] ? "var(--text-main)" : "var(--text-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {getPaneLabel(paneServers[0] || server)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: focusedPaneId === paneIds[0] ? "var(--accent)" : "var(--text-muted)"
                    }}
                  >
                    {focusedPaneId === paneIds[0] ? "Active" : "Passive"}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      swapPanes()
                    }}
                    title="Swap panes"
                    style={paneHeaderBtnStyle}
                  >
                    <ArrowLeftRight size={12} />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closePane(paneIds[0])
                    }}
                    title="Close pane"
                    style={paneHeaderBtnStyle}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <TerminalInstance
                key={paneIds[0]}
                server={paneServers[0] || server}
                sessionId={paneIds[0]}
                settings={settings}
                onClose={() => closePane(paneIds[0])}
                showToast={props.showToast}
                lang={settings?.lang || "en"}
                onFocus={() => setFocusedPaneId(paneIds[0])}
              />
            </div>
          </div>
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

            <div style={splitPaneStyle} onMouseDown={() => setFocusedPaneId(paneIds[1])}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  border: isMultiServerSplit && focusedPaneId === paneIds[1]
                    ? "1px solid color-mix(in srgb, var(--accent) 42%, var(--border-subtle))"
                    : "1px solid transparent",
                  borderRadius: 10,
                  overflow: "hidden"
                }}
              >
                {isMultiServerSplit && (
                  <div
                    style={{
                      height: 30,
                      minHeight: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 10px",
                      borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
                      background: focusedPaneId === paneIds[1]
                        ? "color-mix(in srgb, var(--accent) 12%, var(--bg-sidebar))"
                        : "color-mix(in srgb, var(--bg-sidebar) 92%, var(--bg-app))"
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: focusedPaneId === paneIds[1] ? "var(--text-main)" : "var(--text-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}
                    >
                      {getPaneLabel(paneServers[1] || paneServers[0] || server)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: focusedPaneId === paneIds[1] ? "var(--accent)" : "var(--text-muted)"
                        }}
                      >
                        {focusedPaneId === paneIds[1] ? "Active" : "Passive"}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          swapPanes()
                        }}
                        title="Swap panes"
                        style={paneHeaderBtnStyle}
                      >
                        <ArrowLeftRight size={12} />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          closePane(paneIds[1])
                        }}
                        title="Close pane"
                        style={paneHeaderBtnStyle}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                  <TerminalInstance
                    key={paneIds[1]}
                    server={paneServers[1] || paneServers[0] || server}
                    sessionId={paneIds[1]}
                    settings={settings}
                    onClose={() => closePane(paneIds[1])}
                    showToast={props.showToast}
                    lang={settings?.lang || "en"}
                    onFocus={() => setFocusedPaneId(paneIds[1])}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {showStatusBar && (
        <TerminalStatusBar
          showStatusBarSession={showStatusBarSession}
          showStatusBarTunnel={showStatusBarTunnel}
          activeTunnelLabel={activeTunnelLabel}
          sessionDuration={sessionDuration}
          statusBarRightItems={statusBarRightItems}
        />
      )}

      {!isLocalServer(activePaneServer) && (
        <SftpPanel
          server={activePaneServer}
          lang={settings?.lang || "en"}
          visible={showSftp}
          onClose={() => setShowSftp(false)}
        />
      )}

      {!isLocalServer(activePaneServer) && (
        <SnippetsPanel
          lang={settings?.lang || "en"}
          showDialog={props.showDialog}
          visible={showSnippets}
          onClose={() => setShowSnippets(false)}
          onExecute={async (command: string) => {
            const targetSessionId = getSearchTargetSessionId()
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

      {!isLocalServer(activePaneServer) && (
        <TunnelPanel
          server={activePaneServer}
          visible={showTunnels}
          onClose={() => setShowTunnels(false)}
          showToast={props.showToast}
        />
      )}

      {!isLocalServer(activePaneServer) && (
        <NotesPanel
          server={activePaneServer}
          lang={settings?.lang || "en"}
          visible={showNotes}
          onClose={() => setShowNotes(false)}
          showDialog={props.showDialog}
        />
      )}
    </div>
  )
}
