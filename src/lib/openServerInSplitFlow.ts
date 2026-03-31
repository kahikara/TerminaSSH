import { invoke } from '@tauri-apps/api/core'
import { destroyTerminal } from './terminalSession'

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

type AppTab = ConnectionItem & {
  tabId: string
  sessionId: string
}

type RunOpenServerInSplitFlowArgs = {
  lang: string
  server: ConnectionItem
  activeTabId: string | null
  openTabs: AppTab[]
  openTerminal: (server: ConnectionItem) => Promise<void>
  getConnectionIdentity: (server: ConnectionItem | null | undefined) => string
  isLocalConnection: (server: ConnectionItem | null | undefined) => boolean
  ensureHostKeyTrusted: (server: ConnectionItem) => Promise<boolean>
  ensureVaultUnlockedForConnection: (server: ConnectionItem) => Promise<boolean>
  needsSessionPasswordPrompt: (server: ConnectionItem) => boolean
  applyPromptPasswordToServer: (server: ConnectionItem, pwd: string) => ConnectionItem
  showDialog: any
  showToast: (msg: string, isErr?: boolean) => void
  loadServers: () => Promise<void>
  buildSplitTabFromServers: (
    leftServer: ConnectionItem,
    rightServer: ConnectionItem,
    existingTabId?: string,
    existingPaneSessionIds?: string[],
    forceNewRightSession?: boolean
  ) => AppTab
  setOpenTabs: React.Dispatch<React.SetStateAction<AppTab[]>>
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>
}

export async function runOpenServerInSplitFlow({
  lang,
  server,
  activeTabId,
  openTabs,
  openTerminal,
  getConnectionIdentity,
  isLocalConnection,
  ensureHostKeyTrusted,
  ensureVaultUnlockedForConnection,
  needsSessionPasswordPrompt,
  applyPromptPasswordToServer,
  showDialog,
  showToast,
  loadServers,
  buildSplitTabFromServers,
  setOpenTabs,
  setActiveTabId
}: RunOpenServerInSplitFlowArgs) {
  if (!activeTabId) {
    await openTerminal(server)
    return
  }

  const currentTab = openTabs.find((tab) => tab.tabId === activeTabId)
  if (!currentTab) {
    await openTerminal(server)
    return
  }

  const currentPaneServers = currentTab.splitMode
    ? (currentTab.paneServers || []).filter(Boolean)
    : [currentTab]
  const currentPaneIdentities = new Set(currentPaneServers.map((item) => getConnectionIdentity(item)))
  const targetIdentity = getConnectionIdentity(server)

  if (
    currentTab.splitMode &&
    currentPaneServers.length >= 2 &&
    (currentPaneIdentities.size >= 2 || currentPaneIdentities.has(targetIdentity))
  ) {
    showToast(
      lang === 'de'
        ? 'Ein Split Tab kann nur zwei verschiedene Verbindungen enthalten'
        : 'A split tab can only contain two different connections',
      true
    )
    return
  }

  if (!isLocalConnection(server)) {
    if (!(await ensureHostKeyTrusted(server))) {
      return
    }
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

        const rightServer = applyPromptPasswordToServer(server, pwd)

        setOpenTabs((prev) => {
          const next = [...prev]
          const idx = next.findIndex((tab) => tab.tabId === activeTabId)
          if (idx === -1) return prev

          const baseTab = next[idx]
          const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab
          const currentRightServer = baseTab?.splitMode ? baseTab.paneServers?.[1] || null : null
          const existingPaneSessionIds = baseTab?.splitMode
            ? (baseTab.paneSessionIds || [])
            : [baseTab.sessionId]
          const reuseRightSession =
            Boolean(baseTab?.splitMode) &&
            currentRightServer != null &&
            getConnectionIdentity(currentRightServer) === targetIdentity

          if (!reuseRightSession && existingPaneSessionIds[1]) {
            destroyTerminal(String(existingPaneSessionIds[1]))
          }

          next[idx] = buildSplitTabFromServers(
            leftServer,
            rightServer,
            activeTabId,
            existingPaneSessionIds,
            !reuseRightSession
          )
          return next
        })

        setActiveTabId(activeTabId)
      }
    })
    return
  }

  setOpenTabs((prev) => {
    const next = [...prev]
    const idx = next.findIndex((tab) => tab.tabId === activeTabId)
    if (idx === -1) return prev

    const baseTab = next[idx]
    const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab
    const currentRightServer = baseTab?.splitMode ? baseTab.paneServers?.[1] || null : null
    const existingPaneSessionIds = baseTab?.splitMode
      ? (baseTab.paneSessionIds || [])
      : [baseTab.sessionId]
    const reuseRightSession =
      Boolean(baseTab?.splitMode) &&
      currentRightServer != null &&
      getConnectionIdentity(currentRightServer) === targetIdentity

    if (!reuseRightSession && existingPaneSessionIds[1]) {
      destroyTerminal(String(existingPaneSessionIds[1]))
    }

    next[idx] = buildSplitTabFromServers(
      leftServer,
      server,
      activeTabId,
      existingPaneSessionIds,
      !reuseRightSession
    )
    return next
  })

  setActiveTabId(activeTabId)
}
