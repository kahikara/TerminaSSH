import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { CSSProperties } from "react"

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

  const refreshStatus = async () => {
    try {
      const status = await invoke("get_vault_status") as VaultStatus
      setVaultStatus(status || {})
      const nextMode = String(status?.unlock_mode || "demand").toLowerCase() === "startup" ? "startup" : "demand"
      setUnlockMode(nextMode)
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

  const enableProtection = () => {
    showDialog({
      type: "prompt",
      title: ui.securityEnableTitle,
      description:
        `${ui.securityEnableDesc}\n\n${ui.securityRecoveryHint}`,
      placeholder: ui.securityMasterPasswordPlaceholder,
      confirmPlaceholder: ui.securityMasterPasswordConfirmPlaceholder,
      isPassword: true,
      requireConfirm: true,
      confirmLabel: ui.securityEnableAction,
      cancelLabel: ui.cancelLabel || (lang === "de" ? "Abbrechen" : "Cancel"),
      validate: (value: string, confirmValue: string) => {
        if (!value.trim()) {
          return ui.securityMasterPasswordEmpty
        }
        if (value.length < 6) {
          return ui.securityMasterPasswordTooShort
        }
        if (value !== confirmValue) {
          return ui.securityMasterPasswordMismatch
        }
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

          const recoveryKey = String(result?.recovery_key || "")
          const migrated = Number(result?.migrated_secret_entries || 0)

          showDialog({
            type: "alert",
            title: ui.securityRecoveryTitle,
            description:
              `${ui.securityRecoveryDesc}\n\n${recoveryKey}\n\n${ui.securityMigratedPrefix}: ${migrated}`,
            confirmLabel: ui.closeLabel,
            secondaryLabel: ui.copyLabel,
            onSecondary: async () => {
              await invoke("copy_text_to_clipboard", { text: recoveryKey })
              showToast(ui.securityRecoveryCopied)
            },
            onConfirm: async () => {}
          })

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
          await invoke("unlock_vault", {
            masterPassword: value
          })
          await refreshStatus()
          showToast(ui.securityUnlockedToast)
        } catch (e) {
          showToast(
            lang === "de"
              ? `Vault konnte nicht entsperrt werden: ${String(e)}`
              : `Could not unlock vault: ${String(e)}`,
            true
          )
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

          <span style={{ ...badgeBaseStyle, background: "color-mix(in srgb, var(--bg-app) 82%, var(--bg-sidebar))", color: "var(--text-main)" }}>
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
              onChange={(e) => setUnlockMode((e.target.value === "startup" ? "startup" : "demand"))}
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => void refreshStatus()}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.refreshLabel}
            </button>
            <button
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={() => void refreshStatus()}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.refreshLabel}
            </button>

            {!isUnlocked ? (
              <button
                onClick={unlockVault}
                style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}
                disabled={busy}
              >
                {ui.securityUnlockAction}
              </button>
            ) : (
              <button
                onClick={() => void lockVault()}
                style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
                disabled={busy}
              >
                {ui.securityLockAction}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
