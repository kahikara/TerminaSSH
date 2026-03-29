import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { t } from "../lib/i18n"

type ToastFn = (msg: string, isErr?: boolean) => void

type DialogFn = (config: Record<string, unknown>) => void

type ConnectionForm = {
  name: string
  host: string
  port: string | number
  username: string
  password: string
  private_key: string
  passphrase: string
  group_name: string
}

type NormalizedConnectionForm = Omit<ConnectionForm, "port"> & {
  port: number
}

type EditableConnection = Partial<ConnectionForm> & {
  id: number | string
  name: string
  host?: string
  port?: number
  username?: string
  private_key?: string
  group_name?: string
}

type ConnectionModalProps = {
  isOpen: boolean
  onClose: () => void
  serverToEdit: EditableConnection | null
  initialConnection?: Partial<ConnectionForm> | null
  onSuccess: () => void | Promise<void>
  showToast: ToastFn
  showDialog: DialogFn
  globalDialogOpen?: boolean
  lang: string
}

type ConnectionTestResult = {
  success: boolean
  auth_ok: boolean
  sftp_ok: boolean
  host_key_status: string
  key_type: string
  fingerprint: string
  message: string
}

export default function ConnectionModal({
  isOpen,
  onClose,
  serverToEdit,
  initialConnection = null,
  onSuccess,
  showToast,
  showDialog,
  globalDialogOpen = false,
  lang
}: ConnectionModalProps) {
  const [form, setForm] = useState<ConnectionForm>({
    name: "",
    host: "",
    port: "22",
    username: "",
    password: "",
    private_key: "",
    passphrase: "",
    group_name: ""
  })
  const [clearStoredPassword, setClearStoredPassword] = useState(false)
  const [clearStoredPassphrase, setClearStoredPassphrase] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

  useEffect(() => {
    setClearStoredPassword(false)
    setClearStoredPassphrase(false)

    if (serverToEdit) {
      setForm({
        name: String(serverToEdit.name || ""),
        host: String(serverToEdit.host || ""),
        port: String(Number(serverToEdit.port) || 22),
        username: String(serverToEdit.username || ""),
        password: "",
        private_key: String(serverToEdit.private_key || ""),
        passphrase: "",
        group_name: String(serverToEdit.group_name || "")
      })
      return
    }

    if (initialConnection) {
      setForm({
        name: String(initialConnection.name || ""),
        host: String(initialConnection.host || ""),
        port: String(Number(initialConnection.port) || 22),
        username: String(initialConnection.username || ""),
        password: String(initialConnection.password || ""),
        private_key: String(initialConnection.private_key || ""),
        passphrase: String(initialConnection.passphrase || ""),
        group_name: String(initialConnection.group_name || "")
      })
      return
    }

    setForm({ name: "", host: "", port: "22", username: "", password: "", private_key: "", passphrase: "", group_name: "" })
  }, [serverToEdit, initialConnection, isOpen])

  if (!isOpen) return null

  function buildNormalizedForm(): NormalizedConnectionForm {
    const parsedPort = parseInt(String(form.port || "22").trim() || "22", 10)

    return {
      ...form,
      name: String(form.name || "").trim(),
      host: String(form.host || "").trim(),
      port: Number.isFinite(parsedPort) ? parsedPort : 22,
      username: String(form.username || "").trim(),
      private_key: String(form.private_key || "").trim(),
      passphrase: String(form.passphrase || ""),
      group_name: String(form.group_name || "").trim()
    }
  }

  function getValidationError(normalizedForm: NormalizedConnectionForm) {
    if (!normalizedForm.name) {
      return lang === "de" ? "Name fehlt" : "Name is required"
    }

    if (!normalizedForm.host) {
      return lang === "de" ? "Host fehlt" : "Host is required"
    }

    if (!normalizedForm.username) {
      return lang === "de" ? "Benutzername fehlt" : "Username is required"
    }

    if (!Number.isInteger(normalizedForm.port) || normalizedForm.port < 1 || normalizedForm.port > 65535) {
      return lang === "de" ? "Port muss zwischen 1 und 65535 liegen" : "Port must be between 1 and 65535"
    }

    return ""
  }

  function formatHostKeyStatus(status: string) {
    if (lang === "de") {
      if (status === "match") return "bekannt und passend"
      if (status === "not_found") return "neu oder noch nicht gespeichert"
      if (status === "mismatch") return "geändert"
      return "unbekannt"
    }

    if (status === "match") return "known and matching"
    if (status === "not_found") return "new or not stored yet"
    if (status === "mismatch") return "changed"
    return "unknown"
  }

  async function handleTestConnection() {
    const normalizedForm = buildNormalizedForm()
    const validationError = getValidationError(normalizedForm)

    if (validationError) {
      showToast(validationError, true)
      return
    }

    setTestBusy(true)

    try {
      const result = await invoke("test_connection", {
        connection: normalizedForm,
        checkSftp: true
      }) as ConnectionTestResult

      const okText = lang === "de" ? "OK" : "OK"
      const failText = lang === "de" ? "Fehlgeschlagen" : "Failed"

      showDialog({
        type: "alert",
        title: result.success
          ? (lang === "de" ? "Verbindungstest erfolgreich" : "Connection test successful")
          : (lang === "de" ? "Verbindungstest fehlgeschlagen" : "Connection test failed"),
        description: [
          result.message,
          "",
          `Host: ${normalizedForm.host}:${normalizedForm.port}`,
          `${lang === "de" ? "Benutzer" : "User"}: ${normalizedForm.username}`,
          `${lang === "de" ? "Host Key Status" : "Host key status"}: ${formatHostKeyStatus(result.host_key_status)}`,
          `${lang === "de" ? "Typ" : "Type"}: ${result.key_type}`,
          `Fingerprint: ${result.fingerprint}`,
          `${lang === "de" ? "Authentifizierung" : "Authentication"}: ${result.auth_ok ? okText : failText}`,
          `SFTP: ${result.sftp_ok ? okText : failText}`
        ].join("\n"),
        confirmLabel: "OK",
        onConfirm: () => {}
      })
    } catch (e) {
      showToast(
        lang === "de"
          ? `Verbindungstest fehlgeschlagen: ${String(e)}`
          : `Connection test failed: ${String(e)}`,
        true
      )
    } finally {
      setTestBusy(false)
    }
  }

  async function handleSave() {
    if (saveBusy) return

    const normalizedForm = buildNormalizedForm()
    const validationError = getValidationError(normalizedForm)

    if (validationError) {
      showToast(validationError, true)
      return
    }

    setSaveBusy(true)

    try {
      if (serverToEdit) {
        await invoke("update_connection", {
          id: serverToEdit.id,
          oldName: serverToEdit.name,
          connection: normalizedForm,
          clearPassword: clearStoredPassword,
          clearPassphrase: clearStoredPassphrase
        })
      } else {
        await invoke("save_connection", { connection: normalizedForm })
      }
      await Promise.resolve(onSuccess())
      onClose()
    } catch (e) {
      showToast(String(e), true)
    } finally {
      setSaveBusy(false)
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
    if (!serverToEdit) return

    const serverId = serverToEdit.id
    const serverName = serverToEdit.name

    showDialog({
      type: "confirm",
      tone: "danger",
      title: lang === "de" ? "Verbindung löschen" : "Delete connection",
      description:
        lang === "de"
          ? `Der gespeicherte Servereintrag "${serverName}" wird entfernt.`
          : `This removes the saved server entry "${serverName}".`,
      confirmLabel: lang === "de" ? "Löschen" : "Delete",
      cancelLabel: lang === "de" ? "Abbrechen" : "Cancel",
      onConfirm: async () => {
        if (saveBusy) return

        setSaveBusy(true)

        try {
          await invoke("delete_connection", { id: serverId, name: serverName })
          await Promise.resolve(onSuccess())
          onClose()
        } catch (e) {
          showToast(String(e), true)
        } finally {
          setSaveBusy(false)
        }
      }
    })
  }

  const normalizedForm = buildNormalizedForm()
  const canSave =
    Boolean(normalizedForm.name) &&
    Boolean(normalizedForm.host) &&
    Boolean(normalizedForm.username) &&
    Number.isInteger(normalizedForm.port) &&
    normalizedForm.port >= 1 &&
    normalizedForm.port <= 65535

  const fieldClass =
    "w-full h-9 px-3 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[var(--border-subtle)] outline-none focus:border-[var(--accent)] text-[13px] text-[var(--text-main)]"

  const mutedFieldWrap =
    "rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] p-3"

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${globalDialogOpen ? "bg-transparent backdrop-blur-0" : "bg-black/60 backdrop-blur-sm"}`}
      style={{ pointerEvents: globalDialogOpen ? "none" : "auto" }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl flex flex-col"
        style={{
          opacity: globalDialogOpen ? 0.72 : 1,
          transform: globalDialogOpen ? "scale(0.985)" : "scale(1)",
          transition: "opacity 140ms ease, transform 140ms ease"
        }}
      >
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
                  required
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
                  required
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("port", lang)}</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => {
                    const next = e.target.value
                    if (next === "" || /^\d+$/.test(next)) {
                      setForm({ ...form, port: next })
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseInt(String(form.port || "22").trim() || "22", 10)
                    setForm({
                      ...form,
                      port: String(Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 22)
                    })
                  }}
                  className={fieldClass}
                  min={1}
                  max={65535}
                  required
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("username", lang)}</span>
                <input
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  className={fieldClass}
                  required
                />
              </label>

              <label className="col-span-1 block">
                <span className="ui-label">{t("password", lang)}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => {
                    setClearStoredPassword(false)
                    setForm({ ...form, password: e.target.value })
                  }}
                  className={fieldClass}
                />
                {serverToEdit && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>{lang === "de" ? "Leer lassen = behalten" : "Leave empty = keep current"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setForm({ ...form, password: "" })
                        setClearStoredPassword((prev) => !prev)
                      }}
                      className="text-[var(--accent)] hover:text-[var(--text-main)] transition-colors"
                    >
                      {clearStoredPassword
                        ? (lang === "de" ? "Löschen aktiv" : "Clear active")
                        : (lang === "de" ? "Gespeichertes Passwort löschen" : "Clear saved password")}
                    </button>
                  </div>
                )}
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
                onChange={e => {
                  setClearStoredPassphrase(false)
                  setForm({ ...form, passphrase: e.target.value })
                }}
                className={fieldClass}
              />
              {serverToEdit && (
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>{lang === "de" ? "Leer lassen = behalten" : "Leave empty = keep current"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, passphrase: "" })
                      setClearStoredPassphrase((prev) => !prev)
                    }}
                    className="text-[var(--accent)] hover:text-[var(--text-main)] transition-colors"
                  >
                    {clearStoredPassphrase
                      ? (lang === "de" ? "Löschen aktiv" : "Clear active")
                      : (lang === "de" ? "Gespeicherte Passphrase löschen" : "Clear saved passphrase")}
                  </button>
                </div>
              )}
            </label>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-between items-center">
          {serverToEdit ? (
            <button onClick={handleDelete} className="ui-btn-ghost" style={{ color: "var(--danger)" }} disabled={saveBusy || testBusy}>
              {t("delete", lang)}
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={onClose} className="ui-btn-ghost" disabled={saveBusy}>
              {t("cancel", lang)}
            </button>
            <button
              onClick={() => void handleTestConnection()}
              className="ui-btn-ghost"
              disabled={!canSave || testBusy || saveBusy}
              aria-disabled={!canSave || testBusy || saveBusy}
              style={!canSave || testBusy || saveBusy ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              {testBusy ? (lang === "de" ? "Teste..." : "Testing...") : (lang === "de" ? "Testen" : "Test")}
            </button>
            <button
              onClick={() => void handleSave()}
              className="ui-btn-primary"
              disabled={!canSave || testBusy || saveBusy}
              aria-disabled={!canSave || testBusy || saveBusy}
              style={!canSave || testBusy || saveBusy ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              {saveBusy ? (lang === "de" ? "Speichere..." : "Saving...") : t("save", lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
