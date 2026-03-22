import type { Terminal } from "xterm"
import type { FitAddon } from "xterm-addon-fit"
import type { SearchAddon } from "xterm-addon-search"

export type TerminalServer = {
  id?: string | number | null
  type?: string
  kind?: string
  name?: string
  host?: string
  port?: number
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  sessionPassword?: string | null
  isLocal?: boolean
  isQuickConnect?: boolean
}

export type TerminalStoreEntry = {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  opened: boolean
  started: boolean
  starting: boolean
  unlisten?: () => void
  exitUnlisten?: () => void
}
