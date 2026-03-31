import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppTab, ConnectionGroups, ConnectionItem, DashboardConnection } from '../lib/appTypes'

const RECENT_CONNECTIONS_STORAGE_KEY = 'termina_recent_connections'

const LOCAL_TERMINAL_CONNECTION: ConnectionItem = {
  id: 'local',
  isLocal: true,
  name: 'Local Terminal',
  username: 'local',
  host: '__local__'
}

const isDashboardConnection = (
  value: ConnectionItem | null | undefined
): value is DashboardConnection => {
  return typeof value?.name === 'string' && value.name.trim().length > 0
}

type UseConnectionCollectionsArgs = {
  lang: string
  customFolders: string[]
  showToast: (msg: string, isErr?: boolean) => void
  sidebarSearchQuery: string
  showSidebarSearch: boolean
  collapsedFolders: Record<string, boolean>
  openTabs: AppTab[]
  activeTabId: string | null
}

export function useConnectionCollections({
  lang,
  customFolders,
  showToast,
  sidebarSearchQuery,
  showSidebarSearch,
  collapsedFolders,
  openTabs,
  activeTabId
}: UseConnectionCollectionsArgs) {
  const [connections, setConnections] = useState<ConnectionItem[]>([])
  const [recentConnectionIds, setRecentConnectionIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_CONNECTIONS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((value) => String(value)) : []
    } catch {
      return []
    }
  })
  const [lastActiveConnectionId, setLastActiveConnectionId] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const items = await invoke('get_connections')
      setConnections(Array.isArray(items) ? (items as ConnectionItem[]) : [])
    } catch (e) {
      setConnections([])
      showToast(
        lang === 'de'
          ? `Verbindungen konnten nicht geladen werden: ${String(e)}`
          : `Could not load connections: ${String(e)}`,
        true
      )
    }
  }, [lang, showToast])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(recentConnectionIds))
    } catch {}
  }, [recentConnectionIds])

  useEffect(() => {
    const validIds = new Set(connections.map((conn) => String(conn.id)))

    setRecentConnectionIds((prev) => {
      const next = prev.filter((id) => validIds.has(String(id)))
      return next.length === prev.length ? prev : next
    })
  }, [connections])

  const activeTab = useMemo<AppTab | null>(
    () => openTabs.find((tab) => tab.tabId === activeTabId) || null,
    [openTabs, activeTabId]
  )

  useEffect(() => {
    if (!activeTab) return

    if (activeTab.isLocal) {
      setLastActiveConnectionId('__local__')
      return
    }

    if (activeTab.id != null) {
      setLastActiveConnectionId(String(activeTab.id))
    }
  }, [activeTab])

  useEffect(() => {
    if (!activeTab) return
    if (activeTab.isLocal) return
    if (activeTab.id == null) return

    const id = String(activeTab.id)
    setRecentConnectionIds((prev) => [id, ...prev.filter((value) => value !== id)].slice(0, 12))
  }, [activeTab])

  useEffect(() => {
    if (lastActiveConnectionId == null) return

    const stillOpen = openTabs.some((tab) => {
      if (lastActiveConnectionId === '__local__') {
        return !!tab?.isLocal
      }
      return tab?.id != null && String(tab.id) === String(lastActiveConnectionId)
    })

    if (!stillOpen) {
      setLastActiveConnectionId(null)
    }
  }, [openTabs, lastActiveConnectionId])

  const { groups, rootServers } = useMemo(() => {
    const grps: ConnectionGroups = {}
    const root: ConnectionItem[] = []

    customFolders.forEach((folder) => {
      grps[folder] = []
    })

    connections.forEach((curr) => {
      const g = curr.group_name
      if (!g || g.trim() === '') {
        root.push(curr)
      } else {
        if (!grps[g]) grps[g] = []
        grps[g].push(curr)
      }
    })

    return { groups: grps, rootServers: root }
  }, [connections, customFolders])

  const collapsedConnections = useMemo<ConnectionItem[]>(() => {
    const items: ConnectionItem[] = [LOCAL_TERMINAL_CONNECTION]

    rootServers.forEach((conn) => items.push(conn))
    Object.keys(groups).sort().forEach((group) => {
      groups[group].forEach((conn) => items.push(conn))
    })

    return items
  }, [rootServers, groups])

  const normalizedSidebarSearch = sidebarSearchQuery.trim().toLowerCase()
  const isSidebarSearching = showSidebarSearch && normalizedSidebarSearch.length > 0

  const matchesSidebarSearch = useCallback((conn: ConnectionItem) => {
    if (!normalizedSidebarSearch) return true
    const haystack = [
      conn?.name || '',
      conn?.host || '',
      conn?.username || ''
    ].join(' ').toLowerCase()
    return haystack.includes(normalizedSidebarSearch)
  }, [normalizedSidebarSearch])

  const filteredRootServers = useMemo<ConnectionItem[]>(() => {
    if (!isSidebarSearching) return rootServers
    return rootServers.filter((conn) => matchesSidebarSearch(conn))
  }, [rootServers, isSidebarSearching, matchesSidebarSearch])

  const filteredGroups = useMemo<ConnectionGroups>(() => {
    if (!isSidebarSearching) return groups

    const next: ConnectionGroups = {}
    Object.keys(groups).forEach((group) => {
      const matches = groups[group].filter((conn) => matchesSidebarSearch(conn))
      if (matches.length > 0) next[group] = matches
    })
    return next
  }, [groups, isSidebarSearching, matchesSidebarSearch])

  const sidebarVisibleGroups = isSidebarSearching ? filteredGroups : groups
  const sidebarVisibleRootServers = isSidebarSearching ? filteredRootServers : rootServers

  const effectiveFolderCollapsed = useCallback((group: string) => {
    if (!isSidebarSearching) return Boolean(collapsedFolders[group])
    return false
  }, [collapsedFolders, isSidebarSearching])

  const activeConnectionId = activeTab?.isLocal ? '__local__' : activeTab?.id != null ? String(activeTab.id) : null
  const sidebarActiveConnectionId = activeConnectionId ?? lastActiveConnectionId
  const isLocalActive = sidebarActiveConnectionId === '__local__'

  const isServerActive = useCallback((conn: ConnectionItem) => {
    return sidebarActiveConnectionId != null && String(sidebarActiveConnectionId) === String(conn.id)
  }, [sidebarActiveConnectionId])

  const recentConnectionsForDashboard = useMemo<DashboardConnection[]>(() => {
    const baseConnections = !recentConnectionIds.length
      ? connections.slice(0, 6)
      : connections
          .filter((conn) => recentConnectionIds.includes(String(conn.id)))
          .sort(
            (a, b) =>
              recentConnectionIds.indexOf(String(a.id)) - recentConnectionIds.indexOf(String(b.id))
          )

    return baseConnections.filter(isDashboardConnection)
  }, [connections, recentConnectionIds])

  return {
    loadServers,
    groups,
    collapsedConnections,
    sidebarVisibleGroups,
    sidebarVisibleRootServers,
    isSidebarSearching,
    effectiveFolderCollapsed,
    recentConnectionsForDashboard,
    isLocalActive,
    isServerActive
  }
}
