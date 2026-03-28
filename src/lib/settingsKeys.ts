import { invoke } from "@tauri-apps/api/core"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { getPathBaseName } from "./settingsHelpers"

type CommonDeps = {
  lang: string
  showToast: (msg: string, isErr?: boolean) => void
  ui: any
}

type LoadKeysDeps = {
  setKeys: (keys: any[]) => void
}

export async function loadSshKeys({ setKeys }: LoadKeysDeps) {
  try {
    setKeys(await invoke("get_ssh_keys"))
  } catch {
  }
}

export function promptGenerateSshKey({
  lang,
  showDialog,
  showToast,
  ui,
  loadKeys
}: CommonDeps & {
  showDialog: (config: any) => void
  loadKeys: () => Promise<void>
}) {
  showDialog({
    type: "prompt",
    title: lang === "de" ? "Schlüssel erzeugen" : "Generate key",
    placeholder: lang === "de" ? "Name" : "Name",
    onConfirm: async (val: string) => {
      if (!val?.trim()) return
      try {
        await invoke("generate_ssh_key", { name: val.trim(), keyType: "ed25519" })
        await loadKeys()
        showToast(ui.generated)
      } catch (e: any) {
        showToast(`Key generation failed: ${String(e)}`, true)
      }
    }
  })
}

export async function importExistingSshKey({
  showToast,
  ui,
  loadKeys
}: CommonDeps & {
  loadKeys: () => Promise<void>
}) {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "SSH Key", extensions: ["pem", "key", "pub", "id_rsa", "id_ed25519"] }]
    })

    const filePath = Array.isArray(picked) ? picked[0] : picked
    if (!filePath || typeof filePath !== "string") return

    const fileName = getPathBaseName(filePath) || ui.importedLabel

    await invoke("save_ssh_key", {
      name: fileName,
      publicKey: "",
      privateKeyPath: filePath,
      keyType: "imported"
    })

    await loadKeys()
    showToast(ui.imported)
  } catch (e: any) {
    showToast(`Key import failed: ${String(e)}`, true)
  }
}

export async function copySshPublicKey({
  publicKey,
  lang,
  showToast
}: {
  publicKey: string
  lang: string
  showToast: (msg: string, isErr?: boolean) => void
}) {
  try {
    await writeText(publicKey || "")
    showToast(lang === "de" ? "Kopiert" : "Copied")
  } catch (e: any) {
    showToast(`Clipboard failed: ${String(e)}`, true)
  }
}

export function confirmDeleteSshKey({
  id,
  name,
  lang,
  showDialog,
  showToast,
  loadKeys
}: {
  id: number
  name: string
  lang: string
  showDialog: (config: any) => void
  showToast: (msg: string, isErr?: boolean) => void
  loadKeys: () => Promise<void>
}) {
  showDialog({
    type: "confirm",
    tone: "danger",
    title: lang === "de" ? "SSH Schlüssel löschen" : "Delete SSH key",
    description:
      lang === "de"
        ? `Der gespeicherte SSH Schlüssel "${name}" wird entfernt.`
        : `This removes the stored SSH key "${name}".`,
    confirmLabel: lang === "de" ? "Löschen" : "Delete",
    cancelLabel: lang === "de" ? "Abbrechen" : "Cancel",
    onConfirm: async () => {
      try {
        await invoke("delete_ssh_key", { id })
        await loadKeys()
        showToast(lang === "de" ? "Gelöscht" : "Deleted")
      } catch (e: any) {
        showToast(`Key delete failed: ${String(e)}`, true)
      }
    }
  })
}
