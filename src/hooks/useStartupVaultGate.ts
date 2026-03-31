import { useState, useRef, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

type VaultStatus = {
  is_initialized?: boolean
  is_protected?: boolean
  is_unlocked?: boolean
  unlock_mode?: string
  has_legacy_master_key?: boolean
}

type RecoveryResetResult = {
  recovery_key?: string
  migrated_secret_entries?: number
}

const RECOVERY_KEY_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/

const normalizeRecoveryKey = (value: string) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z2-9-]/g, '')

const extractRecoveryKeyFromText = (content: string) => {
  const directMatch = content.match(/Recovery Key:\s*([A-Z2-9-]+)/i)
  if (directMatch?.[1]) {
    return normalizeRecoveryKey(directMatch[1])
  }

  return normalizeRecoveryKey(content)
}

type UseStartupVaultGateArgs = {
  lang: string
  showDialog: any
  showToast: (msg: string, isErr?: boolean) => void
}

export function useStartupVaultGate({
  lang,
  showDialog,
  showToast
}: UseStartupVaultGateArgs) {
  const [startupVaultGateState, setStartupVaultGateState] = useState<'checking' | 'locked' | 'open'>('checking')
  const [startupRecoveryDialog, setStartupRecoveryDialog] = useState<{
    isOpen: boolean
    key: string
  }>({
    isOpen: false,
    key: ''
  })

  const startupVaultPromptOpenRef = useRef(false)
  const startupVaultUnlockedRef = useRef(false)

  const closeStartupRecoveryDialog = useCallback(() => {
    setStartupRecoveryDialog({ isOpen: false, key: '' })
  }, [])

  const copyStartupRecoveryKey = useCallback(async () => {
    try {
      try {
        await invoke('copy_text_to_clipboard', { text: startupRecoveryDialog.key })
      } catch {
        await navigator.clipboard.writeText(startupRecoveryDialog.key)
      }

      showToast(
        lang === 'de'
          ? 'Recovery Key kopiert'
          : 'Recovery key copied'
      )
    } catch (e) {
      showToast(
        lang === 'de'
          ? `Recovery Key konnte nicht kopiert werden: ${String(e)}`
          : `Could not copy recovery key: ${String(e)}`,
        true
      )
    }
  }, [lang, showToast, startupRecoveryDialog.key])

  const downloadStartupRecoveryKey = useCallback(async () => {
    try {
      const fileName = 'termina-ssh-recovery-key.txt'
      const content = [
        'Termina SSH Recovery Key',
        '',
        `Recovery Key: ${startupRecoveryDialog.key}`,
        '',
        'Store this file in a safe place.'
      ].join('\n')

      const filePath = await save({
        defaultPath: fileName
      })

      if (!filePath) return

      await writeTextFile(String(filePath), content)

      showToast(
        lang === 'de'
          ? 'Recovery Key gespeichert'
          : 'Recovery key saved'
      )
    } catch (e) {
      showToast(
        lang === 'de'
          ? `Recovery Key konnte nicht gespeichert werden: ${String(e)}`
          : `Could not save recovery key: ${String(e)}`,
        true
      )
    }
  }, [lang, showToast, startupRecoveryDialog.key])

  function showStartupRecoveryResultDialog(key: string) {
    setStartupRecoveryDialog({
      isOpen: true,
      key
    })
  }

  function markStartupVaultUnlocked() {
    startupVaultUnlockedRef.current = true
    startupVaultPromptOpenRef.current = false
    setStartupVaultGateState('open')
  }

  async function runStartupRecoveryReset(normalizedRecoveryKey: string) {
    try {
      await invoke('validate_vault_recovery_key', { recoveryKey: normalizedRecoveryKey })
    } catch (_e) {
      showToast(
        lang === 'de'
          ? 'Recovery Key ist ungültig'
          : 'Recovery key is invalid',
        true
      )
      return
    }

    showDialog({
      type: 'prompt',
      title: lang === 'de' ? 'Neues Master Passwort' : 'New master password',
      description: lang === 'de'
        ? 'Setze jetzt ein neues Master Passwort.'
        : 'Set your new master password now.',
      placeholder: lang === 'de' ? 'Master Passwort' : 'Master password',
      confirmPlaceholder: lang === 'de' ? 'Master Passwort bestätigen' : 'Confirm master password',
      isPassword: true,
      requireConfirm: true,
      confirmLabel: lang === 'de' ? 'Zurücksetzen' : 'Reset',
      cancelLabel: lang === 'de' ? 'Zurück' : 'Back',
      validate: (value: string, confirmValue: string) => {
        if (!value.trim()) {
          return lang === 'de'
            ? 'Master Passwort ist erforderlich'
            : 'Master password is required'
        }
        if (value.length < 6) {
          return lang === 'de'
            ? 'Bitte mindestens 6 Zeichen verwenden.'
            : 'Please use at least 6 characters.'
        }
        if (value !== confirmValue) {
          return lang === 'de'
            ? 'Die Passwörter stimmen nicht überein.'
            : 'The passwords do not match.'
        }
        return ''
      },
      onConfirm: async (newMasterPassword: string) => {
        try {
          const result = await invoke('reset_vault_master_password_with_recovery_key', {
            recoveryKey: normalizedRecoveryKey,
            newMasterPassword
          }) as RecoveryResetResult

          await invoke('unlock_vault', { masterPassword: newMasterPassword })

          markStartupVaultUnlocked()

          const newRecoveryKey = String(result?.recovery_key || '')
          showStartupRecoveryResultDialog(newRecoveryKey)

          showToast(
            lang === 'de'
              ? 'Master Passwort zurückgesetzt'
              : 'Master password reset'
          )
        } catch (e) {
          showToast(
            lang === 'de'
              ? `Recovery Reset fehlgeschlagen: ${String(e)}`
              : `Recovery reset failed: ${String(e)}`,
            true
          )
          throw e
        }
      },
      onCancel: () => {
        reopenStartupUnlockDialog()
      }
    })
  }

  async function verifyStartupRecoveryKeyAndRunReset(normalizedRecoveryKey: string) {
    window.setTimeout(() => {
      void runStartupRecoveryReset(normalizedRecoveryKey)
    }, 0)
  }

  async function importStartupRecoveryKeyFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Text', extensions: ['txt'] },
          { name: 'All', extensions: ['*'] }
        ]
      })

      if (!selected) return

      const filePath = Array.isArray(selected) ? selected[0] : selected
      if (!filePath) return

      const content = await readTextFile(String(filePath))
      const normalizedRecoveryKey = extractRecoveryKeyFromText(content)

      if (!RECOVERY_KEY_PATTERN.test(normalizedRecoveryKey)) {
        showToast(
          lang === 'de'
            ? 'In der Datei wurde kein gültiger Recovery Key gefunden'
            : 'No valid recovery key was found in the file',
          true
        )
        return
      }

      window.setTimeout(() => {
        void runStartupRecoveryReset(normalizedRecoveryKey)
      }, 0)
    } catch (e) {
      showToast(
        lang === 'de'
          ? `Recovery Datei konnte nicht importiert werden: ${String(e)}`
          : `Could not import recovery file: ${String(e)}`,
        true
      )
    }
  }

  const openStartupVaultUnlockDialog = useCallback(() => {
    if (startupVaultPromptOpenRef.current) return
    if (startupVaultUnlockedRef.current) return

    startupVaultPromptOpenRef.current = true
    setStartupVaultGateState('locked')

    showDialog({
      type: 'prompt',
      title: lang === 'de' ? 'Vault entsperren' : 'Unlock vault',
      description: lang === 'de'
        ? 'Passwortschutz ist aktiviert. Bitte gib dein Master Passwort ein.'
        : 'Password protection is enabled. Please enter your master password.',
      placeholder: lang === 'de' ? 'Master Passwort' : 'Master password',
      isPassword: true,
      confirmLabel: lang === 'de' ? 'Entsperren' : 'Unlock',
      cancelLabel: lang === 'de' ? 'App schließen' : 'Close app',
      secondaryLabel: lang === 'de' ? 'Recovery Key' : 'Recovery key',
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
      onSecondary: async () => {
        showDialog({
          type: 'prompt',
          title: lang === 'de' ? 'Recovery Key eingeben' : 'Enter recovery key',
          description: lang === 'de'
            ? 'Gib deinen Recovery Key ein oder importiere eine Recovery Datei, um ein neues Master Passwort zu setzen.'
            : 'Enter your recovery key or import a recovery file to set a new master password.',
          placeholder: 'ABCD-EFGH-IJKL-MNOP-QRST',
          confirmLabel: lang === 'de' ? 'Weiter' : 'Continue',
          cancelLabel: lang === 'de' ? 'Zurück' : 'Back',
          secondaryLabel: lang === 'de' ? 'Datei importieren' : 'Import file',
          validate: (value: string) => {
            const normalized = normalizeRecoveryKey(value)
            if (!normalized) {
              return lang === 'de'
                ? 'Recovery Key ist erforderlich'
                : 'Recovery key is required'
            }
            if (!RECOVERY_KEY_PATTERN.test(normalized)) {
              return lang === 'de'
                ? 'Ungültiges Recovery Key Format'
                : 'Invalid recovery key format'
            }
            return ''
          },
          onConfirm: async (recoveryKey: string) => {
            const normalizedRecoveryKey = normalizeRecoveryKey(recoveryKey)
            await verifyStartupRecoveryKeyAndRunReset(normalizedRecoveryKey)
          },
          onSecondary: async () => {
            await importStartupRecoveryKeyFile()
          },
          onCancel: () => {
            reopenStartupUnlockDialog()
          }
        })
      },
      onCancel: async () => {
        startupVaultPromptOpenRef.current = false
        await invoke('window_close_main').catch(() => {})
      }
    })
  }, [lang, showDialog, showToast, startupRecoveryDialog.key])

  function reopenStartupUnlockDialog() {
    startupVaultPromptOpenRef.current = false
    window.setTimeout(() => {
      openStartupVaultUnlockDialog()
    }, 0)
  }

  useEffect(() => {
    if (!startupRecoveryDialog.isOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeStartupRecoveryDialog()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [startupRecoveryDialog.isOpen, closeStartupRecoveryDialog])

  useEffect(() => {
    let cancelled = false

    const checkStartupVault = async () => {
      if (cancelled) return
      if (startupVaultUnlockedRef.current) {
        setStartupVaultGateState('open')
        return
      }

      try {
        const status = await invoke('get_vault_status') as VaultStatus
        if (cancelled) return

        const isProtected = Boolean(status?.is_protected)
        const isUnlocked = Boolean(status?.is_unlocked)

        if (!isProtected || isUnlocked) {
          if (isUnlocked) {
            startupVaultUnlockedRef.current = true
          }
          setStartupVaultGateState('open')
          return
        }

        setStartupVaultGateState('locked')
        openStartupVaultUnlockDialog()
      } catch (e) {
        if (cancelled) return
        setStartupVaultGateState('open')
        showToast(
          lang === 'de'
            ? `Vault Status konnte nicht geladen werden: ${String(e)}`
            : `Could not load vault status: ${String(e)}`,
          true
        )
      }
    }

    void checkStartupVault()

    const recheckStartupVault = () => {
      if (startupVaultUnlockedRef.current) return
      void checkStartupVault()
    }

    window.addEventListener('focus', recheckStartupVault)
    document.addEventListener('visibilitychange', recheckStartupVault)

    return () => {
      cancelled = true
      window.removeEventListener('focus', recheckStartupVault)
      document.removeEventListener('visibilitychange', recheckStartupVault)
    }
  }, [lang, openStartupVaultUnlockDialog, showToast])

  return {
    startupVaultGateState,
    startupRecoveryDialog,
    closeStartupRecoveryDialog,
    copyStartupRecoveryKey,
    downloadStartupRecoveryKey,
    markStartupVaultUnlocked
  }
}
