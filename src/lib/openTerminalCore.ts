import { invoke } from '@tauri-apps/api/core'
import type { AppTab, ConnectionItem } from './appTypes'

type OpenTerminalOptions = {
  forceNewTab?: boolean
  openInSplit?: boolean
}

type RunOpenTerminalFlowArgs = {
  lang: string
  server: ConnectionItem
  options?: OpenTerminalOptions
  openTabs: AppTab[]
  isLocalConnection: (server: ConnectionItem | null | undefined) => boolean
  ensureHostKeyTrusted: (server: ConnectionItem) => Promise<boolean>
  ensureVaultUnlockedForConnection: (server: ConnectionItem) => Promise<boolean>
  needsSessionPasswordPrompt: (server: ConnectionItem) => boolean
  applyPromptPasswordToServer: (server: ConnectionItem, pwd: string) => ConnectionItem
  showDialog: any
  showToast: (msg: string, isErr?: boolean) => void
  loadServers: () => Promise<void>
  setOpenTabs: (updater: (prev: AppTab[]) => AppTab[]) => void
  setActiveTabId: (tabId: string | null) => void
  createTabId: () => string
  openServerInSplit: (server: ConnectionItem) => Promise<void>
}

export async function runOpenTerminalFlow({
  lang,
  server,
  options,
  openTabs,
  isLocalConnection,
  ensureHostKeyTrusted,
  ensureVaultUnlockedForConnection,
  needsSessionPasswordPrompt,
  applyPromptPasswordToServer,
  showDialog,
  showToast,
  loadServers,
  setOpenTabs,
  setActiveTabId,
  createTabId,
  openServerInSplit
}: RunOpenTerminalFlowArgs) {
  const resolvedOptions: OpenTerminalOptions = options || {}

  const findExistingTabId = (): string | null => {
    if (resolvedOptions.forceNewTab) return null
    if (server?.isQuickConnect) return null

    if (isLocalConnection(server)) {
      const existingLocal = openTabs.find((tab) => tab?.isLocal)
      return existingLocal?.tabId || null
    }

    if (server?.id != null) {
      const existingServer = openTabs.find((tab) => String(tab?.id) === String(server.id))
      return existingServer?.tabId || null
    }

    return null
  }

  if (resolvedOptions.openInSplit) {
    await openServerInSplit(server)
    return
  }

  const existingTabId = findExistingTabId()
  if (existingTabId) {
    setActiveTabId(existingTabId)
    return
  }

  if (!(await ensureHostKeyTrusted(server))) {
    return
  }

  if (!(await ensureVaultUnlockedForConnection(server))) {
    return
  }

  if (needsSessionPasswordPrompt(server)) {
    showDialog({
      type: 'prompt',
      title:
        lang === 'de'
          ? `Passwort für ${server?.name || server?.host || 'SSH Verbindung'}`
          : `Password for ${server?.name || server?.host || 'SSH connection'}`,
      placeholder: lang === 'de' ? 'SSH Passwort eingeben' : 'Enter SSH password',
      isPassword: true,
      checkboxLabel: lang === 'de' ? 'Passwort speichern' : 'Save password',
      onConfirm: async (pwd: string, meta?: { checked?: boolean }) => {
        if (!pwd) return

        if (meta?.checked && server?.id != null) {
          try {
            await invoke('set_connection_password', {
              id: server.id,
              password: pwd
            })
            await loadServers()
            showToast(lang === 'de' ? 'Passwort gespeichert' : 'Password saved')
          } catch (e) {
            showToast(
              lang === 'de'
                ? `Passwort konnte nicht gespeichert werden: ${String(e)}`
                : `Could not save password: ${String(e)}`,
              true
            )
          }
        }

        const tabId = createTabId()
        const resolvedServer = applyPromptPasswordToServer(server, pwd)
        const newTab: AppTab = {
          ...resolvedServer,
          tabId,
          sessionId: tabId
        }

        setOpenTabs((prev) => [...prev, newTab])
        setActiveTabId(tabId)
      }
    })
    return
  }

  const tabId = createTabId()
  const newTab: AppTab = { ...server, tabId, sessionId: tabId }
  setOpenTabs((prev) => [...prev, newTab])
  setActiveTabId(tabId)
}
