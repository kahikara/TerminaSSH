export type AppSettings = {
  [key: string]: any
  lang: string
  theme: string
  fontSize: number
  cursorStyle: string
  cursorBlink: boolean
  scrollback: number
  sftpHidden: boolean
  sftpSort: string
  showSplit: boolean
  showSftp: boolean
  showTunnels: boolean
  showSnippets: boolean
  showSearch: boolean
  showNotes: boolean
  showDashboardQuickConnect: boolean
  showDashboardWorkflow: boolean
  showDashboardActiveSessions: boolean
  showDashboardRecentConnections: boolean
  showStatusBar: boolean
  showStatusBarSession: boolean
  showStatusBarTunnel: boolean
  showStatusBarLoad: boolean
  showStatusBarRam: boolean
  closeToTray: boolean
  customFolders: string[]
}

export type ToastItem = {
  id: number
  msg: string
  isErr: boolean
}
