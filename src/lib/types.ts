export type ThemeName = "catppuccin" | "nord" | "pitch-black"
export type CursorStyleName = "block" | "bar" | "underline"
export type SftpSortName = "folders" | "name" | "size" | "type"

export type SettingsSectionId =
  | "general"
  | "statusbar"
  | "terminal"
  | "sftp"
  | "keys"
  | "backup"
  | "about"

export type ToolToggleKey =
  | "showSplit"
  | "showSftp"
  | "showTunnels"
  | "showSnippets"
  | "showSearch"
  | "showNotes"

export type StoredSshKey = {
  id: number | string
  name: string
  key_type: string
  fingerprint: string
  public_key: string
}

export type AppSettings = {
  [key: string]: any
  lang: string
  theme: ThemeName
  fontSize: number
  cursorStyle: CursorStyleName
  cursorBlink: boolean
  scrollback: number
  sftpHidden: boolean
  sftpSort: SftpSortName
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
