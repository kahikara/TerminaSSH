import { useCallback } from 'react'
import { destroyTerminal } from '../lib/terminalSession'
import type { AppTab, ConnectionItem } from '../lib/appTypes'

type UseTabContextActionsArgs = {
  closeTabContextMenu: () => void
  openTerminalNewTab: (server: ConnectionItem) => void
  buildSplitTabFromServers: (
    leftServer: ConnectionItem,
    rightServer: ConnectionItem,
    existingTabId?: string,
    existingPaneSessionIds?: string[],
    forceNewRightSession?: boolean
  ) => AppTab
  updateOpenTabs: (updater: (prev: AppTab[]) => AppTab[]) => void
  setActiveTabId: (tabId: string) => void
  closeTab: (tabId: string) => void
}

export function useTabContextActions({
  closeTabContextMenu,
  openTerminalNewTab,
  buildSplitTabFromServers,
  updateOpenTabs,
  setActiveTabId,
  closeTab
}: UseTabContextActionsArgs) {
  const duplicateTabSession = useCallback((tab: AppTab, paneIndex?: number) => {
    closeTabContextMenu()

    const targetServer =
      typeof paneIndex === 'number' && tab.splitMode
        ? tab.paneServers?.[paneIndex] || null
        : tab

    if (!targetServer) return
    openTerminalNewTab(targetServer)
  }, [closeTabContextMenu, openTerminalNewTab])

  const openTabInSplit = useCallback((tab: AppTab) => {
    closeTabContextMenu()
    if (tab.splitMode) return

    updateOpenTabs((prev) =>
      prev.map((curr) =>
        curr.tabId !== tab.tabId
          ? curr
          : buildSplitTabFromServers(curr, curr, curr.tabId, [curr.sessionId], true)
      )
    )
    setActiveTabId(tab.tabId)
  }, [buildSplitTabFromServers, closeTabContextMenu, setActiveTabId, updateOpenTabs])

  const removeSplitFromTab = useCallback((tab: AppTab) => {
    closeTabContextMenu()
    if (!tab.splitMode) return

    const keepIndex = tab.focusedPaneIndex === 1 ? 1 : 0
    const removeIndex = keepIndex === 1 ? 0 : 1
    const removeSessionId = tab.paneSessionIds?.[removeIndex]

    if (removeSessionId) {
      destroyTerminal(String(removeSessionId))
    }

    updateOpenTabs((prev) =>
      prev.map((curr) => {
        if (curr.tabId !== tab.tabId) return curr

        const keepServer = curr.paneServers?.[keepIndex] || curr
        const keepSessionId = curr.paneSessionIds?.[keepIndex] || curr.sessionId || curr.tabId

        return {
          ...keepServer,
          tabId: curr.tabId,
          sessionId: keepSessionId,
          splitMode: false,
          paneServers: undefined,
          paneSessionIds: undefined,
          focusedPaneIndex: undefined
        }
      })
    )
    setActiveTabId(tab.tabId)
  }, [closeTabContextMenu, setActiveTabId, updateOpenTabs])

  const closeTabFromContextMenu = useCallback((tab: AppTab) => {
    closeTabContextMenu()
    closeTab(tab.tabId)
  }, [closeTab, closeTabContextMenu])

  return {
    duplicateTabSession,
    openTabInSplit,
    removeSplitFromTab,
    closeTabFromContextMenu
  }
}
