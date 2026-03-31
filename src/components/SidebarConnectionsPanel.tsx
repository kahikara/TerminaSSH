import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { ChevronDown, ChevronRight, Folder, Plus, Search, Server, SquarePen, Terminal as TermIcon, X, Zap } from 'lucide-react'
import { t } from '../lib/i18n'

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

type ConnectionGroups = Record<string, ConnectionItem[]>

type SidebarConnectionsPanelProps = {
  isSidebarCollapsed: boolean
  lang: string
  showSidebarSearch: boolean
  sidebarSearchQuery: string
  sidebarSearchInputRef: RefObject<HTMLInputElement | null>
  collapsedConnections: ConnectionItem[]
  sidebarVisibleRootServers: ConnectionItem[]
  sidebarVisibleGroups: ConnectionGroups
  isSidebarSearching: boolean
  groups: ConnectionGroups
  effectiveFolderCollapsed: (group: string) => boolean
  isLocalActive: boolean
  isServerActive: (conn: ConnectionItem) => boolean
  onToggleSearch: () => void
  onSidebarSearchChange: (value: string) => void
  onClearSidebarSearch: () => void
  onOpenLocalTerminalNewTab: () => void
  onOpenNewConnection: () => void
  onOpenQuickConnect: () => void
  onOpenConnection: (
    server: ConnectionItem,
    options?: { forceNewTab?: boolean; openInSplit?: boolean }
  ) => void
  onOpenSidebarContextMenu: (
    e: ReactMouseEvent,
    server: ConnectionItem,
    isLocal?: boolean
  ) => void
  onOpenConnectionSettings: (conn: ConnectionItem) => void
  onToggleFolder: (group: string) => void
  onRemoveEmptyFolder: (group: string) => void
  localTerminalConnection: ConnectionItem
}

export default function SidebarConnectionsPanel({
  isSidebarCollapsed,
  lang,
  showSidebarSearch,
  sidebarSearchQuery,
  sidebarSearchInputRef,
  collapsedConnections,
  sidebarVisibleRootServers,
  sidebarVisibleGroups,
  isSidebarSearching,
  groups,
  effectiveFolderCollapsed,
  isLocalActive,
  isServerActive,
  onToggleSearch,
  onSidebarSearchChange,
  onClearSidebarSearch,
  onOpenLocalTerminalNewTab,
  onOpenNewConnection,
  onOpenQuickConnect,
  onOpenConnection,
  onOpenSidebarContextMenu,
  onOpenConnectionSettings,
  onToggleFolder,
  onRemoveEmptyFolder,
  localTerminalConnection
}: SidebarConnectionsPanelProps) {
  return (
    <div>
      <div className={`flex items-center px-2 py-1 mb-2 rounded-xl ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!isSidebarCollapsed && (
          <h3 className="text-[11px] uppercase tracking-[0.08em] font-bold text-[var(--text-muted)] w-full py-1">
            {t('connections', lang)}
          </h3>
        )}
        <div className="flex gap-1">
          {!isSidebarCollapsed && (
            <button
              onClick={onOpenLocalTerminalNewTab}
              className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
              title={t('localTerminal', lang)}
            >
              <TermIcon size={16} />
            </button>
          )}
          {!isSidebarCollapsed && (
            <button
              onClick={onToggleSearch}
              className={`text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)] ${showSidebarSearch ? 'text-[var(--accent)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))]' : ''}`}
              title={lang === 'de' ? 'Suche' : 'Search'}
            >
              <Search size={16} />
            </button>
          )}
          <button
            onClick={onOpenNewConnection}
            className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
            title={t('newConn', lang)}
          >
            <Plus size={16} />
          </button>
          {!isSidebarCollapsed && (
            <button
              onClick={onOpenQuickConnect}
              className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
              title={t('quickConnect', lang)}
            >
              <Zap size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {!isSidebarCollapsed && showSidebarSearch && (
        <div className="mb-3 px-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
              <Search size={14} />
            </span>
            <input
              ref={sidebarSearchInputRef}
              value={sidebarSearchQuery}
              onChange={(e) => onSidebarSearchChange(e.target.value)}
              placeholder={lang === 'de' ? 'Verbindungen suchen' : 'Search connections'}
              className="w-full h-9 pl-9 pr-9 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)] placeholder:text-[var(--text-muted)]"
            />
            {sidebarSearchQuery && (
              <button
                onClick={onClearSidebarSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded transition-colors"
                title={lang === 'de' ? 'Leeren' : 'Clear'}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {isSidebarCollapsed ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl">
          {collapsedConnections.map((conn, idx: number) => {
            const localItem = !!conn?.isLocal || conn?.id === 'local'
            const active = localItem ? isLocalActive : isServerActive(conn)

            return (
              <button
                key={`${conn.id || conn.name || 'item'}_${idx}`}
                onContextMenu={(e) => onOpenSidebarContextMenu(e, localItem ? localTerminalConnection : conn, localItem)}
                onClick={() => onOpenConnection(localItem ? localTerminalConnection : conn)}
                onDoubleClick={() => onOpenConnection(localItem ? localTerminalConnection : conn, { forceNewTab: true })}
                title={localItem ? t('localTerminal', lang) : conn.name}
                className={`group/item flex items-center justify-center w-full h-9 rounded-xl border transition-all ${
                  active
                    ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                    : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                }`}
              >
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded-md border shrink-0 ${
                    active
                      ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                      : 'bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border-[var(--border-subtle)]'
                  }`}
                >
                  {localItem ? (
                    <TermIcon size={12} className={active ? 'text-[var(--accent)]' : 'text-[var(--text-category)]'} />
                  ) : (
                    <Server size={12} className={active ? 'text-[var(--accent)]' : 'text-[var(--text-category)]'} />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 rounded-xl">
          {sidebarVisibleRootServers.length === 0 && Object.keys(sidebarVisibleGroups).length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-4 py-5 text-center">
              <div className="text-sm font-semibold text-[var(--text-main)]">
                {t('noConnectionsYet', lang)}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                {t('noConnectionsHint', lang)}
              </div>
            </div>
          )}

          {sidebarVisibleRootServers.map((conn) => {
            const active = isServerActive(conn)

            return (
              <div
                key={conn.id}
                className={`group/item flex items-center justify-between w-full rounded-xl border text-sm transition-all px-2 py-0 ${
                  active
                    ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                    : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                }`}
              >
                <button
                  onContextMenu={(e) => onOpenSidebarContextMenu(e, conn)}
                  onClick={() => onOpenConnection(conn)}
                  onDoubleClick={() => onOpenConnection(conn, { forceNewTab: true })}
                  className={`flex items-center flex-1 min-w-0 text-left py-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-hover)] ${
                    active ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <div
                    className={`flex items-center justify-center w-6 h-6 rounded-md border mr-2 shrink-0 ${
                      active
                        ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                        : 'bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border-[var(--border-subtle)]'
                    }`}
                  >
                    <Server size={12} className={active ? 'text-[var(--accent)]' : 'text-[var(--text-category)]'} />
                  </div>
                  <span className="truncate font-medium min-w-0">{conn.name}</span>
                </button>
                <button
                  onClick={() => onOpenConnectionSettings(conn)}
                  className={`${active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'} ui-icon-btn shrink-0 transition-all focus-visible:opacity-100`}
                  title={t('settings', lang)}
                >
                  <SquarePen size={13} />
                </button>
              </div>
            )
          })}

          {Object.keys(sidebarVisibleGroups).sort().map((group) => {
            const isCollapsed = effectiveFolderCollapsed(group)

            return (
              <div key={group}>
                <button
                  onClick={() => onToggleFolder(group)}
                  className="inline-flex max-w-full items-center justify-between px-2.5 py-0.5 rounded-xl border border-transparent transition-all group/folder mt-1 hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                >
                  <div className="flex items-center gap-1.5 min-w-0 text-[var(--text-muted)]">
                    {isCollapsed ? <ChevronRight size={12} className="text-[var(--accent)] shrink-0" /> : <ChevronDown size={12} className="text-[var(--accent)] shrink-0" />}
                    <Folder size={12} className="text-[var(--accent)] shrink-0" />
                    <span className="truncate text-[10px] font-semibold min-w-0 text-[var(--text-muted)]">{group}</span>
                  </div>
                  {!isSidebarSearching && groups[group]?.length === 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveEmptyFolder(group)
                      }}
                      className="opacity-0 group-hover/folder:opacity-100 text-[var(--danger)] transition-all focus-visible:opacity-100 flex items-center justify-center shrink-0"
                      style={{ width: 18, height: 18, borderRadius: 6 }}
                    >
                      <X size={10} />
                    </span>
                  )}
                </button>

                {!isCollapsed && (
                  <div className="flex flex-col gap-0 ml-3 border-l border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] pl-2 mt-0.5">
                    {sidebarVisibleGroups[group].map((conn) => {
                      const active = isServerActive(conn)

                      return (
                        <div
                          key={conn.id}
                          className={`group/item flex items-center justify-between w-full rounded-xl border text-sm transition-all px-1.5 py-0 ${
                            active
                              ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                              : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                          }`}
                        >
                          <button
                            onContextMenu={(e) => onOpenSidebarContextMenu(e, conn)}
                            onClick={() => onOpenConnection(conn)}
                            onDoubleClick={() => onOpenConnection(conn, { forceNewTab: true })}
                            className={`flex items-center flex-1 min-w-0 text-left px-1 py-1 rounded-xl ${
                              active ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                            }`}
                          >
                            <div
                              className={`flex items-center justify-center w-6 h-6 rounded-md border mr-2 shrink-0 ${
                                active
                                  ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                                  : 'bg-[var(--bg-app)] border-[var(--border-subtle)]'
                              }`}
                            >
                              <Server size={12} className={active ? 'text-[var(--accent)]' : 'text-[var(--text-category)]'} />
                            </div>
                            <span className="truncate font-medium min-w-0">{conn.name}</span>
                          </button>
                          <button
                            onClick={() => onOpenConnectionSettings(conn)}
                            className={`${active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'} ui-icon-btn shrink-0 transition-all`}
                            title={t('settings', lang)}
                          >
                            <SquarePen size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
