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

export async function buildExportPayload(settings: any): Promise<string> {
  return await invoke("export_backup_bundle", {
    settingsJson: JSON.stringify(settings ?? {})
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
              `Verbindungen importiert: ${connectionsImported}`,
              `Snippets importiert: ${snippetsImported}`,
              `SSH Schlüssel importiert: ${sshKeysImported}`,
              `Tunnels importiert: ${tunnelsImported}`
            ]
          : [
              `Connections imported: ${connectionsImported}`,
              `Snippets imported: ${snippetsImported}`,
              `SSH keys imported: ${sshKeysImported}`,
              `Tunnels imported: ${tunnelsImported}`
            ]

      const warningHeader =
        lang === "de" ? "Warnungen:" : "Warnings:"

      const description =
        warnings.length > 0
          ? `${summary.join("\n")}\n\n${warningHeader}\n${warnings.join("\n")}`
          : summary.join("\n")

      showDialog({
        type: "alert",
        title,
        description,
        confirmLabel: "OK",
        onConfirm: () => {}
      })

      showToast(ui.importedBackup)
      setTimeout(() => window.location.reload(), 1500)
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
