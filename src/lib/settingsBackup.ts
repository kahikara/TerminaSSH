import { invoke } from "@tauri-apps/api/core"
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs"
import { encryptData, decryptData } from "./settingsHelpers"

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

const NOTES_STORAGE_PREFIX = "termina_notes:"
const MAX_BACKUP_NOTES = 250
const MAX_BACKUP_NOTE_CHARS = 200_000

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
  return await invoke("export_backup_bundle", {
    settingsJson: JSON.stringify(settings ?? {}),
    notesJson: JSON.stringify(collectNotesForBackup())
  })
}

export async function saveBackupFile() {
  const { save } = await import("@tauri-apps/plugin-dialog")
  const dateStr = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0]
  return await save({ defaultPath: `backup_termina_${dateStr}.json` })
}

export async function handleExportPlainConfig({ settings, showToast, ui }: Pick<BackupDeps, "settings" | "showToast" | "ui">) {
  try {
    const path = await saveBackupFile()
    if (!path) return

    const exportPayload = await buildExportPayload(settings)
    await writeTextFile(path, exportPayload)
    showToast(ui.exported)
  } catch (e: any) {
    showToast(`Backup export failed: ${String(e)}`, true)
  }
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
        const path = await saveBackupFile()
        if (!path) return

        const exportPayload = await buildExportPayload(settings)
        const encrypted = await encryptData(exportPayload, pwd)
        await writeTextFile(path, encrypted)
        showToast(ui.exported)
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

    const applyImportedBundle = async (bundleJson: string) => {
      const bundleMeta = getBundleMeta(bundleJson)
      const result: any = await invoke("import_backup_bundle", { bundleJson })
      const notesResult = importNotesFromResult(result?.notes, lang)
      const notesImported = Number(result?.notes_imported ?? notesResult.imported)

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

      const details =
        lang === "de"
          ? [
              "Backup Details",
              "",
              `• Bundle Version: ${bundleMeta.version || "-"}`,
              `• App: ${bundleMeta.appName || "-"}`,
              `• App Version: ${bundleMeta.appVersion || "-"}`,
              `• Format: ${bundleMeta.formatName || "-"}`,
              `• Exportiert: ${bundleMeta.exportedAt || "-"}`
            ]
          : [
              "Backup details",
              "",
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
              `• Notizen: ${notesImported}`
            ]
          : [
              "Import summary",
              "",
              `• Connections: ${connectionsImported}`,
              `• Snippets: ${snippetsImported}`,
              `• SSH keys: ${sshKeysImported}`,
              `• Tunnels: ${tunnelsImported}`,
              `• Notes: ${notesImported}`
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
      await applyImportedBundle(rawContent)
      return
    } catch {
    }

    showDialog({
      type: "prompt",
      title: lang === "de" ? "Passwort eingeben" : "Enter password",
      isPassword: true,
      onConfirm: async (pwd: string) => {
        if (!pwd) return

        try {
          const decrypted = await decryptData(rawContent, pwd)
          JSON.parse(decrypted)
          await applyImportedBundle(decrypted)
        } catch {
          showToast(ui.wrongPassword, true)
        }
      }
    })
  } catch (e: any) {
    showToast(`Backup import failed: ${String(e)}`, true)
  }
}
