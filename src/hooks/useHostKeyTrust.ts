import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectionItem } from '../lib/appTypes'

type HostKeyCheckInfo = {
  host: string
  port: number
  display_host: string
  key_type: string
  fingerprint: string
  status: string
  known_hosts_path: string
}

type UseHostKeyTrustArgs = {
  lang: string
  showDialog: any
  showToast: (msg: string, isErr?: boolean) => void
  isLocalConnection: (server: ConnectionItem | null | undefined) => boolean
}

export function useHostKeyTrust({
  lang,
  showDialog,
  showToast,
  isLocalConnection
}: UseHostKeyTrustArgs) {
  const ensureHostKeyTrusted = useCallback(async (server: ConnectionItem) => {
    if (isLocalConnection(server)) return true

    const host = String(server?.host || '').trim()
    const port = Number(server?.port) || 22

    if (!host) {
      showToast(
        lang === 'de'
          ? 'Host fehlt für die SSH Verbindung'
          : 'Missing host for SSH connection',
        true
      )
      return false
    }

    try {
      const info = await invoke('check_host_key', {
        host,
        port
      }) as HostKeyCheckInfo

      if (info?.status === 'match') {
        return true
      }

      if (info?.status !== 'not_found' && info?.status !== 'mismatch') {
        showToast(
          lang === 'de'
            ? 'Host-Fingerprint konnte nicht geprüft werden'
            : 'Could not verify host fingerprint',
          true
        )
        return false
      }

      const isMismatch = info.status === 'mismatch'

      return await new Promise<boolean>((resolve) => {
        const statusLabel = isMismatch
          ? (lang === 'de' ? 'Geändert' : 'Changed')
          : (lang === 'de' ? 'Neu' : 'New')

        const title = isMismatch
          ? (lang === 'de' ? 'SSH Host Key geändert' : 'SSH host key changed')
          : (lang === 'de' ? 'Neuer SSH Host' : 'New SSH host')

        const description = isMismatch
          ? [
              lang === 'de'
                ? 'Der gespeicherte SSH Host Key stimmt nicht mehr mit dem aktuellen Server überein.'
                : 'The stored SSH host key no longer matches the current server.',
              '',
              lang === 'de'
                ? 'Das kann nach einer Neuinstallation oder einem Serverwechsel normal sein. Es kann aber auch auf einen Man in the Middle Angriff hindeuten.'
                : 'This can be normal after a reinstall or server migration. It can also indicate a man in the middle attack.',
              '',
              `Host: ${info.display_host}`,
              `${lang === 'de' ? 'Status' : 'Status'}: ${statusLabel}`,
              `${lang === 'de' ? 'Typ' : 'Type'}: ${info.key_type}`,
              `Fingerprint: ${info.fingerprint}`,
              `known_hosts: ${info.known_hosts_path}`,
              '',
              lang === 'de'
                ? 'Nur fortfahren, wenn du diese Änderung wirklich erwartest und dem Zielsystem vertraust.'
                : 'Only continue if you truly expect this change and trust the target system.'
            ].join('\n')
          : [
              lang === 'de'
                ? 'Dieser SSH Host ist noch nicht in known_hosts gespeichert.'
                : 'This SSH host is not stored in known_hosts yet.',
              '',
              lang === 'de'
                ? 'Wenn du fortfährst, wird der aktuelle Host Key lokal gespeichert und künftig wiedererkannt.'
                : 'If you continue, the current host key will be stored locally and recognized in future connections.',
              '',
              `Host: ${info.display_host}`,
              `${lang === 'de' ? 'Status' : 'Status'}: ${statusLabel}`,
              `${lang === 'de' ? 'Typ' : 'Type'}: ${info.key_type}`,
              `Fingerprint: ${info.fingerprint}`,
              `known_hosts: ${info.known_hosts_path}`
            ].join('\n')

        showDialog({
          type: 'confirm',
          tone: isMismatch ? 'danger' : undefined,
          title,
          description,
          confirmLabel: isMismatch
            ? (lang === 'de' ? 'Ersetzen und verbinden' : 'Replace and connect')
            : (lang === 'de' ? 'Vertrauen und verbinden' : 'Trust and connect'),
          cancelLabel: lang === 'de' ? 'Abbrechen' : 'Cancel',
          secondaryLabel: lang === 'de' ? 'Fingerprint kopieren' : 'Copy fingerprint',
          tertiaryLabel: lang === 'de' ? 'known_hosts öffnen' : 'Open known_hosts',
          onSecondary: async () => {
            try {
              await invoke('copy_text_to_clipboard', { text: String(info.fingerprint || '') })
              showToast(lang === 'de' ? 'Fingerprint kopiert' : 'Fingerprint copied')
            } catch (e) {
              showToast(
                lang === 'de'
                  ? `Fingerprint konnte nicht kopiert werden: ${String(e)}`
                  : `Could not copy fingerprint: ${String(e)}`,
                true
              )
            }
          },
          onTertiary: async () => {
            try {
              await invoke('reveal_path_in_file_manager', { path: String(info.known_hosts_path || '') })
            } catch (e) {
              showToast(
                lang === 'de'
                  ? `known_hosts konnte nicht geöffnet werden: ${String(e)}`
                  : `Could not open known_hosts: ${String(e)}`,
                true
              )
            }
          },
          onConfirm: async () => {
            try {
              await invoke('trust_host_key', {
                host: info.host,
                port: info.port
              })
              showToast(
                isMismatch
                  ? (lang === 'de' ? 'Host Key ersetzt und gespeichert' : 'Host key replaced and stored')
                  : (lang === 'de' ? 'Host Key gespeichert' : 'Host key stored')
              )
              resolve(true)
            } catch (e) {
              showToast(
                lang === 'de'
                  ? `Host Fingerprint konnte nicht gespeichert werden: ${String(e)}`
                  : `Could not store host fingerprint: ${String(e)}`,
                true
              )
              resolve(false)
            }
          },
          onCancel: () => resolve(false)
        })
      })
    } catch (e) {
      showToast(
        lang === 'de'
          ? `Host-Fingerprint Prüfung fehlgeschlagen: ${String(e)}`
          : `Host fingerprint check failed: ${String(e)}`,
        true
      )
      return false
    }
  }, [isLocalConnection, lang, showDialog, showToast])

  return {
    ensureHostKeyTrusted
  }
}
