import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { SearchAddon } from "xterm-addon-search"
import { invoke } from "@tauri-apps/api/core"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"
import { listen, UnlistenFn } from "@tauri-apps/api/event"
import { terminalStore } from "./terminalStore"

export type StoreEntry = {
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

export function isLocalServer(server: any) {
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

export function ensureTerminal(_server: any, sessionId: string, settings: any, onClose?: () => void): StoreEntry {
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

export async function startIfNeeded(server: any, sessionId: string, entry: StoreEntry) {
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
