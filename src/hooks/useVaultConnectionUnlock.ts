import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

type VaultStatus = {
  is_initialized?: boolean
  is_protected?: boolean
  is_unlocked?: boolean
  unlock_mode?: string
  has_legacy_master_key?: boolean
}

type ConnectionItem = {
  id?: number | string
  name?: string
  host?: string
  port?: number
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  group_name?: string
  has_password?: boolean
  sessionPassword?: string | null
  isLocal?: boolean
  isQuickConnect?: boolean
  quickConnectNeedsPassword?: boolean
  splitMode?: boolean
  paneServers?: ConnectionItem[]
  paneSessionIds?: string[]
  focusedPaneIndex?: number
  type?: string
  kind?: string
  [key: string]: unknown
}

type UseVaultConnectionUnlockArgs = {
  lang: string
  showDialog: any
  showToast: (msg: string, isErr?: boolean) => void
  markStartupVaultUnlocked: () => void
  isLocalConnection: (server: ConnectionItem | null | undefined) => boolean
}

export function useVaultConnectionUnlock({
  lang,
  showDialog,
  showToast,
  markStartupVaultUnlocked,
  isLocalConnection
}: UseVaultConnectionUnlockArgs) {
  const ensureVaultUnlockedForConnection = useCallback(async (server: ConnectionItem) => {
    if (isLocalConnection(server)) return true

    const likelyNeedsVault =
      Boolean(server?.has_password) ||
      Boolean(String(server?.private_key || '').trim())

    if (!likelyNeedsVault) {
      return true
    }

    try {
      const status = await invoke('get_vault_status') as VaultStatus
      const isProtected = Boolean(status?.is_protected)
      const isUnlocked = Boolean(status?.is_unlocked)

      if (!isProtected || isUnlocked) {
        if (isUnlocked) {
          markStartupVaultUnlocked()
        }
        return true
      }

      return await new Promise<boolean>((resolve) => {
        showDialog({
          type: 'prompt',
          title: lang === 'de' ? 'Vault entsperren' : 'Unlock vault',
          description: lang === 'de'
            ? 'Diese Verbindung benötigt Zugriff auf den Vault. Bitte gib dein Master Passwort ein.'
            : 'This connection needs access to the vault. Please enter your master password.',
          placeholder: lang === 'de' ? 'Master Passwort' : 'Master password',
          isPassword: true,
          confirmLabel: lang === 'de' ? 'Entsperren' : 'Unlock',
          cancelLabel: lang === 'de' ? 'Abbrechen' : 'Cancel',
          validate: (value: string) => {
            if (!String(value || '').trim()) {
              return lang === 'de'
                ? 'Master Passwort ist erforderlich'
                : 'Master password is required'
            }
            return ''
          },
          onConfirm: async (value: string) => {
            try {
              await invoke('unlock_vault', { masterPassword: value })
              markStartupVaultUnlocked()

              showToast(
                lang === 'de'
                  ? 'Vault entsperrt'
                  : 'Vault unlocked'
              )

              resolve(true)
            } catch (e) {
              showToast(
                lang === 'de'
                  ? `Vault konnte nicht entsperrt werden: ${String(e)}`
                  : `Could not unlock vault: ${String(e)}`,
                true
              )

              throw e
            }
          },
          onCancel: () => resolve(false)
        })
      })
    } catch (e) {
      showToast(
        lang === 'de'
          ? `Vault Status konnte nicht geladen werden: ${String(e)}`
          : `Could not load vault status: ${String(e)}`,
        true
      )
      return false
    }
  }, [isLocalConnection, lang, markStartupVaultUnlocked, showDialog, showToast])

  return {
    ensureVaultUnlockedForConnection
  }
}
