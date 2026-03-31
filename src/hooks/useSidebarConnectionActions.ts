import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { GlobalDialogState } from '../lib/types'

type ConnectionItem = {
  id?: number | string
  name?: string
  host?: string
  port?: number
  username?: string
  private_key?: string
  group_name?: string
  [key: string]: unknown
}

type ConnectionDraft = {
  name?: string
  host?: string
  port?: number | string
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  group_name?: string
}

type UseSidebarConnectionActionsArgs = {
  lang: string
  closeSidebarContextMenu: () => void
  showToast: (msg: string, isErr?: boolean) => void
  showDialog: (config: Partial<GlobalDialogState>) => void
  loadServers: () => Promise<void>
  openEditConnectionModal: (server: ConnectionItem) => void
  openDuplicateConnectionModal: (draft: ConnectionDraft) => void
}

export function useSidebarConnectionActions({
  lang,
  closeSidebarContextMenu,
  showToast,
  showDialog,
  loadServers,
  openEditConnectionModal,
  openDuplicateConnectionModal
}: UseSidebarConnectionActionsArgs) {
  const editSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu()
    openEditConnectionModal(server)
  }, [closeSidebarContextMenu, openEditConnectionModal])

  const duplicateSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu()

    const sourceName = String(server?.name || '').trim()
    const duplicateName = sourceName
      ? `${sourceName} Copy`
      : (lang === 'de' ? 'Neue Verbindung Kopie' : 'New Connection Copy')

    openDuplicateConnectionModal({
      name: duplicateName,
      host: String(server?.host || ''),
      port: Number(server?.port) || 22,
      username: String(server?.username || ''),
      private_key: String(server?.private_key || ''),
      group_name: String(server?.group_name || '')
    })
  }, [closeSidebarContextMenu, lang, openDuplicateConnectionModal])

  const deleteSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu()

    showDialog({
      type: 'confirm',
      tone: 'danger',
      title: lang === 'de' ? 'Verbindung löschen' : 'Delete connection',
      description:
        lang === 'de'
          ? `Der gespeicherte Servereintrag "${server.name}" wird entfernt.`
          : `This removes the saved server entry "${server.name}".`,
      confirmLabel: lang === 'de' ? 'Löschen' : 'Delete',
      cancelLabel: lang === 'de' ? 'Abbrechen' : 'Cancel',
      onConfirm: async () => {
        try {
          await invoke('delete_connection', { id: server.id, name: server.name })
          await loadServers()
          showToast(lang === 'de' ? 'Verbindung gelöscht' : 'Connection deleted')
        } catch (e) {
          showToast(String(e), true)
        }
      }
    })
  }, [closeSidebarContextMenu, lang, loadServers, showDialog, showToast])

  return {
    editSidebarServer,
    duplicateSidebarServer,
    deleteSidebarServer
  }
}
