import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { invoke } from "@tauri-apps/api/core"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"
import { listen } from "@tauri-apps/api/event"
import { terminalStore } from "./terminalStore"
import { t } from "./i18n"
import type { AppSettings } from "./types"
import type { TerminalServer, TerminalStoreEntry } from "./terminalTypes"

export type StoreEntry = TerminalStoreEntry

const pendingDestroyTimers: Record<string, number> = {}

export function scheduleDestroySession(sessionId: string) {
  cancelDestroySession(sessionId)
  pendingDestroyTimers[sessionId] = window.setTimeout(() => {
    destroyTerminal(sessionId)
    delete pendingDestroyTimers[sessionId]
  }, 250)
}

export function cancelDestroySession(sessionId: string) {
  const timer = pendingDestroyTimers[sessionId]
  if (timer != null) {
    clearTimeout(timer)
    delete pendingDestroyTimers[sessionId]
  }
}

export function isLocalServer(server: TerminalServer | null | undefined) {
  return (
    !!server?.isLocal ||
    server?.type === "local" ||
    server?.kind === "local" ||
    server?.name === "Local Terminal" ||
    server?.name === "Local Session" ||
    server?.host === "__local__" ||
    server?.host === "local" ||
    server?.id === "local"
  )
}

export function keepBottom(term: Terminal) {
  try { term.scrollToBottom() } catch {}
  requestAnimationFrame(() => {
    try { term.scrollToBottom() } catch {}
  })
}

export function formatSessionDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

function createTerminalOptions(settings: AppSettings | null | undefined) {
  const isLight = settings?.theme === "light"

  const theme = isLight
    ? {
        background: "rgba(248, 250, 252, 0)",
        foreground: "#0f172a",
        cursor: "#0f766e",
        cursorAccent: "#f8fafc",
        selectionBackground: "rgba(148, 163, 184, 0.32)",
        black: "#1e293b",
        red: "#dc2626",
        green: "#15803d",
        yellow: "#a16207",
        blue: "#0369a1",
        magenta: "#7c3aed",
        cyan: "#0f766e",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#ef4444",
        brightGreen: "#16a34a",
        brightYellow: "#ca8a04",
        brightBlue: "#0284c7",
        brightMagenta: "#8b5cf6",
        brightCyan: "#0d9488",
        brightWhite: "#0f172a"
      }
    : {
        background: "rgba(9, 12, 18, 0)",
        foreground: "#e5e7eb",
        cursor: "#22d3ee",
        cursorAccent: "#0b1220",
        selectionBackground: "rgba(148, 163, 184, 0.22)",
        black: "#111827",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e5e7eb",
        brightBlack: "#6b7280",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f9fafb"
      }

  return {
    fontFamily: "JetBrains Mono, monospace",
    fontSize: Number(settings?.fontSize) || 13,
    scrollback: Number(settings?.scrollback) || 10000,
    cursorBlink: settings?.cursorBlink !== false,
    cursorStyle: settings?.cursorStyle || "bar",
    allowTransparency: true,
    convertEol: false,
    theme
  } as const
}

export function ensureTerminal(_server: TerminalServer | null | undefined, sessionId: string, settings: AppSettings, onClose?: () => void): StoreEntry {
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
      starting: false
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

      term.write(text, () => {
        keepBottom(term)
      })
    }).then((unlisten) => {
      entry!.unlisten = unlisten
    }).catch(() => {})

    listen(`term-exit-${sessionId}`, () => {
      setTimeout(() => onClose?.(), 120)
    }).then((unlisten) => {
      entry!.exitUnlisten = unlisten
    }).catch(() => {})
  } else {
    try {
      const nextOptions = createTerminalOptions(settings)
      entry.term.options.fontSize = nextOptions.fontSize
      entry.term.options.scrollback = nextOptions.scrollback
      entry.term.options.cursorBlink = nextOptions.cursorBlink
      entry.term.options.cursorStyle = nextOptions.cursorStyle
      entry.term.options.theme = nextOptions.theme
    } catch {}
  }

  return entry
}

export async function startIfNeeded(server: TerminalServer, sessionId: string, entry: StoreEntry) {
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
      await invoke("start_ssh", {
        id: server.id,
        sessionId,
        cols,
        rows,
        passwordOverride: server.sessionPassword || null
      })
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

export function syncSize(sessionId: string, entry: StoreEntry) {
  const cols = entry.term.cols > 0 ? entry.term.cols : 80
  const rows = entry.term.rows > 0 ? entry.term.rows : 24

  invoke("resize_pty", {
    sessionId,
    cols,
    rows
  }).catch(() => {})

  keepBottom(entry.term)
}

export function destroyTerminal(sessionId: string) {
  const entry: StoreEntry | undefined = terminalStore[sessionId]
  if (!entry) return
  try { entry.unlisten?.() } catch {}
  try { entry.exitUnlisten?.() } catch {}
  try { invoke("close_session", { sessionId }).catch(() => {}) } catch {}
  try { (entry as any).__cleanup?.() } catch {}
  try { entry.term.dispose() } catch {}
  delete terminalStore[sessionId]
}

export async function copyTerminalSelection(
  term: Terminal,
  showToast?: (msg: string, isErr?: boolean) => void,
  lang = "de"
) {
  const text = term.getSelection()
  if (!text) return

  try {
    await writeText(text)
    try { (term as any).clearSelection?.() } catch {}
    showToast?.(t("selectionCopied", lang))
  } catch (e: any) {
    const errorText = String(e)
    showToast?.(
      t("copyFailed", lang).replace("{error}", errorText),
      true
    )
  }
}

export async function pasteTerminalClipboard(
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
    showToast?.(t("pastedFromClipboard", lang))
  } catch (e: any) {
    const errorText = String(e)
    showToast?.(
      t("pasteFailed", lang).replace("{error}", errorText),
      true
    )
  }
}
