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

const NOTES_STORAGE_PREFIX = "termina_notes:"

function collectNotesForBackup(): BackupNote[] {
  const notes: BackupNote[] = []

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(NOTES_STORAGE_PREFIX)) continue

      const content = localStorage.getItem(key) ?? ""
      if (!content) continue

      notes.push({
        storage_key: key,
        content
      })
    }
  } catch {
  }

  notes.sort((a, b) => a.storage_key.localeCompare(b.storage_key))
  return notes
}

function importNotesFromBundle(bundleJson: string): number {
  try {
    const parsed = JSON.parse(bundleJson)
    const notesValue = parsed?.notes

    if (!Array.isArray(notesValue)) return 0

    let imported = 0

    for (const item of notesValue) {
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

    return imported
  } catch {
    return 0
  }
}

export async function buildExportPayload(settings: any): Promise<string> {
  const backendBundle = await invoke("export_backup_bundle", {
    settingsJson: JSON.stringify(settings ?? {})
  })

  const parsed = JSON.parse(String(backendBundle))
  parsed.notes = collectNotesForBackup()

  return JSON.stringify(parsed, null, 2)
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
      const notesImported = importNotesFromBundle(bundleJson)
      const result: any = await invoke("import_backup_bundle", { bundleJson })

      if (result?.settings) {
        setSettings({ ...settings, ...result.settings })
      }

      const connectionsImported = Number(result?.connections_imported || 0)
      const snippetsImported = Number(result?.snippets_imported || 0)
      const sshKeysImported = Number(result?.ssh_keys_imported || 0)
      const tunnelsImported = Number(result?.tunnels_imported || 0)
      const warnings = Array.isArray(result?.warnings) ? result.warnings : []

      const title =
        lang === "de" ? "Backup Import abgeschlossen" : "Backup import completed"

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

      const warningLines = warnings.map((warning: string) => `• ${warning}`)

      const description =
        warnings.length > 0
          ? `${summary.join("\n")}\n\n${warningHeader}\n\n${warningLines.join("\n")}`
          : summary.join("\n")

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
