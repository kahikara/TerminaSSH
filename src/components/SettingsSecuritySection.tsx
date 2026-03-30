import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
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

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)

      showToast(
        lang === "de" ? "Recovery Key heruntergeladen" : "Recovery key downloaded"
      )
    } catch (e) {
      showToast(
        lang === "de"
          ? `Recovery Key konnte nicht heruntergeladen werden: ${String(e)}`
          : `Could not download recovery key: ${String(e)}`,
        true
      )
    }
  }

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

          setRecoveryDialog({
            isOpen: true,
            key: String(result?.recovery_key || ""),
            migrated: Number(result?.migrated_secret_entries || 0)
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
              type="button"
              onClick={() => void refreshStatus()}
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              style={{ ...actionBtnStyle, opacity: busy ? 0.7 : 1 }}
              disabled={busy}
            >
              {ui.refreshLabel}
            </button>

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
