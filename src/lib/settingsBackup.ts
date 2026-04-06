import { invoke } from "@tauri-apps/api/core"
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs"
import { encryptData, decryptData, copyToClipboard, openPathInFileManager } from "./settingsHelpers"

type BackupDeps = {
  settings: any
  setSettings: (next: any) => void
  showToast: (msg: string, isErr?: boolean) => void
  showDialog: (config: any) => void
  ui: any
  lang: string
}

type BackupNote = {
  storage_key: string
  content: string
}

type NotesImportResult = {
  imported: number
  warnings: string[]
}

type BundleMeta = {
  version: number
  appName: string
  appVersion: string
  formatName: string
  exportedAt: string
}

type BundleCounts = {
  connections: number
  snippets: number
  tunnels: number
  sshKeys: number
  notes: number
  recentConnections: number
}

type BackupMode = "plain" | "encrypted"

const NOTES_STORAGE_PREFIX = "termina_notes:"
const RECENT_CONNECTIONS_STORAGE_KEY = "termina_recent_connections"
const BACKUP_FORMAT_NAME = "terminassh-backup-v4"
const BACKUP_VERSION = 4
const MAX_BACKUP_NOTES = 250
const MAX_BACKUP_NOTE_CHARS = 200_000

function collectRecentConnectionsForBackup(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CONNECTIONS_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return Array.from(
      new Set(
        parsed
          .map((value: unknown) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ).slice(0, 24)
  } catch {
    return []
  }
}

function importRecentConnectionsFromBundle(bundleJson: string): number {
  try {
    const parsed = JSON.parse(bundleJson)
    const rawRecent =
      Array.isArray(parsed?.recentConnectionIds)
        ? parsed.recentConnectionIds
        : Array.isArray(parsed?.recent_connection_ids)
          ? parsed.recent_connection_ids
          : []

    const normalized = Array.from(
      new Set(
        rawRecent
          .map((value: unknown) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ).slice(0, 24)

    localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(normalized))
    return normalized.length
  } catch {
    return 0
  }
}

function collectNotesForBackup(): BackupNote[] {
  const keys: string[] = []

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(NOTES_STORAGE_PREFIX)) continue
      keys.push(key)
    }
  } catch {
  }

  keys.sort((a, b) => a.localeCompare(b))

  const notes: BackupNote[] = []

  for (const key of keys) {
    if (notes.length >= MAX_BACKUP_NOTES) break

    try {
      const content = localStorage.getItem(key) ?? ""
      if (!content) continue
      if (content.length > MAX_BACKUP_NOTE_CHARS) continue

      notes.push({
        storage_key: key,
        content
      })
    } catch {
    }
  }

  return notes
}

function getBundleMeta(bundleJson: string): BundleMeta {
  try {
    const parsed = JSON.parse(bundleJson)

    return {
      version: Number(parsed?.version || 0),
      appName: typeof parsed?.appName === "string" ? parsed.appName : "",
      appVersion: typeof parsed?.appVersion === "string" ? parsed.appVersion : "",
      formatName: typeof parsed?.format === "string" ? parsed.format : "",
      exportedAt: typeof parsed?.exportedAt === "string" ? parsed.exportedAt : ""
    }
  } catch {
    return {
      version: 0,
      appName: "",
      appVersion: "",
      formatName: "",
      exportedAt: ""
    }
  }
}

function getBundleCounts(bundleJson: string): BundleCounts {
  try {
    const parsed = JSON.parse(bundleJson)

    return {
      connections: Array.isArray(parsed?.connections) ? parsed.connections.length : 0,
      snippets: Array.isArray(parsed?.snippets) ? parsed.snippets.length : 0,
      tunnels: Array.isArray(parsed?.tunnels) ? parsed.tunnels.length : 0,
      sshKeys: Array.isArray(parsed?.sshKeys) ? parsed.sshKeys.length : 0,
      notes: Array.isArray(parsed?.notes) ? parsed.notes.length : 0,
      recentConnections: Array.isArray(parsed?.recentConnectionIds) ? parsed.recentConnectionIds.length : 0
    }
  } catch {
    return {
      connections: 0,
      snippets: 0,
      tunnels: 0,
      sshKeys: 0,
      notes: 0,
      recentConnections: 0
    }
  }
}

function getBackupModeLabel(lang: string, mode: BackupMode): string {
  if (lang === "de") {
    return mode === "encrypted"
      ? "Verschlüsseltes Backup mit Passwort"
      : "Unverschlüsseltes JSON Backup mit sensiblen Daten im Klartext"
  }

  return mode === "encrypted"
    ? "Encrypted backup with password"
    : "Unencrypted JSON backup with plaintext secrets"
}

function showExportSummaryDialog(
  showDialog: (config: any) => void,
  showToast: (msg: string, isErr?: boolean) => void,
  lang: string,
  path: string,
  bundleJson: string,
  encrypted: boolean
) {
  const meta = getBundleMeta(bundleJson)
  const counts = getBundleCounts(bundleJson)

  const title =
    lang === "de" ? "Backup exportiert" : "Backup exported"

  const modeLabel = getBackupModeLabel(lang, encrypted ? "encrypted" : "plain")

  const description =
    lang === "de"
      ? [
          "Export Übersicht",
          "",
          `• Datei: ${path}`,
          `• Modus: ${modeLabel}`,
          `• Bundle Version: ${meta.version || "-"}`,
          `• App: ${meta.appName || "-"}`,
          `• App Version: ${meta.appVersion || "-"}`,
          `• Format: ${meta.formatName || "-"}`,
          `• Exportiert: ${meta.exportedAt || "-"}`,
          "",
          "Inhalt",
          "",
          `• Verbindungen: ${counts.connections}`,
          `• Snippets: ${counts.snippets}`,
          `• SSH Schlüssel: ${counts.sshKeys}`,
          `• Tunnels: ${counts.tunnels}`,
          `• Notizen: ${counts.notes}`,
          `• Recent Connections: ${counts.recentConnections}`
        ].join("\n")
      : [
          "Export summary",
          "",
          `• File: ${path}`,
          `• Mode: ${modeLabel}`,
          `• Bundle version: ${meta.version || "-"}`,
          `• App: ${meta.appName || "-"}`,
          `• App version: ${meta.appVersion || "-"}`,
          `• Format: ${meta.formatName || "-"}`,
          `• Exported: ${meta.exportedAt || "-"}`,
          "",
          "Content",
          "",
          `• Connections: ${counts.connections}`,
          `• Snippets: ${counts.snippets}`,
          `• SSH keys: ${counts.sshKeys}`,
          `• Tunnels: ${counts.tunnels}`,
          `• Notes: ${counts.notes}`,
          `• Recent connections: ${counts.recentConnections}`
        ].join("\n")

  showDialog({
    type: "alert",
    title,
    description,
    secondaryLabel: lang === "de" ? "Pfad kopieren" : "Copy path",
    onSecondary: async () => {
      const ok = await copyToClipboard(path)
      showToast(
        ok
          ? lang === "de" ? "Pfad kopiert" : "Path copied"
          : lang === "de" ? "Pfad konnte nicht kopiert werden" : "Failed to copy path",
        !ok
      )
    },
    tertiaryLabel: lang === "de" ? "Ordner öffnen" : "Open folder",
    onTertiary: async () => {
      const ok = await openPathInFileManager(path)
      showToast(
        ok
          ? lang === "de" ? "Ordner geöffnet" : "Folder opened"
          : lang === "de" ? "Ordner konnte nicht geöffnet werden" : "Failed to open folder",
        !ok
      )
    },
    confirmLabel: "OK",
    onConfirm: () => {}
  })
}

function validateBackupBundle(bundleJson: string, lang: string): string | null {
  let parsed: any

  try {
    parsed = JSON.parse(bundleJson)
  } catch {
    return lang === "de"
      ? "Die Datei ist kein gültiges JSON Backup."
      : "The file is not a valid JSON backup."
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return lang === "de"
      ? "Die Backup Datei hat kein gültiges Objekt als Wurzel."
      : "The backup file does not contain a valid object root."
  }

  const formatName = typeof parsed?.format === "string" ? parsed.format.trim() : ""
  if (formatName !== BACKUP_FORMAT_NAME) {
    return lang === "de"
      ? "Dieses Backup verwendet ein altes oder unbekanntes Format. Bitte erstelle ein neues Backup mit der aktuellen Version."
      : "This backup uses an older or unknown format. Please create a new backup with the current version."
  }

  const version = Number(parsed?.version)
  if (!Number.isFinite(version) || version !== BACKUP_VERSION) {
    return lang === "de"
      ? `Dieses Backup verwendet Version ${String(parsed?.version ?? "-")}. Unterstützt wird nur Version ${BACKUP_VERSION}. Bitte erstelle ein neues Backup.`
      : `This backup uses version ${String(parsed?.version ?? "-")}. Only version ${BACKUP_VERSION} is supported. Please create a new backup.`
  }

  const hasKnownBackupField =
    "settings" in parsed ||
    "connections" in parsed ||
    "snippets" in parsed ||
    "tunnels" in parsed ||
    "sshKeys" in parsed ||
    "ssh_keys" in parsed ||
    "notes" in parsed

  if (!hasKnownBackupField) {
    return lang === "de"
      ? "Die Datei enthält keine erkennbaren Termina SSH Backup Daten."
      : "The file does not contain recognizable Termina SSH backup data."
  }

  return null
}

function looksLikeEncryptedBackupPayload(rawContent: string): boolean {
  const trimmed = rawContent.trim()
  if (trimmed.length < 64) return false
  if (trimmed.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)
}

function showInvalidBackupDialog(showDialog: (config: any) => void, lang: string, description: string) {
  showDialog({
    type: "alert",
    title: lang === "de" ? "Ungültiges Backup" : "Invalid backup",
    description,
    confirmLabel: "OK",
    onConfirm: () => {}
  })
}

function showInvalidEncryptedBackupDialog(showDialog: (config: any) => void, lang: string) {
  showDialog({
    type: "alert",
    title: lang === "de" ? "Beschädigtes verschlüsseltes Backup" : "Corrupted encrypted backup",
    description:
      lang === "de"
        ? "Die Datei konnte zwar entschlüsselt werden, enthält danach aber kein gültiges Termina SSH Backup."
        : "The file could be decrypted, but the decrypted content is not a valid Termina SSH backup.",
    confirmLabel: "OK",
    onConfirm: () => {}
  })
}

function importNotesFromResult(notesValue: unknown, lang: string): NotesImportResult {
  if (!Array.isArray(notesValue)) {
    return {
      imported: 0,
      warnings: []
    }
  }

  let imported = 0
  const warnings: string[] = []

  if (notesValue.length > MAX_BACKUP_NOTES) {
    warnings.push(
      lang === "de"
        ? `Es wurden nur die ersten ${MAX_BACKUP_NOTES} Notizen importiert.`
        : `Only the first ${MAX_BACKUP_NOTES} notes were imported.`
    )
  }

  for (const item of notesValue.slice(0, MAX_BACKUP_NOTES)) {
    const storageKey =
      typeof item?.storage_key === "string"
        ? item.storage_key
        : typeof item?.storageKey === "string"
          ? item.storageKey
          : ""

    const content =
      typeof item?.content === "string"
        ? item.content
        : ""

    if (!storageKey.startsWith(NOTES_STORAGE_PREFIX)) continue

    if (content.length > MAX_BACKUP_NOTE_CHARS) {
      warnings.push(
        lang === "de"
          ? `Eine Notiz wurde übersprungen, weil sie größer als ${MAX_BACKUP_NOTE_CHARS} Zeichen ist.`
          : `One note was skipped because it is larger than ${MAX_BACKUP_NOTE_CHARS} characters.`
      )
      continue
    }

    try {
      if (content) {
        localStorage.setItem(storageKey, content)
      } else {
        localStorage.removeItem(storageKey)
      }
      imported += 1
    } catch {
    }
  }

  return {
    imported,
    warnings
  }
}

function formatImportWarning(rawWarning: string, lang: string): string {
  let match: RegExpMatchArray | null = null

  match = rawWarning.match(/^Connection '(.+)' already exists and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `Verbindung „${match[1]}“ existiert bereits und wurde übersprungen.`
      : `Connection “${match[1]}” already exists and was skipped.`
  }

  match = rawWarning.match(/^Snippet '(.+)' already exists and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `Snippet „${match[1]}“ existiert bereits und wurde übersprungen.`
      : `Snippet “${match[1]}” already exists and was skipped.`
  }

  match = rawWarning.match(/^Tunnel '(.+)' already exists and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `Tunnel „${match[1]}“ existiert bereits und wurde übersprungen.`
      : `Tunnel “${match[1]}” already exists and was skipped.`
  }

  match = rawWarning.match(/^SSH key '(.+)' already exists and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `SSH Schlüssel „${match[1]}“ existiert bereits und wurde übersprungen.`
      : `SSH key “${match[1]}” already exists and was skipped.`
  }

  match = rawWarning.match(/^SSH key '(.+)' could not be decoded and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `SSH Schlüssel „${match[1]}“ konnte nicht dekodiert werden und wurde übersprungen.`
      : `SSH key “${match[1]}” could not be decoded and was skipped.`
  }

  match = rawWarning.match(/^SSH key '(.+)' had no portable key content and no usable local path, so it was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `SSH Schlüssel „${match[1]}“ hatte keinen portablen Schlüsselinhalt und keinen nutzbaren lokalen Pfad und wurde daher übersprungen.`
      : `SSH key “${match[1]}” had no portable key content and no usable local path, so it was skipped.`
  }

  match = rawWarning.match(/^Connection '(.+)' referenced a key path that is not available on this system\. The key path was cleared\.$/)
  if (match) {
    return lang === "de"
      ? `Bei Verbindung „${match[1]}“ war ein Schlüsselpfad hinterlegt, der auf diesem System nicht verfügbar ist. Der Schlüsselpfad wurde geleert.`
      : `Connection “${match[1]}” referenced a key path that is not available on this system. The key path was cleared.`
  }

  match = rawWarning.match(/^Tunnel '(.+)' could not be linked to an imported connection and was skipped\.$/)
  if (match) {
    return lang === "de"
      ? `Tunnel „${match[1]}“ konnte keiner importierten Verbindung zugeordnet werden und wurde übersprungen.`
      : `Tunnel “${match[1]}” could not be linked to an imported connection and was skipped.`
  }

  if (rawWarning === "One connection was skipped because required fields were missing.") {
    return lang === "de"
      ? "Eine Verbindung wurde übersprungen, weil Pflichtfelder fehlten."
      : rawWarning
  }

  if (rawWarning === "One snippet was skipped because its name was empty.") {
    return lang === "de"
      ? "Ein Snippet wurde übersprungen, weil der Name leer war."
      : rawWarning
  }

  if (rawWarning === "One tunnel was skipped because required fields were missing.") {
    return lang === "de"
      ? "Ein Tunnel wurde übersprungen, weil Pflichtfelder fehlten."
      : rawWarning
  }

  if (rawWarning === "This backup uses an older format. Some data such as portable SSH key content may be unavailable.") {
    return lang === "de"
      ? "Dieses Backup verwendet ein älteres Format. Manche Daten wie portabler SSH Schlüsselinhalt sind eventuell nicht verfügbar."
      : rawWarning
  }

  return rawWarning
}

function getWarningCategory(formattedWarning: string): "connections" | "sshKeys" | "tunnels" | "snippets" | "notes" | "other" {
  const lower = formattedWarning.toLowerCase()

  if (lower.includes("verbindung") || lower.includes("connection")) return "connections"
  if (lower.includes("ssh key") || lower.includes("ssh schlüssel")) return "sshKeys"
  if (lower.includes("tunnel")) return "tunnels"
  if (lower.includes("snippet")) return "snippets"
  if (lower.includes("notiz") || lower.includes("notes") || lower.includes("note ")) return "notes"

  return "other"
}

function buildWarningSectionLines(warnings: string[], lang: string): string[] {
  const groups = {
    connections: [] as string[],
    sshKeys: [] as string[],
    tunnels: [] as string[],
    snippets: [] as string[],
    notes: [] as string[],
    other: [] as string[]
  }

  const seen = new Set<string>()

  for (const rawWarning of warnings) {
    const formatted = formatImportWarning(rawWarning, lang).trim()
    if (!formatted || seen.has(formatted)) continue
    seen.add(formatted)

    const category = getWarningCategory(formatted)
    groups[category].push(formatted)
  }

  const titles =
    lang === "de"
      ? {
          connections: "Verbindungen",
          sshKeys: "SSH Schlüssel",
          tunnels: "Tunnels",
          snippets: "Snippets",
          notes: "Notizen",
          other: "Allgemein"
        }
      : {
          connections: "Connections",
          sshKeys: "SSH keys",
          tunnels: "Tunnels",
          snippets: "Snippets",
          notes: "Notes",
          other: "General"
        }

  const orderedCategories = ["connections", "sshKeys", "tunnels", "snippets", "notes", "other"] as const
  const lines: string[] = []

  for (const category of orderedCategories) {
    const items = groups[category]
    if (items.length === 0) continue

    if (lines.length > 0) lines.push("")
    lines.push(titles[category])
    lines.push("")

    for (const item of items) {
      lines.push(`• ${item}`)
    }
  }

  return lines
}



export async function buildExportPayload(settings: any): Promise<string> {
  const rawBundle = await invoke("export_backup_bundle", {
    settingsJson: JSON.stringify(settings ?? {}),
    notesJson: JSON.stringify(collectNotesForBackup())
  }) as string

  const parsed = JSON.parse(rawBundle)
  parsed.recentConnectionIds = collectRecentConnectionsForBackup()

  return JSON.stringify(parsed, null, 2)
}

export async function saveBackupFile(encrypted = false) {
  const { save } = await import("@tauri-apps/plugin-dialog")
  const dateStr = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0]
  const ext = encrypted ? "bak" : "json"
  return await save({ defaultPath: `backup_termina_${dateStr}.${ext}` })
}

export async function handleExportPlainConfig({
  settings,
  showToast,
  showDialog,
  ui,
  lang
}: Pick<BackupDeps, "settings" | "showToast" | "showDialog" | "ui" | "lang">) {
  const description =
    lang === "de"
      ? [
          "Dieses Backup wird unverschlüsselt gespeichert.",
          "",
          "Es kann sensible Daten im Klartext enthalten:",
          "• Verbindungs Passwörter",
          "• Key Passphrases",
          "• Portable Private Keys",
          "",
          "Nutze wenn möglich den verschlüsselten Export."
        ].join("
")
      : [
          "This backup will be stored without encryption.",
          "",
          "It may contain plaintext sensitive data:",
          "• Connection passwords",
          "• Key passphrases",
          "• Portable private keys",
          "",
          "Use the encrypted export whenever possible."
        ].join("
")

  showDialog({
    type: "confirm",
    title: lang === "de" ? "Unverschlüsseltes Backup exportieren?" : "Export unencrypted backup?",
    description,
    confirmLabel: lang === "de" ? "Trotzdem exportieren" : "Export anyway",
    cancelLabel: lang === "de" ? "Abbrechen" : "Cancel",
    onCancel: () => {},
    onConfirm: async () => {
      try {
        const path = await saveBackupFile(false)
        if (!path) return

        const exportPayload = await buildExportPayload(settings)
        await writeTextFile(path, exportPayload)
        showToast(ui.exported)
        showExportSummaryDialog(showDialog, showToast, lang, String(path), exportPayload, false)
      } catch (e: any) {
        showToast(`Backup export failed: ${String(e)}`, true)
      }
    }
  })
}

export function handleExportEncryptedConfig({
  settings,
  showToast,
  showDialog,
  ui,
  lang
}: Pick<BackupDeps, "settings" | "showToast" | "showDialog" | "ui" | "lang">) {
  showDialog({
    type: "prompt",
    title: lang === "de" ? "Passwort setzen" : "Set password",
    placeholder: lang === "de" ? "Passwort" : "Password",
    confirmPlaceholder: lang === "de" ? "Passwort erneut eingeben" : "Enter password again",
    isPassword: true,
    requireConfirm: true,
    validate: (pwd: string, confirmPwd: string) => {
      if (!pwd || !confirmPwd) return ""
      if (pwd !== confirmPwd) {
        return lang === "de"
          ? "Die Passwörter stimmen nicht überein."
          : "Passwords do not match."
      }
      return ""
    },
    onConfirm: async (pwd: string) => {
      try {
        const path = await saveBackupFile(true)
        if (!path) return

        const exportPayload = await buildExportPayload(settings)
        const encrypted = await encryptData(exportPayload, pwd)
        await writeTextFile(path, encrypted)
        showToast(ui.exported)
        showExportSummaryDialog(showDialog, showToast, lang, String(path), exportPayload, true)
      } catch (e: any) {
        showToast(`Backup export failed: ${String(e)}`, true)
      }
    }
  })
}

export async function handleImportConfig({
  settings,
  setSettings,
  showToast,
  showDialog,
  ui,
  lang
}: BackupDeps) {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const path = await open({ multiple: false, filters: [{ name: "JSON/Backup", extensions: ["json", "bak"] }] })

    if (!path) return

    const applyImportedBundle = async (bundleJson: string, mode: BackupMode) => {
      const bundleMeta = getBundleMeta(bundleJson)
      const result: any = await invoke("import_backup_bundle", { bundleJson })
      const notesResult = importNotesFromResult(result?.notes, lang)
      const notesImported = Number(result?.notes_imported ?? notesResult.imported)
      const recentConnectionsImported = importRecentConnectionsFromBundle(bundleJson)

      if (result?.settings) {
        setSettings({ ...settings, ...result.settings })
      }

      const connectionsImported = Number(result?.connections_imported || 0)
      const snippetsImported = Number(result?.snippets_imported || 0)
      const sshKeysImported = Number(result?.ssh_keys_imported || 0)
      const tunnelsImported = Number(result?.tunnels_imported || 0)
      const backendWarnings = Array.isArray(result?.warnings) ? result.warnings : []
      const warnings = [...backendWarnings, ...notesResult.warnings]

      const title =
        lang === "de" ? "Backup Import abgeschlossen" : "Backup import completed"

      const modeLabel = getBackupModeLabel(lang, mode)

      const details =
        lang === "de"
          ? [
              "Backup Details",
              "",
              `• Modus: ${modeLabel}`,
              `• Bundle Version: ${bundleMeta.version || "-"}`,
              `• App: ${bundleMeta.appName || "-"}`,
              `• App Version: ${bundleMeta.appVersion || "-"}`,
              `• Format: ${bundleMeta.formatName || "-"}`,
              `• Exportiert: ${bundleMeta.exportedAt || "-"}`
            ]
          : [
              "Backup details",
              "",
              `• Mode: ${modeLabel}`,
              `• Bundle version: ${bundleMeta.version || "-"}`,
              `• App: ${bundleMeta.appName || "-"}`,
              `• App version: ${bundleMeta.appVersion || "-"}`,
              `• Format: ${bundleMeta.formatName || "-"}`,
              `• Exported: ${bundleMeta.exportedAt || "-"}`
            ]

      const summary =
        lang === "de"
          ? [
              "Import Übersicht",
              "",
              `• Verbindungen: ${connectionsImported}`,
              `• Snippets: ${snippetsImported}`,
              `• SSH Schlüssel: ${sshKeysImported}`,
              `• Tunnels: ${tunnelsImported}`,
              `• Notizen: ${notesImported}`,
              `• Recent Connections: ${recentConnectionsImported}`
            ]
          : [
              "Import summary",
              "",
              `• Connections: ${connectionsImported}`,
              `• Snippets: ${snippetsImported}`,
              `• SSH keys: ${sshKeysImported}`,
              `• Tunnels: ${tunnelsImported}`,
              `• Notes: ${notesImported}`,
              `• Recent connections: ${recentConnectionsImported}`
            ]

      const warningHeader =
        lang === "de" ? "Warnungen" : "Warnings"

      const warningLines = buildWarningSectionLines(warnings, lang)

      const description =
        warnings.length > 0
          ? `${details.join("\n")}\n\n${summary.join("\n")}\n\n${warningHeader}\n\n${warningLines.join("\n")}`
          : `${details.join("\n")}\n\n${summary.join("\n")}`

      showDialog({
        type: "alert",
        title,
        description,
        confirmLabel: "OK",
        onConfirm: () => {
          window.location.reload()
        }
      })

      showToast(ui.importedBackup)
    }

    const rawContent = await readTextFile(path as string)

    try {
      JSON.parse(rawContent)

      const validationError = validateBackupBundle(rawContent, lang)
      if (validationError) {
        showDialog({
          type: "alert",
          title: lang === "de" ? "Ungültiges Backup" : "Invalid backup",
          description: validationError,
          confirmLabel: "OK",
          onConfirm: () => {}
        })
        return
      }

      await applyImportedBundle(rawContent, "plain")
      return
    } catch {
    }

    if (!looksLikeEncryptedBackupPayload(rawContent)) {
      showInvalidBackupDialog(
        showDialog,
        lang,
        lang === "de"
          ? "Die Datei ist weder ein gültiges JSON Backup noch ein erkennbares verschlüsseltes Backup."
          : "The file is neither a valid JSON backup nor a recognizable encrypted backup."
      )
      return
    }

    showDialog({
      type: "prompt",
      title: lang === "de" ? "Passwort eingeben" : "Enter password",
      isPassword: true,
      onConfirm: async (pwd: string) => {
        if (!pwd) return

        let decrypted = ""

        try {
          decrypted = await decryptData(rawContent, pwd)
        } catch {
          showToast(ui.wrongPassword, true)
          return
        }

        try {
          JSON.parse(decrypted)
        } catch {
          showInvalidEncryptedBackupDialog(showDialog, lang)
          return
        }

        const validationError = validateBackupBundle(decrypted, lang)
        if (validationError) {
          showInvalidBackupDialog(showDialog, lang, validationError)
          return
        }

        await applyImportedBundle(decrypted, "encrypted")
      }
    })
  } catch (e: any) {
    showToast(`Backup import failed: ${String(e)}`, true)
  }
}
