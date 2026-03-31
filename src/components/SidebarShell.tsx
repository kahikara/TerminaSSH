import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, Home, Settings } from 'lucide-react'
import { t } from '../lib/i18n'

type SidebarShellProps = {
  isCollapsed: boolean
  width: number
  useCustomLinuxTitlebar: boolean
  lang: string
  onGoHome: () => void
  onOpenSettings: () => void
  onToggleCollapse: () => void
  onStartResize: () => void
  children: ReactNode
}

export default function SidebarShell({
  isCollapsed,
  width,
  useCustomLinuxTitlebar,
  lang,
  onGoHome,
  onOpenSettings,
  onToggleCollapse,
  onStartResize,
  children
}: SidebarShellProps) {
  return (
    <div
      style={{
        width: isCollapsed ? 76 : width,
        paddingTop: useCustomLinuxTitlebar ? 30 : 0
      }}
      className="bg-[color-mix(in_srgb,var(--bg-sidebar)_94%,var(--bg-app))] flex flex-col flex-shrink-0 h-full relative z-20 shadow-xl"
    >
      {isCollapsed ? (
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex justify-center">
            <button
              onClick={onGoHome}
              className="ui-icon-btn shrink-0"
              title={t('home', lang)}
            >
              <Home size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="h-[80px] grid grid-cols-[52px_minmax(0,1fr)_36px] items-center px-4 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
          <img
            src="/app-icon.svg"
            alt="logo"
            className="w-[52px] h-[52px] object-contain justify-self-start"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
          <div className="flex items-center justify-center min-w-0">
            <span className="font-bold tracking-wide text-[14px] text-[var(--text-main)] leading-none text-center">
              Termina SSH
            </span>
          </div>
          <button
            onClick={onGoHome}
            className="ui-icon-btn shrink-0 justify-self-end"
            title={t('home', lang)}
          >
            <Home size={18} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2 px-3 flex flex-col gap-3 min-h-0">
        {children}
      </div>

      <div className="p-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
        <div className={`flex ${isCollapsed ? 'flex-col items-center gap-2' : 'items-center gap-2'}`}>
          <button
            onClick={onOpenSettings}
            className={
              isCollapsed
                ? 'ui-icon-btn shrink-0'
                : 'flex items-center justify-center gap-2.5 flex-1 min-h-9 px-3 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]'
            }
            title={t('settings', lang)}
          >
            <Settings size={16} />
            {!isCollapsed && <span>{t('settings', lang)}</span>}
          </button>

          <button
            onClick={onToggleCollapse}
            className="ui-icon-btn shrink-0"
            title={isCollapsed ? t('sidebarExpand', lang) : t('sidebarCollapse', lang)}
          >
            {isCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10"
          onMouseDown={onStartResize}
        />
      )}
      <div className="absolute top-0 right-0 w-[1px] h-full bg-[var(--border-subtle)] pointer-events-none" />
    </div>
  )
}
