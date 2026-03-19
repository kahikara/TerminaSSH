import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { t } from "../lib/i18n"

export default function ConnectionModal({ isOpen, onClose, serverToEdit, onSuccess, showToast, showDialog, lang }: any) {
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    password: "",
    private_key: "",
    passphrase: "",
    group_name: ""
  })

  useEffect(() => {
    if (serverToEdit) setForm({ ...serverToEdit, password: "", passphrase: "" })
    else setForm({ name: "", host: "", port: 22, username: "", password: "", private_key: "", passphrase: "", group_name: "" })
  }, [serverToEdit, isOpen])

  if (!isOpen) return null

  async function handleSave() {
    try {
      if (serverToEdit) {
        await invoke("update_connection", {
          id: serverToEdit.id,
          oldName: serverToEdit.name,
          connection: form
        })
      } else {
        await invoke("save_connection", { connection: form })
      }
      onSuccess()
      onClose()
    } catch (e) {
      showToast(String(e), true)
    }
  }

  async function browsePrivateKey() {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        title: t("privateKey", lang)
      })

      if (typeof path === "string" && path) {
        setForm((prev) => ({ ...prev, private_key: path }))
      }
    } catch (e) {
      showToast(String(e), true)
    }
  }

  function handleDelete() {
    showDialog({
      type: "confirm",
      tone: "danger",
      title: lang === "de" ? "Verbindung löschen" : "Delete connection",
      description:
        lang === "de"
          ? `Der gespeicherte Servereintrag "${serverToEdit.name}" wird entfernt.`
          : `This removes the saved server entry "${serverToEdit.name}".`,
      confirmLabel: lang === "de" ? "Löschen" : "Delete",
      cancelLabel: lang === "de" ? "Abbrechen" : "Cancel",
      onConfirm: async () => {
        try {
          await invoke("delete_connection", { id: serverToEdit.id, name: serverToEdit.name })
          onSuccess()
          onClose()
        } catch (e) {
          showToast(String(e), true)
        }
      }
    })
  }

  const fieldClass =
    "w-full h-9 px-3 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[var(--border-subtle)] outline-none focus:border-[var(--accent)] text-[13px] text-[var(--text-main)]"

  const mutedFieldWrap =
    "rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] p-3"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl flex flex-col">
        <div className="min-h-[52px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div>
            <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
              {serverToEdit ? t("edit", lang) : t("newConn", lang)}
            </div>
            <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
              Connection settings
            </div>
          </div>

          <button onClick={onClose} className="ui-icon-btn" title={t("close", lang)}>
            <X size={15} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh] bg-[color-mix(in_srgb,var(--bg-app)_96%,black)] flex flex-col gap-4">
          <div className="ui-kicker">Connection</div>

          <div className={mutedFieldWrap}>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-1 block">
                <span className="ui-label">{t("name", lang)}</span>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className={`${fieldClass} min-w-0`}
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("group", lang)}</span>
                <input
                  value={form.group_name}
                  onChange={e => setForm({ ...form, group_name: e.target.value })}
                  className={fieldClass}
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("host", lang)}</span>
                <input
                  value={form.host}
                  onChange={e => setForm({ ...form, host: e.target.value })}
                  className={fieldClass}
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("port", lang)}</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => setForm({ ...form, port: parseInt(e.target.value || "22", 10) })}
                  className={fieldClass}
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("username", lang)}</span>
                <input
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  className={fieldClass}
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("password", lang)}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className={fieldClass}
                />
              </label>
            </div>
          </div>

          <div className="ui-kicker">Key Authentication</div>

          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="ui-label">{t("privateKey", lang)}</span>
              <div className="flex gap-2 min-w-0">
                <input
                  value={form.private_key}
                  onChange={e => setForm({ ...form, private_key: e.target.value })}
                  className={fieldClass}
                />
                <button type="button" onClick={browsePrivateKey} className="ui-btn" style={{ flexShrink: 0 }}>
                  Browse
                </button>
              </div>
            </label>

            <label className="block">
              <span className="ui-label">{t("passphrase", lang)}</span>
              <input
                type="password"
                value={form.passphrase}
                onChange={e => setForm({ ...form, passphrase: e.target.value })}
                className={fieldClass}
              />
            </label>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-between items-center">
          {serverToEdit ? (
            <button onClick={handleDelete} className="ui-btn-ghost" style={{ color: "var(--danger)" }}>
              {t("delete", lang)}
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={onClose} className="ui-btn-ghost">
              {t("cancel", lang)}
            </button>
            <button onClick={handleSave} className="ui-btn-primary">
              {t("save", lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
