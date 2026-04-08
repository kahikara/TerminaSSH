import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
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

const neutralBadgeStyle: CSSProperties = {
  ...badgeBaseStyle,
  background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))",
  color: "var(--text-muted)"
}

const compactRowStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-app) 86%, var(--bg-sidebar))",
  padding: "10px 12px",
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  alignItems: "center",
  gap: 10
}

const toolButtonStyle: CSSProperties = {
  minWidth: 96
}

const subtleBadgeStyle: CSSProperties = {
  minHeight: 20,
  padding: "0 8px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
  background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))",
  color: "var(--text-muted)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.02em"
}

export default function SettingsSecuritySection({
  lang,
  ui,
  showToast,
  showDialog,
  cardStyle,
  actionBtnStyle
}: SettingsSecuritySectionProps) {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [busy, setBusy] = useState(false)
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
  }, [isUnlocked])

  const refreshStatus = async () => {
    try {
      const status = await invoke("get_vault_status") as VaultStatus
      setVaultStatus(status || {})
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

  const ensureVaultUnlocked = (
    description: string,
    onUnlocked: (enteredMasterPassword?: string) => void | Promise<void>
  ) => {
    if (isUnlocked) {
      void onUnlocked()
      return
    }

    showDialog({
      type: "prompt",
      title: lang === "de" ? "Vault entsperren" : "Unlock vault",
      description,
      placeholder: ui.securityMasterPasswordPlaceholder,
      isPassword: true,
      confirmLabel: ui.securityUnlockAction,
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string) => {
        if (!value.trim()) {
          return lang === "de"
            ? "Master Passwort ist erforderlich"
            : "Master password is required"
        }
        return ""
      },
      onConfirm: async (value: string) => {
        setBusy(true)
        try {
          await invoke("unlock_vault", { masterPassword: value })
          await refreshStatus()
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

        await onUnlocked(value)
      }
    })
  }

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
            unlockMode: "startup"
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
              ? `Passwortschutz konnte nicht eingeschaltet werden: ${String(e)}`
              : `Could not turn on password protection: ${String(e)}`,
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
    const openNewPasswordDialog = (currentMasterPassword: string) => {
      showDialog({
        type: "prompt",
        title: lang === "de" ? "Neues Master Passwort" : "New master password",
        description:
          lang === "de"
            ? "Setze dein neues Master Passwort."
            : "Set your new master password.",
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

    const askForCurrentPassword = () => {
      showDialog({
        type: "prompt",
        title: lang === "de" ? "Aktuelles Master Passwort" : "Current master password",
        description:
          lang === "de"
            ? "Gib dein aktuelles Master Passwort ein."
            : "Enter your current master password.",
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
          openNewPasswordDialog(String(currentValue || ""))
        }
      })
    }

    ensureVaultUnlocked(
      lang === "de"
        ? "Gib dein Master Passwort ein, um es zu ändern."
        : "Enter your master password to change it.",
      (enteredMasterPassword) => {
        if (String(enteredMasterPassword || "").trim()) {
          openNewPasswordDialog(String(enteredMasterPassword))
          return
        }
        askForCurrentPassword()
      }
    )
  }

  const disableProtection = () => {
    const openDisableProtectionDialog = () => {
      showDialog({
        type: "confirm",
        tone: "danger",
        title: lang === "de" ? "Passwortschutz ausschalten" : "Turn off password protection",
        description:
          lang === "de"
            ? "Dein Vault bleibt erhalten. Danach funktioniert die App wieder ohne Passwortabfrage beim Start."
            : "Your vault stays in place. After this, the app works again without asking for a password at startup.",
        confirmLabel: lang === "de" ? "Ausschalten" : "Turn off",
        cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
        onConfirm: async () => {
          setBusy(true)
          try {
            await invoke("disable_vault_protection")
            await refreshStatus()
            showToast(
              lang === "de"
                ? "Passwortschutz ausgeschaltet"
                : "Password protection turned off"
            )
          } catch (e) {
            showToast(
              lang === "de"
                ? `Passwortschutz konnte nicht ausgeschaltet werden: ${String(e)}`
                : `Could not turn off password protection: ${String(e)}`,
              true
            )
          } finally {
            setBusy(false)
          }
        }
      })
    }

    ensureVaultUnlocked(
      lang === "de"
        ? "Gib dein Master Passwort ein, um den Passwortschutz auszuschalten."
        : "Enter your master password to turn off password protection.",
      openDisableProtectionDialog
    )
  }

  const regenerateRecoveryKey = () => {
    const openRegenerateRecoveryDialog = () => {
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

    ensureVaultUnlocked(
      lang === "de"
        ? "Gib dein Master Passwort ein, um einen neuen Recovery Key zu erzeugen."
        : "Enter your master password to generate a new recovery key.",
      openRegenerateRecoveryDialog
    )
  }

  const protectionLabel = isProtected
    ? (ui.securityStatusOn || (lang === "de" ? "Passwortschutz an" : "Password protection on"))
    : ui.securityStatusOff

  const lockLabel = isUnlocked
    ? ui.securityStatusUnlocked
    : ui.securityStatusLocked

  return (
    <>
      <div style={cardStyle}>
        <div
          style={{
            ...rowStyle,
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8
          }}
        >
          <span style={neutralBadgeStyle}>{protectionLabel}</span>
          {isProtected && <span style={statusToneStyle}>{lockLabel}</span>}
        </div>

        {!isProtected ? (
          <div
            style={{
              marginTop: 8,
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, var(--warning) 24%, var(--border-subtle))",
              background: "color-mix(in srgb, var(--warning) 8%, var(--bg-app))",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center"
            }}
          >
            <div className="text-[12px] font-semibold text-[var(--text-main)]">
              {lang === "de" ? "Vault ohne Passwort" : "Vault without password"}
            </div>
          </div>
        ) : null}

        {vaultStatus?.has_legacy_master_key ? (
          <div
            style={{
              marginTop: 8,
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, var(--danger) 22%, var(--border-subtle))",
              background: "color-mix(in srgb, var(--danger) 8%, var(--bg-app))",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center"
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

        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {!isProtected ? (
            <div style={compactRowStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Passwortschutz" : "Password protection"}
                  </div>
                  <span style={subtleBadgeStyle}>
                    {lang === "de" ? "Optional" : "Optional"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={enableProtection}
                style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                disabled={busy}
              >
                {ui.securityEnableAction}
              </button>
            </div>
          ) : (
            <>
              <div style={compactRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    Vault
                  </div>
                </div>

                {!isUnlocked ? (
                  <button
                    type="button"
                    onClick={unlockVault}
                    style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                    disabled={busy}
                  >
                    {ui.securityUnlockAction}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void lockVault()}
                    style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                    disabled={busy}
                  >
                    {ui.securityLockAction}
                  </button>
                )}
              </div>

              <div style={compactRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Master Passwort" : "Master password"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={changeMasterPassword}
                  style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Ändern" : "Change"}
                </button>
              </div>

              <div style={compactRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Recovery Key" : "Recovery key"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={regenerateRecoveryKey}
                  style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Neu" : "New key"}
                </button>
              </div>

              <div style={compactRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-[12px] font-semibold text-[var(--text-main)]">
                    {lang === "de" ? "Passwortschutz ausschalten" : "Turn off password protection"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={disableProtection}
                  style={{ ...actionBtnStyle, ...toolButtonStyle, opacity: busy ? 0.7 : 1 }}
                  disabled={busy}
                >
                  {lang === "de" ? "Ausschalten" : "Turn off"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {recoveryDialog.isOpen && (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
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
