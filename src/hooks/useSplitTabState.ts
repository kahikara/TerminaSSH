import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppTab, ConnectionItem, PaneStatePayload } from '../lib/appTypes'

type UseSplitTabStateArgs = {
  createTabId: () => string
  setOpenTabs: Dispatch<SetStateAction<AppTab[]>>
}

export function useSplitTabState({
  createTabId,
  setOpenTabs
}: UseSplitTabStateArgs) {
  const buildSplitTabFromServers = useCallback((
    leftServer: ConnectionItem,
    rightServer: ConnectionItem,
    existingTabId?: string,
    existingPaneSessionIds?: string[],
    forceNewRightSession = false
  ): AppTab => {
    const tabId = existingTabId || createTabId()
    const leftSessionId =
      existingPaneSessionIds?.[0] && String(existingPaneSessionIds[0]).trim().length > 0
        ? String(existingPaneSessionIds[0])
        : tabId
    const rightSessionId =
      !forceNewRightSession && existingPaneSessionIds?.[1] && String(existingPaneSessionIds[1]).trim().length > 0
        ? String(existingPaneSessionIds[1])
        : `${tabId}__pane_1_${Date.now().toString(36)}`

    return {
      ...leftServer,
      tabId,
      sessionId: leftSessionId,
      splitMode: true,
      paneServers: [leftServer, rightServer],
      paneSessionIds: [leftSessionId, rightSessionId],
      focusedPaneIndex: 1,
      name: `${leftServer?.name || leftServer?.host || 'Left'} | ${rightServer?.name || rightServer?.host || 'Right'}`
    }
  }, [createTabId])

  const updateTabFromPaneState = useCallback((tabId: string, payload: PaneStatePayload) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.tabId !== tabId) return tab

        const rawPaneServers = Array.isArray(payload.paneServers) ? payload.paneServers.slice(0, 2) : []
        const rawPaneSessionIds = Array.isArray(payload.paneSessionIds) ? payload.paneSessionIds.slice(0, 2) : []

        const normalizedEntries = rawPaneServers
          .map((server, index) => {
            if (!server) return null

            const rawSessionId = rawPaneSessionIds[index]
            const sessionId =
              typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
                ? rawSessionId
                : `${tabId}__pane_${index}`

            return { server, sessionId }
          })
          .filter((entry): entry is { server: ConnectionItem; sessionId: string } => Boolean(entry))

        if (normalizedEntries.length <= 1) {
          const singleEntry = normalizedEntries[0]
          const singleServer = singleEntry?.server || tab.paneServers?.[0] || tab
          const singleSessionId =
            singleEntry?.sessionId || tab.paneSessionIds?.[0] || tab.sessionId || tab.tabId

          return {
            ...singleServer,
            tabId,
            sessionId: singleSessionId,
            splitMode: false,
            paneServers: undefined,
            paneSessionIds: undefined,
            focusedPaneIndex: undefined
          }
        }

        const leftEntry = normalizedEntries[0]
        const rightEntry = normalizedEntries[1]

        if (!leftEntry || !rightEntry) {
          return tab
        }

        const focusedPaneIndex =
          payload.focusedPaneId === rightEntry.sessionId
            ? 1
            : payload.focusedPaneId === leftEntry.sessionId
            ? 0
            : tab.focusedPaneIndex === 1
            ? 1
            : 0

        return {
          ...leftEntry.server,
          tabId,
          sessionId: leftEntry.sessionId,
          splitMode: true,
          paneServers: [leftEntry.server, rightEntry.server],
          paneSessionIds: [leftEntry.sessionId, rightEntry.sessionId],
          focusedPaneIndex,
          name: `${leftEntry.server?.name || leftEntry.server?.host || 'Left'} | ${rightEntry.server?.name || rightEntry.server?.host || 'Right'}`
        }
      })
    )
  }, [setOpenTabs])

  return {
    buildSplitTabFromServers,
    updateTabFromPaneState
  }
}
