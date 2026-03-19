import { useEffect, useState } from "react"
import { X, Plus, Trash2, KeyRound, Copy } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { t } from "../lib/i18n"

export default function KeyManagerModal({ isOpen, onClose, showToast, lang }: any) {
  const [keys, setKeys] = useState<any[]>([])

  const loadKeys = async () => {
    try {
      setKeys(await invoke("get_ssh_keys"))
    } catch (e) {}
  }

  useEffect(() => {
    if (isOpen) loadKeys()
  }, [isOpen])

  async function generateKey() {
    try {
      const name = window.prompt(t("name", lang) || "Name")
      if (!name) return
      await invoke("generate_ssh_key", { name })
      await loadKeys()
      showToast?.(t("generated", lang) || "Key generated")
    } catch (e: any) {
      showToast?.(String(e), true)
    }
  }

  async function copyPublicKey(publicKey: string) {
    try {
      await invoke("copy_text_to_clipboard", { text: publicKey })
      showToast?.(t("copy", lang) || "Copied")
    } catch (e: any) {
      showToast?.(String(e), true)
    }
  }

  async function deleteKey(id: number) {
    try {
      await invoke("delete_ssh_key", { id })
      await loadKeys()
      showToast?.(t("delete", lang) || "Deleted")
    } catch (e: any) {
      showToast?.(String(e), true)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl h-[520px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl overflow-hidden flex flex-col">
        <div className="min-h-[52px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div>
            <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
              {t("keyManager", lang)}
            </div>
            <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
              Manage stored SSH keys
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={generateKey} className="ui-btn">
              <Plus size={14} />
              {t("add", lang) || "New"}
            </button>
            <button onClick={onClose} className="ui-icon-btn" title={t("close", lang)}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-[color-mix(in_srgb,var(--bg-app)_96%,black)]">
          {keys.length === 0 ? (
            <div className="ui-muted-box">
              No SSH keys yet
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {keys.map((k: any) => (
                <div
                  key={k.id}
                  className="ui-panel"
                  style={{ borderRadius: 14, padding: 12, boxShadow: "none" }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          lineHeight: 1.25,
                          fontWeight: 700,
                          color: "var(--text-main)"
                        }}
                      >
                        <KeyRound size={14} />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {k.name}
                        </span>
                      </div>

                      <div className="ui-subtitle" style={{ marginTop: 6 }}>
                        {k.key_type || "ssh"}
                      </div>

                      {k.private_key_path ? (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            lineHeight: 1.45,
                            color: "var(--text-muted)",
                            wordBreak: "break-word"
                          }}
                        >
                          {k.private_key_path}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {k.public_key ? (
                        <button onClick={() => copyPublicKey(k.public_key)} className="ui-icon-btn" title={t("copy", lang)}>
                          <Copy size={14} />
                        </button>
                      ) : null}

                      <button onClick={() => deleteKey(k.id)} className="ui-icon-btn" title={t("delete", lang)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-end">
          <button onClick={onClose} className="ui-btn-ghost">
            {t("close", lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
