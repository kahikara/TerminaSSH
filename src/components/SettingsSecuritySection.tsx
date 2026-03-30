import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { CSSProperties } from "react"
import { Download, Copy, X } from "lucide-react"

type VaultStatus = {
  is_initialized?: boolean
  is_protected?: boolean
  is_unlocked?: boolean
  unlock_mode?: string
  has_legacy_master_key?: boolean
}

type EnableVaultProtectionResult = {
  recovery_key?: string
  migrated_secret_entries?: number
}

type SettingsSecuritySectionProps = {
  lang: string
  ui: any
  showToast: (msg: string, isErr?: boolean) => void
  showDialog: any
  cardStyle: CSSProperties
  uniformSelectStyle: CSSProperties
  primaryBtnStyle: CSSProperties
  actionBtnStyle: CSSProperties
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap"
}

const badgeBaseStyle: CSSProperties = {
  minHeight: 24,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid var(--border-subtle)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700
}

const RECOVERY_KEY_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/

export default function SettingsSecuritySection({
  lang,
  ui,
  showToast,
  showDialog,
  cardStyle,
  uniformSelectStyle,
  primaryBtnStyle,
  actionBtnStyle
}: SettingsSecuritySectionProps) {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [unlockMode, setUnlockMode] = useState<"demand" | "startup">("demand")
  const [savedUnlockMode, setSavedUnlockMode] = useState<"demand" | "startup">("demand")
  const [recoveryDialog, setRecoveryDialog] = useState<{
    isOpen: boolean
    key: string
    migrated: number
  }>({
    isOpen: false,
    key: "",
    migrated: 0
  })

  const isProtected = Boolean(vaultStatus?.is_protected)
  const isUnlocked = Boolean(vaultStatus?.is_unlocked)

  const statusToneStyle = useMemo<CSSProperties>(() => {
    if (!isProtected) {
      return {
        ...badgeBaseStyle,
        background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))",
        color: "var(--text-muted)"
      }
    }

    if (isUnlocked) {
      return {
        ...badgeBaseStyle,
        background: "color-mix(in srgb, var(--accent) 18%, var(--bg-app))",
        border: "1px solid color-mix(in srgb, var(--accent) 34%, var(--border-subtle))",
        color: "var(--accent)"
      }
    }

    return {
      ...badgeBaseStyle,
      background: "color-mix(in srgb, var(--danger) 12%, var(--bg-app))",
      border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border-subtle))",
      color: "var(--danger)"
    }
  }, [isProtected, isUnlocked])

  const normalizeRecoveryKey = (value: string) =>
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z2-9-]/g, "")

  const extractRecoveryKeyFromText = (content: string) => {
    const directMatch = content.match(/Recovery Key:\s*([A-Z2-9-]+)/i)
    if (directMatch?.[1]) {
      return normalizeRecoveryKey(directMatch[1])
    }

    return normalizeRecoveryKey(content)
  }

  const refreshStatus = async (showSuccess = false) => {
    try {
      const status = await invoke("get_vault_status") as VaultStatus
      setVaultStatus(status || {})
      const nextMode =
        String(status?.unlock_mode || "demand").toLowerCase() === "startup"
          ? "startup"
          : "demand"
      setUnlockMode(nextMode)
      setSavedUnlockMode(nextMode)

      if (showSuccess) {
        showToast(
          lang === "de"
            ? "Vault Status aktualisiert"
            : "Vault status refreshed"
        )
      }
    } catch (e) {
      showToast(
        lang === "de"
          ? `Vault Status konnte nicht geladen werden: ${String(e)}`
          : `Could not load vault status: ${String(e)}`,
        true
      )
    }
  }

  useEffect(() => {
    void refreshStatus(false)
  }, [])

  useEffect(() => {
    if (!recoveryDialog.isOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      setRecoveryDialog({ isOpen: false, key: "", migrated: 0 })
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [recoveryDialog.isOpen])

  const showRecoveryKeyDialog = (key: string, migrated = 0) => {
    setRecoveryDialog({
      isOpen: true,
      key,
      migrated
    })
  }

  const copyRecoveryKey = async () => {
    try {
      try {
        await invoke("copy_text_to_clipboard", { text: recoveryDialog.key })
      } catch {
        await navigator.clipboard.writeText(recoveryDialog.key)
      }
      showToast(ui.securityRecoveryCopied)
    } catch (e) {
      showToast(
        lang === "de"
          ? `Recovery Key konnte nicht kopiert werden: ${String(e)}`
          : `Could not copy recovery key: ${String(e)}`,
        true
      )
    }
  }

  const downloadRecoveryKey = async () => {
    try {
      const fileName = "termina-ssh-recovery-key.txt"
      const content = [
        "Termina SSH Recovery Key",
        "",
        `Recovery Key: ${recoveryDialog.key}`,
        `Migrated secret entries: ${recoveryDialog.migrated}`,
        "",
        "Store this file in a safe place."
      ].join("\n")

      const path = await save({
        defaultPath: fileName
      })

      if (!path) return

      await writeTextFile(String(path), content)

      showToast(
        lang === "de" ? "Recovery Key gespeichert" : "Recovery key saved"
      )
    } catch (e) {
      showToast(
        lang === "de"
          ? `Recovery Key konnte nicht gespeichert werden: ${String(e)}`
          : `Could not save recovery key: ${String(e)}`,
        true
      )
    }
  }

  const saveUnlockMode = async () => {
    setBusy(true)
    try {
      await invoke("update_vault_unlock_mode", { unlockMode })
      await refreshStatus(false)
      showToast(
        lang === "de"
          ? "Unlock Mode gespeichert"
          : "Unlock mode saved"
      )
    } catch (e) {
      showToast(
        lang === "de"
          ? `Unlock Mode konnte nicht gespeichert werden: ${String(e)}`
          : `Could not save unlock mode: ${String(e)}`,
        true
      )
    } finally {
      setBusy(false)
    }
  }

  const enableProtection = () => {
    showDialog({
      type: "prompt",
      title: ui.securityEnableTitle,
      description: `${ui.securityEnableDesc}\n\n${ui.securityRecoveryHint}`,
      placeholder: ui.securityMasterPasswordPlaceholder,
      confirmPlaceholder: ui.securityMasterPasswordConfirmPlaceholder,
      isPassword: true,
      requireConfirm: true,
      confirmLabel: ui.securityEnableAction,
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string, confirmValue: string) => {
        if (!value.trim()) return ui.securityMasterPasswordEmpty
        if (value.length < 6) return ui.securityMasterPasswordTooShort
        if (value !== confirmValue) return ui.securityMasterPasswordMismatch
        return ""
      },
      onConfirm: async (value: string) => {
        setBusy(true)
        try {
          const result = await invoke("enable_vault_protection", {
            masterPassword: value,
            unlockMode
          }) as EnableVaultProtectionResult

          await refreshStatus(false)

          showRecoveryKeyDialog(
            String(result?.recovery_key || ""),
            Number(result?.migrated_secret_entries || 0)
          )

          showToast(ui.securityEnabledToast)
        } catch (e) {
          showToast(
            lang === "de"
              ? `Vault Schutz konnte nicht aktiviert werden: ${String(e)}`
              : `Could not enable vault protection: ${String(e)}`,
            true
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const unlockVault = () => {
    showDialog({
      type: "prompt",
      title: ui.securityUnlockTitle,
      description: ui.securityUnlockDesc,
      placeholder: ui.securityMasterPasswordPlaceholder,
      isPassword: true,
      confirmLabel: ui.securityUnlockAction,
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      onConfirm: async (value: string) => {
        if (!value.trim()) return

        setBusy(true)
        try {
          await invoke("unlock_vault", { masterPassword: value })
          await refreshStatus(false)
          showToast(ui.securityUnlockedToast)
        } catch (e) {
          showToast(
            lang === "de"
              ? `Vault konnte nicht entsperrt werden: ${String(e)}`
              : `Could not unlock vault: ${String(e)}`,
            true
          )
          throw e
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const lockVault = async () => {
    setBusy(true)
    try {
      await invoke("lock_vault")
      await refreshStatus(false)
      showToast(ui.securityLockedToast)
    } catch (e) {
      showToast(
        lang === "de"
          ? `Vault konnte nicht gesperrt werden: ${String(e)}`
          : `Could not lock vault: ${String(e)}`,
        true
      )
    } finally {
      setBusy(false)
    }
  }

  const disableProtection = () => {
    if (!isUnlocked) {
      showToast(
        lang === "de"
          ? "Zum Deaktivieren muss der Vault zuerst entsperrt werden"
          : "Unlock the vault first to disable protection",
        true
      )
      return
    }

    showDialog({
      type: "confirm",
      tone: "danger",
      title: lang === "de" ? "Schutz deaktivieren" : "Disable protection",
      description:
        lang === "de"
          ? "Der Master Passwort Schutz wird entfernt. Secrets bleiben weiter in vault.db, aber die App funktioniert danach wieder ohne Unlock."
          : "Master password protection will be removed. Secrets stay in vault.db, but the app will work again without unlocking.",
      confirmLabel: lang === "de" ? "Deaktivieren" : "Disable",
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      onConfirm: async () => {
        setBusy(true)
        try {
          await invoke("disable_vault_protection")
          await refreshStatus(false)
          showToast(
            lang === "de"
              ? "Vault Schutz deaktiviert"
              : "Vault protection disabled"
          )
        } catch (e) {
          showToast(
            lang === "de"
              ? `Vault Schutz konnte nicht deaktiviert werden: ${String(e)}`
              : `Could not disable vault protection: ${String(e)}`,
            true
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const regenerateRecoveryKey = () => {
    if (!isUnlocked) {
      showToast(
        lang === "de"
          ? "Zum Erzeugen eines neuen Recovery Keys muss der Vault entsperrt sein"
          : "Unlock the vault first to generate a new recovery key",
        true
      )
      return
    }

    showDialog({
      type: "confirm",
      title: lang === "de" ? "Neuen Recovery Key erzeugen" : "Generate new recovery key",
      description:
        lang === "de"
          ? "Der bisherige Recovery Key wird ersetzt. Speichere den neuen Key danach unbedingt."
          : "The current recovery key will be replaced. Make sure you save the new key afterwards.",
      confirmLabel: lang === "de" ? "Erzeugen" : "Generate",
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      onConfirm: async () => {
        setBusy(true)
        try {
          const result = await invoke("regenerate_vault_recovery_key") as EnableVaultProtectionResult
          await refreshStatus(false)
          showRecoveryKeyDialog(String(result?.recovery_key || ""), 0)
          showToast(
            lang === "de"
              ? "Neuer Recovery Key erzeugt"
              : "New recovery key generated"
          )
        } catch (e) {
          showToast(
            lang === "de"
              ? `Recovery Key konnte nicht erzeugt werden: ${String(e)}`
              : `Could not generate recovery key: ${String(e)}`,
            true
          )
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const beginRecoveryResetWithKey = (normalizedRecoveryKey: string) => {
    showDialog({
      type: "prompt",
      title: lang === "de" ? "Neues Master Passwort" : "New master password",
      description:
        lang === "de"
          ? "Setze jetzt ein neues Master Passwort. Dabei wird auch ein neuer Recovery Key erstellt."
          : "Set a new master password now. A new recovery key will be created as well.",
      placeholder: ui.securityMasterPasswordPlaceholder,
      confirmPlaceholder: ui.securityMasterPasswordConfirmPlaceholder,
      isPassword: true,
      requireConfirm: true,
      confirmLabel: lang === "de" ? "Zurücksetzen" : "Reset",
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string, confirmValue: string) => {
        if (!value.trim()) return ui.securityMasterPasswordEmpty
        if (value.length < 6) return ui.securityMasterPasswordTooShort
        if (value !== confirmValue) return ui.securityMasterPasswordMismatch
        return ""
      },
      onConfirm: async (value: string) => {
        setBusy(true)
        try {
          const result = await invoke("reset_vault_master_password_with_recovery_key", {
            recoveryKey: normalizedRecoveryKey,
            newMasterPassword: value
          }) as EnableVaultProtectionResult

          await refreshStatus(false)

          showRecoveryKeyDialog(String(result?.recovery_key || ""), 0)

          showToast(
            lang === "de"
              ? "Master Passwort mit Recovery Key zurückgesetzt"
              : "Master password reset with recovery key"
          )
        } catch (e) {
          showToast(
            lang === "de"
              ? `Recovery Reset fehlgeschlagen: ${String(e)}`
              : `Recovery reset failed: ${String(e)}`,
            true
          )
          throw e
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const startRecoveryReset = () => {
    showDialog({
      type: "prompt",
      title: lang === "de" ? "Recovery Key eingeben" : "Enter recovery key",
      description:
        lang === "de"
          ? "Gib deinen Recovery Key im Format ABCD-EFGH-IJKL-MNOP-QRST ein, um ein neues Master Passwort zu setzen."
          : "Enter your recovery key in the format ABCD-EFGH-IJKL-MNOP-QRST to set a new master password.",
      placeholder: "ABCD-EFGH-IJKL-MNOP-QRST",
      confirmLabel: lang === "de" ? "Weiter" : "Continue",
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string) => {
        const normalized = normalizeRecoveryKey(value)
        if (!normalized) {
          return lang === "de"
            ? "Recovery Key ist erforderlich"
            : "Recovery key is required"
        }
        if (!RECOVERY_KEY_PATTERN.test(normalized)) {
          return lang === "de"
            ? "Ungültiges Recovery Key Format"
            : "Invalid recovery key format"
        }
        return ""
      },
      onConfirm: async (recoveryKey: string) => {
        const normalized = normalizeRecoveryKey(recoveryKey)
        if (!RECOVERY_KEY_PATTERN.test(normalized)) {
          showToast(
            lang === "de"
              ? "Ungültiges Recovery Key Format"
              : "Invalid recovery key format",
            true
          )
          throw new Error("Invalid recovery key format")
        }

        beginRecoveryResetWithKey(normalized)
      }
    })
  }

  const importRecoveryKeyFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Text", extensions: ["txt"] },
          { name: "All", extensions: ["*"] }
        ]
      })

      if (!selected) return

      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return

      const content = await readTextFile(String(path))
      const normalized = extractRecoveryKeyFromText(content)

      if (!RECOVERY_KEY_PATTERN.test(normalized)) {
        showToast(
          lang === "de"
            ? "In der Datei wurde kein gültiger Recovery Key gefunden"
            : "No valid recovery key was found in the file",
          true
        )
        return
      }

      beginRecoveryResetWithKey(normalized)
    } catch (e) {
      showToast(
        lang === "de"
          ? `Recovery Datei konnte nicht importiert werden: ${String(e)}`
          : `Could not import recovery file: ${String(e)}`,
        true
      )
    }
  }

  const statusLabel = !isProtected
    ? ui.securityStatusOff
    : isUnlocked
    ? ui.securityStatusUnlocked
    : ui.securityStatusLocked

  const modeLabel = unlockMode === "startup" ? ui.securityModeStartup : ui.securityModeDemand

  return (
    <>
      <div style={cardStyle}>
        <div className="text-[14px] font-semibold text-[var(--text-main)]">
          {ui.securityTitle}
        </div>
        <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
          {ui.securityDesc}
        </div>

        <div style={{ ...rowStyle, marginTop: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-[12px] font-semibold text-[var(--text-main)]">
              {ui.securityStatusLabel}
            </div>
            <div className="text-[12px] text-[var(--text-muted)] mt-1">
              {isProtected ? ui.securityProtectedDesc : ui.securityNotProtectedDesc}
            </div>
          </div>

          <span style={statusToneStyle}>
            {statusLabel}
          </span>
        </div>

        <div style={{ ...rowStyle, marginTop: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-[12px] font-semibold text-[var(--text-main)]">
              {ui.securityModeLabel}
            </div>
            <div className="text-[12px] text-[var(--text-muted)] mt-1">
              {ui.securityCurrentModeDesc}
            </div>
          </div>

          <span
            style={{
              ...badgeBaseStyle,
              background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))",
              color: "var(--text-main)"
            }}
          >
            {modeLabel}
          </span>
        </div>

        {vaultStatus?.has_legacy_master_key ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, var(--danger) 22%, var(--border-subtle))",
              background: "color-mix(in srgb, var(--danger) 8%, var(--bg-app))",
              padding: 12
            }}
          >
            <div className="text-[12px] font-semibold text-[var(--text-main)]">
              {ui.securityLegacyTitle}
            </div>
            <div className="text-[12px] leading-[1.5] text-[var(--text-muted)] mt-1">
              {ui.securityLegacyDesc}
            </div>
          </div>
        ) : null}
      </div>

      {!isProtected && (
        <div style={cardStyle}>
          <div className="text-[13px] font-semibold text-[var(--text-main)]">
            {ui.securitySetupTitle}
          </div>
          <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
            {ui.securitySetupDesc}
          </div>

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="text-[12px] font-semibold text-[var(--text-main)]">
              {ui.securityModeLabel}
            </label>
            <select
              value={unlockMode}
              onChange={(e) => setUnlockMode(e.target.value === "startup" ? "startup" : "demand")}
              style={uniformSelectStyle}
              disabled={busy}
            >
              <option value="demand">{ui.securityModeDemand}</option>
              <option value="startup">{ui.securityModeStartup}</option>
            </select>
            <div className="text-[12px] text-[var(--text-muted)]">
              {unlockMode === "startup" ? ui.securityModeStartupDesc : ui.securityModeDemandDesc}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void refreshStatus(true)}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.refreshLabel}
            </button>

            <button
              type="button"
              onClick={enableProtection}
              style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.securityEnableAction}
            </button>
          </div>
        </div>
      )}

      {isProtected && (
        <div style={cardStyle}>
          <div className="text-[13px] font-semibold text-[var(--text-main)]">
            {ui.securityActionsTitle}
          </div>
          <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
            {isUnlocked ? ui.securityActionsUnlockedDesc : ui.securityActionsLockedDesc}
          </div>

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="text-[12px] font-semibold text-[var(--text-main)]">
              {ui.securityModeLabel}
            </label>
            <select
              value={unlockMode}
              onChange={(e) => setUnlockMode(e.target.value === "startup" ? "startup" : "demand")}
              style={uniformSelectStyle}
              disabled={busy}
            >
              <option value="demand">{ui.securityModeDemand}</option>
              <option value="startup">{ui.securityModeStartup}</option>
            </select>
            <div className="text-[12px] text-[var(--text-muted)]">
              {unlockMode === "startup" ? ui.securityModeStartupDesc : ui.securityModeDemandDesc}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void refreshStatus(true)}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.refreshLabel}
            </button>

            <button
              type="button"
              onClick={() => void saveUnlockMode()}
              style={{ ...actionBtnStyle, opacity: busy || unlockMode === savedUnlockMode ? 0.7 : 1 }}
              disabled={busy || unlockMode === savedUnlockMode}
            >
              {lang === "de" ? "Mode speichern" : "Save mode"}
            </button>

            <button
              type="button"
              onClick={() => void importRecoveryKeyFile()}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {lang === "de" ? "Recovery Datei" : "Recovery file"}
            </button>

            <button
              type="button"
              onClick={startRecoveryReset}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {lang === "de" ? "Recovery Reset" : "Recovery reset"}
            </button>

            {isUnlocked && (
              <button
                type="button"
                onClick={regenerateRecoveryKey}
                style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                disabled={busy}
              >
                {lang === "de" ? "Neuer Recovery Key" : "New recovery key"}
              </button>
            )}

            {!isUnlocked ? (
              <button
                type="button"
                onClick={unlockVault}
                style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}
                disabled={busy}
              >
                {ui.securityUnlockAction}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void lockVault()}
                  style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {ui.securityLockAction}
                </button>

                <button
                  type="button"
                  onClick={disableProtection}
                  style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Schutz deaktivieren" : "Disable protection"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {recoveryDialog.isOpen && (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setRecoveryDialog({ isOpen: false, key: "", migrated: 0 })
            }
          }}
        >
          <div
            className="w-full max-w-[560px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="min-h-[52px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
              <div className="text-[14px] font-bold text-[var(--text-main)]">
                {ui.securityRecoveryTitle}
              </div>

              <button
                type="button"
                onClick={() => setRecoveryDialog({ isOpen: false, key: "", migrated: 0 })}
                className="ui-icon-btn"
                title={ui.closeLabel}
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="text-[13px] leading-[1.5] text-[var(--text-muted)] whitespace-pre-line">
                {ui.securityRecoveryDesc}
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-3 py-3 text-[13px] font-semibold tracking-[0.04em] text-[var(--text-main)] break-all">
                {recoveryDialog.key}
              </div>

              <div className="text-[12px] text-[var(--text-muted)]">
                {ui.securityMigratedPrefix}: {recoveryDialog.migrated}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void copyRecoveryKey()}
                className="ui-btn-ghost inline-flex items-center gap-2"
              >
                <Copy size={14} />
                <span>{ui.copyLabel}</span>
              </button>

              <button
                type="button"
                onClick={() => void downloadRecoveryKey()}
                className="ui-btn-ghost inline-flex items-center gap-2"
              >
                <Download size={14} />
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={() => setRecoveryDialog({ isOpen: false, key: "", migrated: 0 })}
                className="ui-btn-primary"
              >
                {ui.closeLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
