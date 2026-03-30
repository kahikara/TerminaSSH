import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { CSSProperties } from "react"
import { Download, Copy, X, ChevronDown, ChevronRight } from "lucide-react"

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

const compactPanelStyle: CSSProperties = {
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-app) 86%, var(--bg-sidebar))",
  padding: 14
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
  const [showExtraOptions, setShowExtraOptions] = useState(false)
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

  const modeToneStyle = useMemo<CSSProperties>(() => {
    return {
      ...badgeBaseStyle,
      background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))",
      color: "var(--text-main)"
    }
  }, [])

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

  const refreshStatus = async () => {
    try {
      const status = await invoke("get_vault_status") as VaultStatus
      setVaultStatus(status || {})
      const nextMode =
        String(status?.unlock_mode || "demand").toLowerCase() === "startup"
          ? "startup"
          : "demand"
      setUnlockMode(nextMode)
      setSavedUnlockMode(nextMode)
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
    void refreshStatus()
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

  const applyUnlockModeChange = async (nextMode: "demand" | "startup") => {
    setUnlockMode(nextMode)

    if (!isProtected) {
      return
    }

    if (nextMode === savedUnlockMode) {
      return
    }

    setBusy(true)
    try {
      await invoke("update_vault_unlock_mode", { unlockMode: nextMode })
      await refreshStatus()
      showToast(
        lang === "de"
          ? "Unlock Mode gespeichert"
          : "Unlock mode saved"
      )
    } catch (e) {
      setUnlockMode(savedUnlockMode)
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

          await refreshStatus()

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
          await refreshStatus()
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
      await refreshStatus()
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

  const changeMasterPassword = () => {
    if (!isUnlocked) {
      showToast(
        lang === "de"
          ? "Zum Ändern des Master Passworts muss der Vault entsperrt sein"
          : "Unlock the vault first to change the master password",
        true
      )
      return
    }

    showDialog({
      type: "prompt",
      title: lang === "de" ? "Aktuelles Master Passwort" : "Current master password",
      description:
        lang === "de"
          ? "Gib zuerst dein aktuelles Master Passwort ein."
          : "Enter your current master password first.",
      placeholder: ui.securityMasterPasswordPlaceholder,
      isPassword: true,
      confirmLabel: lang === "de" ? "Weiter" : "Continue",
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string) => {
        if (!value.trim()) {
          return lang === "de"
            ? "Aktuelles Master Passwort ist erforderlich"
            : "Current master password is required"
        }
        return ""
      },
      onConfirm: async (currentValue: string) => {
        const currentMasterPassword = String(currentValue || "")

        showDialog({
          type: "prompt",
          title: lang === "de" ? "Neues Master Passwort" : "New master password",
          description:
            lang === "de"
              ? "Setze jetzt dein neues Master Passwort."
              : "Set your new master password now.",
          placeholder: ui.securityMasterPasswordPlaceholder,
          confirmPlaceholder: ui.securityMasterPasswordConfirmPlaceholder,
          isPassword: true,
          requireConfirm: true,
          confirmLabel: lang === "de" ? "Ändern" : "Change",
          cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
          validate: (value: string, confirmValue: string) => {
            if (!value.trim()) return ui.securityMasterPasswordEmpty
            if (value.length < 6) return ui.securityMasterPasswordTooShort
            if (value !== confirmValue) return ui.securityMasterPasswordMismatch
            if (value === currentMasterPassword) {
              return lang === "de"
                ? "Das neue Master Passwort muss sich unterscheiden"
                : "The new master password must be different"
            }
            return ""
          },
          onConfirm: async (newValue: string) => {
            setBusy(true)
            try {
              await invoke("change_vault_master_password", {
                currentMasterPassword,
                newMasterPassword: newValue
              })
              await refreshStatus()
              showToast(
                lang === "de"
                  ? "Master Passwort geändert"
                  : "Master password changed"
              )
            } catch (e) {
              showToast(
                lang === "de"
                  ? `Master Passwort konnte nicht geändert werden: ${String(e)}`
                  : `Could not change master password: ${String(e)}`,
                true
              )
              throw e
            } finally {
              setBusy(false)
            }
          }
        })
      }
    })
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
          await refreshStatus()
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
          await refreshStatus()
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

          await refreshStatus()
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
        <div
          style={{
            ...rowStyle,
            alignItems: "flex-start",
            justifyContent: "space-between"
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="text-[14px] font-semibold text-[var(--text-main)]">
              {ui.securityTitle}
            </div>
            <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
              {ui.securityDesc}
            </div>
          </div>

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
            {lang === "de" ? "Schutz aktivieren" : "Enable protection"}
          </div>
          <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
            {lang === "de"
              ? "Lege dein Master Passwort fest und entscheide, wann der Vault entsperrt werden soll."
              : "Set your master password and choose when the vault should be unlocked."}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto",
              gap: 10,
              alignItems: "end"
            }}
          >
            <div style={{ minWidth: 0 }}>
              <label className="text-[12px] font-semibold text-[var(--text-main)]">
                {ui.securityModeLabel}
              </label>
              <select
                value={unlockMode}
                onChange={(e) => void applyUnlockModeChange(e.target.value === "startup" ? "startup" : "demand")}
                style={{ ...uniformSelectStyle, marginTop: 8 }}
                disabled={busy}
              >
                <option value="demand">{ui.securityModeDemand}</option>
                <option value="startup">{ui.securityModeStartup}</option>
              </select>
            </div>

            <button
              type="button"
              onClick={enableProtection}
              style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.securityEnableAction}
            </button>
          </div>

          <div className="text-[12px] text-[var(--text-muted)] mt-2">
            {unlockMode === "startup" ? ui.securityModeStartupDesc : ui.securityModeDemandDesc}
          </div>
        </div>
      )}

      {isProtected && (
        <div style={cardStyle}>
          <div
            style={{
              ...rowStyle,
              alignItems: "flex-start",
              justifyContent: "space-between"
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div className="text-[13px] font-semibold text-[var(--text-main)]">
                {lang === "de" ? "Sicherheit" : "Security"}
              </div>
              <div className="text-[12px] leading-[1.55] text-[var(--text-muted)] mt-1">
                {lang === "de"
                  ? "Die wichtigsten Dinge direkt sichtbar. Seltene Aktionen sind unten versteckt."
                  : "The important things stay visible. Rare actions are hidden below."}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "flex-end",
                flexWrap: "wrap",
                flex: "0 0 auto"
              }}
            >
              <span style={modeToneStyle}>{modeLabel}</span>
              <span style={statusToneStyle}>{statusLabel}</span>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10
            }}
          >
            <div style={compactPanelStyle}>
              <div className="text-[12px] font-semibold text-[var(--text-main)]">
                {lang === "de" ? "Vault" : "Vault"}
              </div>
              <div className="text-[12px] text-[var(--text-muted)] mt-1">
                {lang === "de"
                  ? "Entsperren zum Arbeiten oder wieder sperren."
                  : "Unlock for work or lock it again."}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
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
                  <button
                    type="button"
                    onClick={() => void lockVault()}
                    style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                    disabled={busy}
                  >
                    {ui.securityLockAction}
                  </button>
                )}
              </div>
            </div>

            <div style={compactPanelStyle}>
              <div className="text-[12px] font-semibold text-[var(--text-main)]">
                {lang === "de" ? "Startverhalten" : "Startup behavior"}
              </div>
              <div className="text-[12px] text-[var(--text-muted)] mt-1">
                {lang === "de"
                  ? "Wird sofort beim Umschalten gespeichert."
                  : "Saved immediately when changed."}
              </div>

              <select
                value={unlockMode}
                onChange={(e) => void applyUnlockModeChange(e.target.value === "startup" ? "startup" : "demand")}
                style={{ ...uniformSelectStyle, marginTop: 12 }}
                disabled={busy}
              >
                <option value="demand">{ui.securityModeDemand}</option>
                <option value="startup">{ui.securityModeStartup}</option>
              </select>

              <div className="text-[12px] text-[var(--text-muted)] mt-2">
                {unlockMode === "startup" ? ui.securityModeStartupDesc : ui.securityModeDemandDesc}
              </div>
            </div>

            <div style={compactPanelStyle}>
              <div className="text-[12px] font-semibold text-[var(--text-main)]">
                {lang === "de" ? "Master Passwort" : "Master password"}
              </div>
              <div className="text-[12px] text-[var(--text-muted)] mt-1">
                {lang === "de"
                  ? "Normaler Weg, wenn du dein Passwort kennst."
                  : "Normal path when you know your password."}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={changeMasterPassword}
                  style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Master Passwort ändern" : "Change master password"}
                </button>
              </div>
            </div>

            <div style={compactPanelStyle}>
              <div className="text-[12px] font-semibold text-[var(--text-main)]">
                {lang === "de" ? "Recovery Key" : "Recovery key"}
              </div>
              <div className="text-[12px] text-[var(--text-muted)] mt-1">
                {lang === "de"
                  ? "Wenn der Key fehlt, erzeugst du hier einfach einen neuen."
                  : "If the key is missing, just generate a new one here."}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={regenerateRecoveryKey}
                  style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Neuen Recovery Key" : "New recovery key"}
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
              paddingTop: 12
            }}
          >
            <button
              type="button"
              onClick={() => setShowExtraOptions((value) => !value)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer"
              }}
            >
              <div style={{ minWidth: 0, textAlign: "left" }}>
                <div className="text-[12px] font-semibold text-[var(--text-main)]">
                  {lang === "de" ? "Weitere Optionen" : "More options"}
                </div>
                <div className="text-[12px] text-[var(--text-muted)] mt-1">
                  {lang === "de"
                    ? "Notfall und seltene Aktionen."
                    : "Emergency and rare actions."}
                </div>
              </div>

              <span className="text-[var(--text-muted)]">
                {showExtraOptions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            </button>

            {showExtraOptions && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                <div style={compactPanelStyle}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Recovery Notfall" : "Recovery emergency"}
                  </div>
                  <div className="text-[12px] text-[var(--text-muted)] mt-1">
                    {lang === "de"
                      ? "Nur wenn du dein Master Passwort nicht mehr kennst."
                      : "Only if you no longer know your master password."}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => void importRecoveryKeyFile()}
                      style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                      disabled={busy}
                    >
                      {lang === "de" ? "Recovery Datei importieren" : "Import recovery file"}
                    </button>

                    <button
                      type="button"
                      onClick={startRecoveryReset}
                      style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                      disabled={busy}
                    >
                      {lang === "de" ? "Mit Recovery Key zurücksetzen" : "Reset with recovery key"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    ...compactPanelStyle,
                    border: "1px solid color-mix(in srgb, var(--danger) 20%, var(--border-subtle))"
                  }}
                >
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Schutz deaktivieren" : "Disable protection"}
                  </div>
                  <div className="text-[12px] text-[var(--text-muted)] mt-1">
                    {lang === "de"
                      ? "Optionaler Weg zurück ohne Master Passwort Schutz."
                      : "Optional path back without master password protection."}
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={disableProtection}
                      style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                      disabled={busy}
                    >
                      {lang === "de" ? "Schutz deaktivieren" : "Disable protection"}
                    </button>
                  </div>
                </div>
              </div>
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
