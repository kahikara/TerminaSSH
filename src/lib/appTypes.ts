export type ConnectionItem = {
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

export type AppTab = ConnectionItem & {
  tabId: string
  sessionId: string
}

export type ConnectionDraft = {
  name?: string
  host?: string
  port?: number | string
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  group_name?: string
}

export type PaneStatePayload = {
  paneServers: ConnectionItem[]
  paneSessionIds: string[]
  focusedPaneId?: string | null
}

export type SidebarContextMenuState = {
  x: number
  y: number
  server: ConnectionItem
  isLocal: boolean
}

export type TabContextMenuState = {
  x: number
  y: number
  tabId: string
}

export type DashboardConnection = {
  id?: string | number
  name: string
  host?: string
  port?: number
  username?: string
  isLocal?: boolean
  isQuickConnect?: boolean
  quickConnectNeedsPassword?: boolean
}

export type DashboardTab = DashboardConnection & {
  tabId: string
}

export type EditableConnection = {
  id: number | string
  name: string
  host?: string
  port?: number
  username?: string
  private_key?: string
  group_name?: string
}
